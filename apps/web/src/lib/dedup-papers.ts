import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 같은 시험지를 직류(track)만 다르게 중복 업로드한 행을 하나로 합치기 위한 도구.
//
// 배경: bulk-upload.mjs가 --track 값마다 별도 exam_papers 행을 만들면서 title에도
// " (전산서기보)" 같은 접미사를 붙인다. 법원직처럼 한 직렬 안에 여러 직류가 있는
// 시험은 공통과목(국어·한국사·영어)이 직류가 달라도 문제지가 완전히 동일한데,
// 직류별로 한 번씩 올리면 같은 시험지가 (전산서기보)/(사서서기보)처럼 여러 카드로
// 중복 노출된다.
//
// 합치는 기준:
//   1) 메타데이터: track을 뺀 (과목·직렬·연도·회차·급수)가 같아야 한다. 직류 전용
//      과목은 subject_id 자체가 달라 여기서 이미 걸러진다. 공무원 시험은 한
//      (직렬·연도·회차·급수)에서 과목당 시험지가 하나뿐이라, 이 값이 다 같은 여러
//      행은 사실상 직류만 다르게 중복 업로드한 것으로 본다.
//   2) 다르다는 증거가 있으면 분리: 같은 메타데이터라도 정답 배열(paper_answers.
//      answers)이 둘 다 등록돼 있는데 값이 다르면 다른 시험지로 보고 분리한다.
//      정답이 아직 없거나 한쪽만 있으면(예: 법원직 서기보) 같은 시험지로 보고
//      합친다. 즉 정답은 "잘못된 병합을 막는 안전장치"로만 쓰고, 합치기의 전제
//      조건으로 쓰지는 않는다(그렇게 했더니 정답 미등록 문제지가 안 합쳐졌다).

// 합치는 계산(키·그룹핑·대표 선정)은 @gongmoa/core 로 단일화(모바일과 공유). 이 파일에는
// 정답 대조에 필요한 service_role 조회만 남는다 — paper_answers 는 RLS 로 일반 사용자
// SELECT 가 막혀 있어 서버에서만 읽을 수 있기 때문이다(docs/agents/dedup-papers.md).
export {
  collapseDuplicatePapers,
  collidingPaperIds,
  paperDedupKey,
  representativePaperIds,
  type DedupablePaper,
  type PaperIdentitySignal,
} from "@gongmoa/core";

import type { PaperIdentitySignal } from "@gongmoa/core";

// 문제지별 문항 수. 대표 선정(isBetterRepresentative)의 1순위 타이브레이커라 틀리면
// 목록에서 어느 카드가 보일지가 흔들린다 — 즉 성능이 아니라 정확성이 걸린 조회다.
//
// 예전에는 questions 에서 문항 하나당 한 행씩 받아 여기서 셌다. PostgREST 응답은
// 1000행에서 잘리는데 그 자름이 조용해서, 겹치는 문제지가 25~40장만 넘어가면(문항이
// 장당 25~40개다) 뒤쪽 문제지가 questionCount 0 으로 집계됐다.
//
// 세는 건 DB 에 맡긴다(paper_question_counts RPC — 문제지당 한 행이라 자를 일이 없다).
// 아직 마이그레이션이 안 된 환경에서는 예전 방식으로 떨어지되, 이번엔 range 로
// 끝까지 페이징해서 자르지 않는다(이 레포의 다른 대량 조회와 같은 방식).
const QUESTION_PAGE_SIZE = 1000;

async function fetchQuestionCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  try {
    const { data, error } = await supabase.rpc("paper_question_counts", {
      p_paper_ids: paperIds,
    });
    if (!error) {
      for (const row of (data ?? []) as { paper_id: string; question_count: number }[]) {
        counts.set(row.paper_id, Number(row.question_count));
      }
      return counts;
    }
  } catch {
    // 함수가 아직 없는 환경(마이그레이션 전). 아래 페이징으로 떨어진다.
  }

  for (let from = 0; ; from += QUESTION_PAGE_SIZE) {
    const { data: rows, error: pageError } = await supabase
      .from("questions")
      .select("paper_id")
      .in("paper_id", paperIds)
      .range(from, from + QUESTION_PAGE_SIZE - 1);
    if (pageError || !rows || rows.length === 0) break;
    for (const row of rows as { paper_id: string }[]) {
      counts.set(row.paper_id, (counts.get(row.paper_id) ?? 0) + 1);
    }
    if (rows.length < QUESTION_PAGE_SIZE) break;
  }
  return counts;
}

// 겹칠 수 있는 문제지들의 내용 신호(문항 수 + 정답 지문)를 모은다. 정답 "내용"은
// 클라이언트로 나가지 않고, 서버에서 두 문제지가 같은지 비교하는 데만 쓴다.
// service_role 키가 없는 환경에서는 정답 대조를 조용히 건너뛰고 문항 수만 쓴다.
export async function fetchPaperIdentitySignals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<Map<string, PaperIdentitySignal>> {
  const signals = new Map<string, PaperIdentitySignal>();
  if (paperIds.length === 0) return signals;
  for (const id of paperIds) {
    signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  }

  // 문항 수(공개 읽기)와 정답 지문(service_role 전용)은 서로 의존이 없으므로
  // 동시에 조회한다 — 이 함수는 목록 조회 뒤에 이어지는 직렬 구간이라 왕복을
  // 하나라도 줄이는 게 체감 속도에 그대로 반영된다.
  const questionCountsPromise = fetchQuestionCounts(supabase, paperIds);
  // service_role 키가 없는 환경에서는 정답 대조를 조용히 건너뛰고 문항 수만 쓴다.
  // (여기서 null을 돌려줘야 아래 await 전에 거절된 프로미스가 생기지 않는다.)
  const answerRowsPromise = (async () => {
    try {
      const admin = createAdminClient();
      return await admin
        .from("paper_answers")
        .select("paper_id, answers, voided_questions")
        .in("paper_id", paperIds);
    } catch {
      return null;
    }
  })();

  for (const [paperId, count] of await questionCountsPromise) {
    const s = signals.get(paperId);
    if (s) s.questionCount = count;
  }

  const answerResult = await answerRowsPromise;
  if (answerResult && !answerResult.error) {
    for (const row of answerResult.data ?? []) {
      const r = row as {
        paper_id: string;
        answers: number[] | null;
        voided_questions: number[] | null;
      };
      const s = signals.get(r.paper_id);
      if (!s) continue;
      const answers = r.answers ?? [];
      s.answerSignature = JSON.stringify([answers, r.voided_questions ?? []]);
      s.answerLength = answers.length;
    }
  }

  return signals;
}
