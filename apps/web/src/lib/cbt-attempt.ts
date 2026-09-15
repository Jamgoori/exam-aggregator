// CBT 최소 응시시간·답안 정제의 정본은 packages/core/src/cbt-attempt.ts 다(클라이언트
// 번들에 들어가도 되는 순수 값만 있는 파일). 서버 규칙(시작 행·채점)은
// @gongmoa/core/server 의 rules/cbt-attempt.ts 이고 papers/actions.ts 가 그 어댑터다.
//
// 이 파일은 "server-only" 가 아니다 — CbtSolver(클라이언트)가 MIN_ATTEMPT_SECONDS 로
// 사용자에게 미리 안내한다. 실제 검증은 서버가 기록한 시작 시각으로만 한다.
export { MIN_ATTEMPT_SECONDS, sanitizeSelectedChoice } from "@gongmoa/core/cbt-attempt";
