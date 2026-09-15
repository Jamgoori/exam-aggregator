import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../format";
import { inParallel } from "./query-utils";

// 문제지들의 문항별 크롭 이미지(공개 URL)와 선지 수 — 웹 lib/wrong-notes.ts 의
// fetchQuestionMedia 를 옮긴 것. Edge(review-create/submit/history·explanations-get)도
// 이 함수를 쓴다(예전 _shared/media.ts 는 1000행 한도를 페이지네이션 없이 한 번에 받아
// 문제지가 많은 계정에서 뒤쪽 문제지의 이미지가 조용히 빠졌다).

export type QuestionMediaEntry = {
  choiceCount: number | null;
  images: string[];
  // questions.id — 해설(question_explanations)을 되짚을 때 쓴다. 이 조회가 이미
  // 문항 행을 훑으므로 id를 함께 실어 오면 왕복이 하나 준다.
  questionId: string;
};

const QUESTION_MEDIA_SELECT =
  "id, paper_id, question_number, choice_count, question_images(order_index, image_path)";

type QuestionMediaRow = {
  id: string;
  paper_id: string;
  question_number: number;
  choice_count: number;
  question_images: { order_index: number; image_path: string }[] | null;
};

// PostgREST 기본 최대 행 수. range 로 이만큼씩 끊어 받는다.
const BATCH_SIZE = 1000;

// 문제지들의 문항별 크롭 이미지(공개 URL)와 선지 수를 한 번에 받아온다.
// questions/question_images는 public read라 사용자 세션 클라이언트로 충분하다.
//
// wanted를 주면 문제지별로 그 문항 번호만 조회한다. 오답노트는 문제지 한 장에서 보통
// 일부만 틀리는데, 예전에는 언제나 문제지 전체 문항 + 이미지 행을 받아 와서 화면에
// 쓰지도 않는 데이터가 대부분이었다(문제지가 수십 장 쌓이는 과목에서 특히 크다).
export async function fetchQuestionMedia(
  client: SupabaseClient,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, Map<number, QuestionMediaEntry>>> {
  const byPaper = new Map<string, Map<number, QuestionMediaEntry>>();

  function consume(rows: QuestionMediaRow[]) {
    for (const row of rows) {
      const images = [...(row.question_images ?? [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map(
          (img) =>
            client.storage.from("exam-papers").getPublicUrl(img.image_path).data.publicUrl,
        );
      const paperMap =
        byPaper.get(row.paper_id) ?? new Map<number, QuestionMediaEntry>();
      paperMap.set(row.question_number, {
        choiceCount: row.choice_count,
        images,
        questionId: row.id,
      });
      byPaper.set(row.paper_id, paperMap);
    }
  }

  if (wanted) {
    await inParallel(paperIds, async (paperId) => {
      const numbers = [...(wanted.get(paperId) ?? [])];
      if (numbers.length === 0) return;
      // 문항 번호로 좁히면 한 문제지가 BATCH_SIZE를 넘길 일이 없어 페이지네이션이
      // 필요 없다(embedded question_images는 행 수에 포함되지 않는다).
      const { data } = await client
        .from("questions")
        .select(QUESTION_MEDIA_SELECT)
        .eq("paper_id", paperId)
        .in("question_number", numbers);
      consume((data ?? []) as unknown as QuestionMediaRow[]);
    });
    return byPaper;
  }

  // 10문제지씩 묶어 페이지네이션한다. 한 문제지가 최대 50문항이라 청크 하나가 한 페이지에
  // 들어오고, 넘치면 range 로 이어 받는다.
  await inParallel(chunk(paperIds, 10), async (ids) => {
    let from = 0;
    while (true) {
      const { data } = await client
        .from("questions")
        .select(QUESTION_MEDIA_SELECT)
        .in("paper_id", ids)
        .order("paper_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      consume(data as unknown as QuestionMediaRow[]);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  });
  return byPaper;
}
