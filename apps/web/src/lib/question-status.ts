import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type QuestionResultInput = {
  question_number: number;
  is_correct: boolean;
};

// 응시 채점 결과를 문항 단위 통합 상태(user_question_status)에 반영한다. 오답노트
// "극복" 판정과 앞으로 나올 섞어풀기가 공유하는 테이블 — CBT 채점과 섞어풀기 채점이
// 모두 이 함수를 거친다(source로 구분).
//
// 쓰기는 service_role로만 한다: 예전엔 사용자 세션 클라이언트로 upsert했는데, 그러려면
// authenticated에 insert/update 정책을 열어둬야 해서 극복 여부·오답 횟수를 클라이언트가
// REST 호출로 직접 위조할 수 있었다. 서버가 채점한 결과만 이 테이블에 들어가야 하므로
// 쓰기 정책을 닫고(schema.sql) 여기서 admin 클라이언트를 쓴다. userId는 호출부(서버
// 액션)가 세션에서 검증한 본인 id만 넘긴다.
//
// wrong_count는 "틀린 채 제출된 횟수"라 증분이 필요하다. PostgREST upsert는 산술
// (col = col + n)을 못 하므로, 기존 값을 먼저 읽어 앱에서 더한 뒤 전체 행을 upsert한다.
// 문항 수십 개짜리 한 응시 기준이라 조회 1 + upsert 1로 충분하다. 동시 제출 경합은
// cbt_attempt_starts(응시당 1건 삭제)로 이미 막혀 실질적 위험이 없다.
//
// 부가 집계이므로 실패해도 채점 자체는 막지 않는다 — 호출부에서 try/catch로 삼킨다.
// (마이그레이션 적용 전이라 테이블이 없어도 조용히 무시되게 하려는 의도이기도 하다.)
export async function recordQuestionResults(
  userId: string,
  paperId: string,
  results: QuestionResultInput[],
  source: "cbt" | "review" = "cbt",
): Promise<void> {
  if (results.length === 0) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("user_question_status")
    .select("question_number, wrong_count")
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  const priorWrong = new Map<number, number>(
    (existing ?? []).map((r) => [
      r.question_number as number,
      (r.wrong_count as number) ?? 0,
    ]),
  );

  const now = new Date().toISOString();
  const rows = results.map((r) => ({
    user_id: userId,
    paper_id: paperId,
    question_number: r.question_number,
    wrong_count: (priorWrong.get(r.question_number) ?? 0) + (r.is_correct ? 0 : 1),
    last_is_correct: r.is_correct,
    last_answered_at: now,
    source,
    updated_at: now,
  }));

  await admin
    .from("user_question_status")
    .upsert(rows, { onConflict: "user_id,paper_id,question_number" });
}
