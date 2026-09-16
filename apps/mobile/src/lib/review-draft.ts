import { kvGetJson, kvRemove, kvSetJson, type KvKey } from "./kv";

// 복습 답안 드래프트(설계서 §6.5 "드래프트", 웹 review-solver.tsx 의 localStorage 판 1:1).
// 키 이름도 웹 그대로 `review-draft:<sessionId>` — 세션 id 로 잡아 다른 세션과 안 섞이게 하고,
// 채점이 끝나면 지운다.
//
// 담기는 것은 사용자가 고른 번호뿐이다. 정답·채점 결과·세션 항목은 어떤 키로도 디스크에
// 두지 않는다(AGENTS.md 금지선, §6.5 "절대 디스크에 남기지 않는 것" (3)).
//
// 서버에 저장하지 않는 이유는 채점 전 선택이 새면 안 돼서가 아니라(어차피 본인 것) 매
// 선택마다 왕복을 만들 이유가 없어서다 — 웹 주석과 같은 판단. 저장소를 못 읽어도(kv 는
// 전부 try/catch) 처음부터 풀 수 있으면 된다.
function draftKey(sessionId: string): KvKey {
  return `review-draft:${sessionId}`;
}

// 길이가 다르면(문항이 바뀔 일은 없지만) 있는 만큼만 채운다 — 웹 loadDraftAnswers 와 같은 규칙.
export async function loadReviewDraft(sessionId: string, total: number): Promise<(number | null)[]> {
  const empty = Array<number | null>(total).fill(null);
  const saved = await kvGetJson<unknown>(draftKey(sessionId));
  if (!Array.isArray(saved)) return empty;
  return empty.map((_, i) => {
    const v = saved[i];
    return Number.isInteger(v) ? (v as number) : null;
  });
}

export async function saveReviewDraft(sessionId: string, answers: (number | null)[]): Promise<void> {
  await kvSetJson(draftKey(sessionId), answers);
}

export async function clearReviewDraft(sessionId: string): Promise<void> {
  await kvRemove(draftKey(sessionId));
}
