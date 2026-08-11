import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  collidingPaperIds,
  paperDedupKey,
  representativePaperIds,
  type DedupablePaper,
} from "@gongmoa/core";
import { fetchPaperIdentitySignals } from "@/lib/dedup-papers";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 복습·섞어풀기 세션의 문항은 dedup 대표(rep) 문제지 id로 저장된다 — 후보를 모으는
// 쪽(review-queue.ts의 byRepQ, wrong-notes.ts의 getSubjectWrongNoteQuestions)이 중복
// 시험지를 대표로 접어서 내보내기 때문이다. 반면 문항 상태(user_question_status)와
// 복습 스케줄은 사용자가 **실제로 응시한** 문제지 id에 붙어 있다.
//
// 중복 시험지(직류만 다른 같은 시험지)를 응시했다면 이 둘이 갈린다. 그대로 대표 id로
// 채점을 기록하면 사용자가 한 번도 응시하지 않은 문제지에 새 행이 생기고, 정작 원본
// 행은 그대로 남아서:
//   - last_is_correct 가 안 바뀌어 오답노트가 계속 "미극복"으로 본다
//   - srs_due_at 이 안 밀려 같은 문항이 매일 복습 큐에 다시 나온다(연체 상태 고착)
//   - wrong_count·srs_lapses 가 유령 행에 쌓여 "N번 틀림" 배지와 leech(8회) 판정,
//     섞어풀기 층 정원제 우선순위가 얼어붙는다
//
// 그래서 채점 직전에 대표 id를 "이 사용자가 실제로 상태 행을 가진 문제지"로 되짚는다.
// 승격(review-queue.ts의 promotePendingItems)이 pendingSources 로 하는 것과 같은
// 되짚기이고, 대표 선정 규칙도 같은 함수(representativePaperIds)를 쓴다.
//
// CBT 채점 경로에는 이 되짚기를 붙이지 않는다 — 거기는 응시한 문제지 id가 그대로
// 넘어와서 되짚을 것이 없고, 억지로 접으면 응시하지도 않은 형제 문제지에 기록이
// 번진다.

export type StatusTargetItem = { paperId: string; questionNumber: number };

// dedup 계산에 필요한 필드. title·created_at 은 대표 선정 타이브레이커에 쓰인다.
const DEDUP_SELECT = "id, subject_id, exam_type_id, year, round, level, track, title, created_at";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function statusTargetKey(paperId: string, questionNumber: number): string {
  return `${paperId}#${questionNumber}`;
}

// 넘어온 (문제지, 문항)마다 "상태를 기록해야 할 실제 문제지 id 목록"을 돌려준다.
// 키는 `${넘어온 paperId}#${questionNumber}`. 되짚을 게 없는 문항(중복 시험지가
// 없거나, 아직 상태 행이 하나도 없는 첫 기록)은 맵에 담기지 않으므로, 호출부는
// 값이 없으면 넘어온 id를 그대로 쓰면 된다.
export async function resolveStatusTargets(
  supabase: Supabase,
  userId: string,
  items: StatusTargetItem[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const paperIds = [...new Set(items.map((i) => i.paperId))];
  if (paperIds.length === 0) return out;

  const { data: baseRows } = await supabase
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .in("id", paperIds);
  const base = (baseRows ?? []) as unknown as DedupablePaper[];
  if (base.length === 0) return out;

  // 같은 그룹 키를 가질 수 있는 문제지 후보를 한 번에 받아 온다. 필드별 IN 이라
  // 조금 넓게 걸리지만(연도·회차 조합이 섞인다), 정확한 키 비교는 아래에서
  // paperDedupKey 로 다시 한다. level 이 null 일 수 있어 SQL 로 그룹을 묶는 것보다
  // 이 편이 단순하다.
  let siblingQuery = supabase
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .in("subject_id", [...new Set(base.map((p) => p.subject_id))])
    .in("exam_type_id", [...new Set(base.map((p) => p.exam_type_id))])
    .in("year", [...new Set(base.map((p) => p.year))])
    .in("round", [...new Set(base.map((p) => p.round))]);
  // 급수는 null 일 수 있어 IN 으로 못 거를 때가 있다. 전부 값이 있을 때만 조건을
  // 하나 더 걸어 조회 범위를 줄인다(복습 세션은 과목·연도가 여러 개 섞여서, 필드별
  // IN 의 조합이 실제 문제지보다 넓게 잡힌다).
  const levels = base.map((p) => p.level);
  if (levels.every((l): l is string => l != null)) {
    siblingQuery = siblingQuery.in("level", [...new Set(levels)]);
  }
  const { data: siblingRows } = await siblingQuery;

  const baseKeys = new Set(base.map(paperDedupKey));
  const byId = new Map<string, DedupablePaper>();
  for (const p of base) byId.set(p.id, p);
  for (const p of (siblingRows ?? []) as unknown as DedupablePaper[]) {
    if (baseKeys.has(paperDedupKey(p))) byId.set(p.id, p);
  }
  const group = [...byId.values()];

  // 겹치는 문제지가 아예 없으면 되짚을 것도 없다 — 대부분의 사용자가 여기서 끝난다
  // (조회 두 번으로 끝나고, 아래의 정답 대조·상태 조회는 돌지 않는다).
  const colliding = collidingPaperIds(group);
  if (colliding.length === 0) return out;

  // 같은 메타데이터라도 정답이 서로 다르게 등록돼 있으면 다른 시험지다. 표시 통합과
  // 똑같은 안전장치를 여기서도 태워야, 실제로는 다른 시험지인 행에 채점이 번지지 않는다.
  const signals = await fetchPaperIdentitySignals(supabase, colliding);
  const { repByPaperId } = representativePaperIds(group, signals);

  const siblingsByRep = new Map<string, string[]>();
  for (const p of group) {
    const rep = repByPaperId.get(p.id) ?? p.id;
    const list = siblingsByRep.get(rep) ?? [];
    list.push(p.id);
    siblingsByRep.set(rep, list);
  }

  const candidateIds = new Set<string>();
  for (const item of items) {
    const rep = repByPaperId.get(item.paperId) ?? item.paperId;
    for (const id of siblingsByRep.get(rep) ?? []) candidateIds.add(id);
  }
  if (candidateIds.size === 0) return out;

  // 실제로 상태 행이 있는 (문제지, 문항)만 기록 대상이다. 행이 없는 형제 문제지까지
  // 쓰면 응시하지도 않은 문제지에 오답노트 항목이 생긴다.
  const questionNumbers = [...new Set(items.map((i) => i.questionNumber))];
  const owned = new Set<string>();
  for (const ids of chunk([...candidateIds], 100)) {
    const { data } = await supabase
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
    const rep = repByPaperId.get(item.paperId) ?? item.paperId;
    const targets = (siblingsByRep.get(rep) ?? [item.paperId]).filter((id) =>
      owned.has(statusTargetKey(id, item.questionNumber)),
    );
    // 하나도 없으면 이 문항의 첫 기록이다 — 넘어온 id 를 그대로 쓰게 맵에 담지 않는다.
    if (targets.length === 0) continue;
    out.set(statusTargetKey(item.paperId, item.questionNumber), targets);
  }
  return out;
}
