import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../format";
import { inParallel } from "./query-utils";

// 본인이 답한 문항의 정답(DI) — RPC own_wrong_answers(설계서 §6.2 "오답노트 정답" 행, §6.7 #3).
// paper_answers 는 관리자 전용 RLS 라 앱이 직접 못 읽는다. 이 RPC(security definer,
// authenticated 전용)는 요청 문항 중 **본인이 CBT·섞어풀기로 답한 문항**(형제 문제지 매핑 포함)의
// 정답만 돌려준다 — 안 푼 문항은 결과에 없다.
//
// 결과는 정답이므로 디스크에 남기지 않는다(AGENTS.md 금지선) — 앱 쿼리는 meta.persist:false.

export type OwnWrongAnswerItem = { paperId: string; questionNumber: number };

// RPC 가 한 번에 받는 상한(schema.sql own_wrong_answers: jsonb_array_length > 500 이면 거절).
export const OWN_WRONG_ANSWERS_CHUNK = 500;

export function wrongAnswerKey(paperId: string, questionNumber: number): string {
  return `${paperId}#${questionNumber}`;
}

// `${paperId}#${questionNumber}` → 정답 번호. 요청했지만 결과에 없는 문항은 키가 없다.
export async function fetchOwnWrongAnswers(
  client: SupabaseClient,
  items: OwnWrongAnswerItem[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (items.length === 0) return out;
  await inParallel(chunk(items, OWN_WRONG_ANSWERS_CHUNK), async (part) => {
    const { data, error } = await client.rpc("own_wrong_answers", { p_items: part });
    if (error) throw new Error(`정답 조회 실패: ${error.message}`);
    for (const row of (data ?? []) as { paper_id: string; question_number: number; correct_choice: number | null }[]) {
      if (row.correct_choice == null) continue;
      out[wrongAnswerKey(row.paper_id, row.question_number)] = row.correct_choice;
    }
  });
  return out;
}
