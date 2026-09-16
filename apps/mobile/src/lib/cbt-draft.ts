import type { InkStroke } from "../components/cbt/ink-layer";
import { kvGetJson, kvRemoveByPrefix, kvSetJson, type KvKey } from "./kv";
import { supabase } from "./supabase";

// CBT 드래프트(설계서 §6.5). 웹은 채점 전까지 아무것도 저장하지 않지만 앱은 백그라운드
// 종료가 잦아 답안(+정규화 스트로크)을 `cbt-draft:<paperId>:<startedAt>` 에 두고, 서버
// `cbt_attempt_starts` 행(RLS select own — schema.sql "select own cbt attempt starts")이
// 같은 startedAt 으로 남아 있을 때만 복원한다. 복원하면 5초 카운트다운을 건너뛰고 서버
// startedAt 으로 즉시 재개한다. 제출·"다시 풀기"에서 삭제 — 웹보다 관대한 유일한 차이.
//
// 여기 담기는 것은 사용자가 고른 번호와 필기 좌표뿐이다. 정답·채점 결과(`questionResults`)는
// 어떤 키로도 디스크에 두지 않는다(AGENTS.md 금지선).
export type CbtDraft = {
  answers: (number | null)[];
  // 문제별 보기 스트로크(문항 인덱스 → 획, 문항 상자 폭 기준 정규화).
  strokes: Record<number, InkStroke[]>;
  // 전체보기 스트로크(PDF 페이지 번호 → 획, 페이지 상자 기준 0~1 정규화).
  // **옵셔널이다** — 이 필드가 없던 빌드가 쓴 드래프트도 그대로 복원돼야 한다(추가만 하는 계약).
  pageStrokes?: Record<number, InkStroke[]>;
  savedAt: string;
};

// startedAt 은 두 표기로 들어온다 — cbt-start 응답은 `toISOString()`(…Z), PostgREST 의
// cbt_attempt_starts.started_at 은 `…+00:00`. 같은 순간이 다른 키가 되면 복원이 영영 안 맞으니
// 둘 다 ms 값으로 정규화한 뒤 키에 쓴다.
export function normalizeStartedAt(startedAt: string): string {
  const ms = new Date(startedAt).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : startedAt;
}

function draftKey(paperId: string, startedAt: string): KvKey {
  return `cbt-draft:${paperId}:${normalizeStartedAt(startedAt)}`;
}

// 저장돼 있던 필기 맵을 그대로 믿지 않는다 — 없거나(옛 빌드) 배열이 아닌 값은 버린다.
function strokeMap(value: unknown): Record<number, InkStroke[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<number, InkStroke[]> = {};
  for (const [key, strokes] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (Number.isFinite(index) && Array.isArray(strokes)) out[index] = strokes as InkStroke[];
  }
  return out;
}

// 서버가 기록해 둔 시작 시각(있으면). RLS 가 본인 행만 보여주므로 user_id 조건은 서버가 건다.
export async function findServerStart(paperId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("cbt_attempt_starts")
      .select("started_at")
      .eq("paper_id", paperId)
      .maybeSingle();
    const startedAt = (data as { started_at?: string } | null)?.started_at;
    return typeof startedAt === "string" ? startedAt : null;
  } catch {
    return null;
  }
}

// 서버 시작 행 + 같은 startedAt 의 드래프트가 둘 다 있을 때만 값이 온다.
export async function loadCbtDraft(
  paperId: string,
): Promise<{ startedAt: string; draft: CbtDraft } | null> {
  const serverStartedAt = await findServerStart(paperId);
  if (!serverStartedAt) return null;
  // 호출부(resume·저장 키)가 같은 표기를 쓰도록 정규화한 값을 돌려준다.
  const startedAt = normalizeStartedAt(serverStartedAt);
  const draft = await kvGetJson<CbtDraft>(draftKey(paperId, startedAt));
  if (!draft || !Array.isArray(draft.answers)) return null;
  // 옛 드래프트(pageStrokes 없음)·손상된 값이 와도 복원이 깨지지 않게 두 필기 맵을 정규화한다.
  return {
    startedAt,
    draft: {
      ...draft,
      strokes: strokeMap(draft.strokes),
      pageStrokes: strokeMap(draft.pageStrokes),
    },
  };
}

export async function saveCbtDraft(
  paperId: string,
  startedAt: string,
  draft: Omit<CbtDraft, "savedAt">,
): Promise<void> {
  await kvSetJson(draftKey(paperId, startedAt), { ...draft, savedAt: new Date().toISOString() });
}

// 이 문제지의 드래프트 전부(startedAt 이 다른 옛 것 포함).
export async function clearCbtDrafts(paperId: string): Promise<void> {
  await kvRemoveByPrefix(`cbt-draft:${paperId}:`);
}
