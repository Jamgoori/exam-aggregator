// CBT 응시의 순수 규칙 — 서버(채점)와 클라이언트(안내)가 함께 쓰는 값만 둔다.
//
// 서버 전용 규칙(시작 행 기록·회수·채점·기록)은 rules/cbt-attempt.ts 에 있고 이 파일을
// 다시 내보낸다. 이 파일은 클라이언트 번들(웹 CbtSolver·모바일 타이머)에도 들어가므로
// Supabase 클라이언트나 service_role 이 필요한 코드를 절대 두지 말 것.

// submitCbtAttempt(서버)와 CbtSolver(클라이언트)가 같은 최소 응시시간 기준을
// 공유해야 해서 별도 파일로 뺐다 — 클라이언트 쪽은 사용자에게 미리 안내하는 용도,
// 실제 검증은 서버가 기록한 시작 시각으로만 한다.
export const MIN_ATTEMPT_SECONDS = 90;

// 제출된 답안 값 정제: 클라이언트가 보내는 값이라 소수·NaN·거대한 수가 섞여 올 수
// 있는데, 그대로 smallint 컬럼에 넣으면 채점 전체가 DB 에러로 실패한다. 정상 UI로는
// 1~5 사이 정수만 나오므로, 그 밖의 값은 전부 "안 푼 문제"로 취급한다.
export function sanitizeSelectedChoice(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : null;
}
