import { storagePublicUrl } from "./clients.ts";

// 문제지들의 문항 이미지·선지 수 조회. 웹 apps/web/src/lib/wrong-notes.ts 의
// fetchQuestionMedia 포팅 — 정본은 웹이고, 바꿀 때 양쪽을 함께 고칠 것.
//
// 포팅하면서 웹에 있는 두 가지가 빠져 있었고, 둘 다 조용히 틀린 답을 내고 있었다:
//
//  1) 문항 좁히기(wanted). 호출부는 전부 (문제지, 문항번호) 쌍을 이미 알고 있는데
//     문제지 id 만 넘겨서, 그 문제지의 문항을 전부 받아 몇 개만 썼다. 섞어풀기는
//     20~50문항이 서로 다른 시험지에 흩어지므로 500~1250행을 받아 20~50행만 쓴 셈이다.
//  2) 페이지네이션. PostgREST 응답은 1000행에서 잘리고 그 자름은 에러가 아니다.
//     문항이 장당 25~40개라 시험지 40장만 넘어가면 뒤쪽 시험지의 media 가 통째로 비고,
//     호출부의 `images.length > 0` 필터가 그 문항들을 후보에서 조용히 탈락시킨다 —
//     오답이 많은 사용자일수록 섞어풀기에 나오는 문항이 오히려 줄어드는 결과였다.
//
// 문항 번호로 좁히면 한 문제지가 1000행을 넘길 일이 없다(임베드된 question_images 는
// 행 수에 포함되지 않는다). 좁히지 않는 호출을 위해 페이지네이션도 함께 둔다.
// deno-lint-ignore-file no-explicit-any
export type QMedia = { images: string[]; choiceCount: number };

const BATCH_SIZE = 1000;
const QUERY_CONCURRENCY = 8;
const SELECT =
  "paper_id, question_number, choice_count, question_images(order_index, image_path)";

// (문제지, 문항번호) 쌍 목록 → 문제지별 문항 번호 집합. 호출부가 이미 들고 있는
// 모양에서 바로 만들 수 있게 여기 둔다.
export function wantedFromItems(
  items: { paper_id: string; question_number: number }[],
): Map<string, Set<number>> {
  const wanted = new Map<string, Set<number>>();
  for (const it of items) {
    const set = wanted.get(it.paper_id) ?? new Set<number>();
    set.add(it.question_number);
    wanted.set(it.paper_id, set);
  }
  return wanted;
}

async function inParallel<T>(
  items: T[],
  run: (item: T) => Promise<void>,
  limit = QUERY_CONCURRENCY,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (let i = cursor++; i < items.length; i = cursor++) await run(items[i]);
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchQuestionMedia(
  admin: any,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, Map<number, QMedia>>> {
  const out = new Map<string, Map<number, QMedia>>();
  if (paperIds.length === 0) return out;

  function consume(rows: any[]) {
    for (const q of rows) {
      const images = [...((q.question_images as
        | { order_index: number; image_path: string }[]
        | null) ?? [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map((img) => storagePublicUrl(img.image_path));
      if (!out.has(q.paper_id)) out.set(q.paper_id, new Map());
      out.get(q.paper_id)!.set(q.question_number, {
        images,
        choiceCount: q.choice_count as number,
      });
    }
  }

  if (wanted) {
    await inParallel(paperIds, async (paperId) => {
      const numbers = [...(wanted.get(paperId) ?? [])];
      if (numbers.length === 0) return;
      const { data } = await admin
        .from("questions")
        .select(SELECT)
        .eq("paper_id", paperId)
        .in("question_number", numbers);
      consume(data ?? []);
    });
    return out;
  }

  await inParallel(chunk(paperIds, 10), async (ids) => {
    let from = 0;
    while (true) {
      const { data } = await admin
        .from("questions")
        .select(SELECT)
        .in("paper_id", ids)
        .order("paper_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      consume(data);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  });
  return out;
}
