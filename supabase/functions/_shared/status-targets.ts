// 웹 src/lib/status-targets.ts 포팅(공유). 복습·섞어풀기 채점을 user_question_status
// 의 "실제 행"에 기록하기 위한 되짚기.
//
// 세션 문항의 paper_id 는 dedup 대표(rep) 문제지 id다. 반면 문항 상태와 복습 스케줄은
// 사용자가 실제로 응시한 문제지 id에 붙어 있다. 중복 시험지(직류만 다른 같은 시험지)를
// 응시했다면 둘이 갈리고, 그대로 대표 id에 기록하면 응시한 적 없는 문제지에 새 행이
// 생기면서 원본 행은 그대로 남는다 — 오답노트가 계속 "미극복"으로 보이고, srs_due_at
// 이 안 밀려 같은 문항이 매일 복습 큐에 다시 나온다.
//
// 웹과 다른 점 하나: 대표 선정(representativePaperIds)까지 하지 않고 "같은 시험지
// 묶음"만 구한다. 기록 대상은 묶음 전체 중 사용자가 행을 가진 것이라, 그 안에서 누가
// 대표인지는 결과에 영향이 없다. 정답 대조 안전장치(정답이 둘 다 등록됐는데 값이
// 다르면 다른 시험지로 분리)는 웹과 같은 규칙으로 태운다 — 엣지 함수는 service_role
// 이라 paper_answers 를 읽을 수 있다.
// deno-lint-ignore-file no-explicit-any

export type StatusTargetItem = { paperId: string; questionNumber: number };

export function statusTargetKey(paperId: string, questionNumber: number): string {
  return `${paperId}#${questionNumber}`;
}

type PaperRow = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  level: string | null;
};

const DEDUP_SELECT = "id, subject_id, exam_type_id, year, round, level";

// track 을 뺀 (과목·직렬·연도·회차·급수). packages/core 의 paperDedupKey 와 같은 규칙.
function dedupKey(p: PaperRow): string {
  return [p.subject_id, p.exam_type_id, p.year, p.round, p.level ?? ""].join(" ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function resolveStatusTargets(
  admin: any,
  userId: string,
  items: StatusTargetItem[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const paperIds = [...new Set(items.map((i) => i.paperId))];
  if (paperIds.length === 0) return out;

  const { data: baseRows } = await admin
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .in("id", paperIds);
  const base = (baseRows ?? []) as PaperRow[];
  if (base.length === 0) return out;

  // 같은 그룹 키를 가질 수 있는 후보를 한 번에 받아 오고, 정확한 키 비교는 아래에서.
  let siblingQuery = admin
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .in("subject_id", [...new Set(base.map((p) => p.subject_id))])
    .in("exam_type_id", [...new Set(base.map((p) => p.exam_type_id))])
    .in("year", [...new Set(base.map((p) => p.year))])
    .in("round", [...new Set(base.map((p) => p.round))]);
  // 급수는 null 일 수 있다. 전부 값이 있을 때만 조건을 하나 더 걸어 범위를 줄인다.
  const levels = base.map((p) => p.level);
  if (levels.every((l) => l != null)) {
    siblingQuery = siblingQuery.in("level", [...new Set(levels)]);
  }
  const { data: siblingRows } = await siblingQuery;

  const baseKeys = new Set(base.map(dedupKey));
  const byId = new Map<string, PaperRow>();
  for (const p of base) byId.set(p.id, p);
  for (const p of (siblingRows ?? []) as PaperRow[]) {
    if (baseKeys.has(dedupKey(p))) byId.set(p.id, p);
  }

  // 메타데이터 묶음. 혼자인 묶음은 되짚을 것이 없다.
  const metaGroups = new Map<string, PaperRow[]>();
  for (const p of byId.values()) {
    const list = metaGroups.get(dedupKey(p)) ?? [];
    list.push(p);
    metaGroups.set(dedupKey(p), list);
  }
  const colliding = [...metaGroups.values()].filter((g) => g.length > 1);
  if (colliding.length === 0) return out;

  // 정답 지문. 한 묶음 안에 서로 다른 정답이 2종 이상 섞여 있으면 다른 시험지다.
  const signatureById = new Map<string, string>();
  const collidingIds = colliding.flatMap((g) => g.map((p) => p.id));
  for (const ids of chunk(collidingIds, 200)) {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, answers, voided_questions")
      .in("paper_id", ids);
    for (const r of (data ?? []) as {
      paper_id: string;
      answers: number[] | null;
      voided_questions: number[] | null;
    }[]) {
      signatureById.set(
        r.paper_id,
        JSON.stringify([r.answers ?? [], r.voided_questions ?? []]),
      );
    }
  }

  // 같은 시험지 묶음 → 소속 문제지 id들. 정답이 갈리면 지문별로 쪼개고, 정답이
  // 없어 어디에 속하는지 모르는 것은 안전하게 단독으로 둔다(core 의 clusterSamePaper).
  const siblingsById = new Map<string, string[]>();
  for (const members of colliding) {
    const distinct = new Set(
      members.map((m) => signatureById.get(m.id)).filter((s): s is string => s != null),
    );
    const buckets = new Map<string, string[]>();
    for (const m of members) {
      const sig = signatureById.get(m.id);
      const key = distinct.size <= 1 ? "all" : sig != null ? `a:${sig}` : `solo:${m.id}`;
      const list = buckets.get(key) ?? [];
      list.push(m.id);
      buckets.set(key, list);
    }
    for (const list of buckets.values()) {
      for (const id of list) siblingsById.set(id, list);
    }
  }

  const candidateIds = new Set<string>();
  for (const item of items) {
    for (const id of siblingsById.get(item.paperId) ?? []) candidateIds.add(id);
  }
  if (candidateIds.size === 0) return out;

  // 실제로 상태 행이 있는 (문제지, 문항)만 기록 대상이다.
  const questionNumbers = [...new Set(items.map((i) => i.questionNumber))];
  const owned = new Set<string>();
  for (const ids of chunk([...candidateIds], 100)) {
    const { data } = await admin
      .from("user_question_status")
      .select("paper_id, question_number")
      .eq("user_id", userId)
      .in("paper_id", ids)
      .in("question_number", questionNumbers);
    for (const r of (data ?? []) as { paper_id: string; question_number: number }[]) {
      owned.add(statusTargetKey(r.paper_id, r.question_number));
    }
  }

  for (const item of items) {
    const targets = (siblingsById.get(item.paperId) ?? [item.paperId]).filter((id) =>
      owned.has(statusTargetKey(id, item.questionNumber)),
    );
    // 하나도 없으면 이 문항의 첫 기록이다 — 넘어온 id 를 그대로 쓰게 담지 않는다.
    if (targets.length === 0) continue;
    out.set(statusTargetKey(item.paperId, item.questionNumber), targets);
  }
  return out;
}
