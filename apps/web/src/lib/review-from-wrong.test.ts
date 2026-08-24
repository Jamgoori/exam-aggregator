import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asSupabase } from "@/lib/test-support/fake-supabase";
import { filterQuestionsAnsweredByUser } from "@/lib/review-session";

// "틀린 N문항만 다시 풀기"가 받는 목록은 클라이언트가 만든 값이다.
//
// 그 목록이 그대로 세션이 되면, 채점 후 세션 뷰가 문항별 **공식 정답**을 실어 돌려준다.
// paper_answers 는 "정답이 그대로 노출되면 채점 의미가 없으므로" 관리자 전용 RLS 로
// 잠가 둔 값인데(schema.sql), 검증이 없으면 아무 문제지의 1~50번을 넣고 빈 답안으로
// 제출하는 것만으로 그 잠금이 풀린다 — 번호만 바꿔 반복하면 전 문제지 정답표가 빠져나간다.
//
// 그래서 "내가 푼 적 있는 문항"만 남는지를 여기서 못 박는다.
//
// user_question_status 는 select-own RLS 라, 실제 운영에서는 사용자 세션 클라이언트가
// 본인 행만 돌려준다. 가짜 클라이언트는 RLS 를 흉내 내지 않으므로 "본인 행만 들어 있는
// 테이블"을 그대로 준다 — 이 테스트가 지키려는 건 RLS 자체가 아니라 "조회 결과에 없는
// 문항은 걸러진다"는 필터 계약이다.
function supabaseWithAnswered(rows: { paper_id: string; question_number: number }[]) {
  const fake = new FakeSupabase({ user_question_status: rows });
  return asSupabase(fake);
}

const MINE = [
  { paper_id: "paper-A", question_number: 1 },
  { paper_id: "paper-A", question_number: 7 },
  { paper_id: "paper-B", question_number: 3 },
];

test("내가 푼 문항은 그대로 남는다", async () => {
  const out = await filterQuestionsAnsweredByUser(supabaseWithAnswered(MINE), [
    { paperId: "paper-A", questionNumber: 1 },
    { paperId: "paper-B", questionNumber: 3 },
  ]);
  assert.deepEqual(out, [
    { paperId: "paper-A", questionNumber: 1 },
    { paperId: "paper-B", questionNumber: 3 },
  ]);
});

test("풀어 본 적 없는 문항은 전부 걸러진다 — 정답표 추출 경로", async () => {
  // 응시한 적 없는 문제지의 1~50번을 통째로 넣는 공격 모양 그대로.
  const attack = Array.from({ length: 50 }, (_, i) => ({
    paperId: "paper-NEVER-TOUCHED",
    questionNumber: i + 1,
  }));
  const out = await filterQuestionsAnsweredByUser(supabaseWithAnswered(MINE), attack);
  assert.deepEqual(out, []);
});

test("같은 문제지라도 안 푼 문항 번호는 걸러진다", async () => {
  const out = await filterQuestionsAnsweredByUser(supabaseWithAnswered(MINE), [
    { paperId: "paper-A", questionNumber: 1 }, // 푼 것
    { paperId: "paper-A", questionNumber: 2 }, // 안 푼 것
    { paperId: "paper-A", questionNumber: 99 }, // 안 푼 것
  ]);
  assert.deepEqual(out, [{ paperId: "paper-A", questionNumber: 1 }]);
});

test("모양이 깨진 항목은 조회 전에 떨어진다", async () => {
  const out = await filterQuestionsAnsweredByUser(supabaseWithAnswered(MINE), [
    { paperId: "", questionNumber: 1 },
    { paperId: "paper-A", questionNumber: 1.5 },
    { paperId: "paper-A", questionNumber: Number.NaN },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...([null, undefined, {}] as any[]),
  ]);
  assert.deepEqual(out, []);
});

test("빈 목록은 조회 없이 빈 결과", async () => {
  assert.deepEqual(await filterQuestionsAnsweredByUser(supabaseWithAnswered(MINE), []), []);
});
