// submitCbtAttempt(서버)와 CbtSolver(클라이언트)가 같은 최소 응시시간 기준을
// 공유해야 해서 별도 파일로 뺐다 — 클라이언트 쪽은 사용자에게 미리 안내하는 용도,
// 실제 검증은 서버가 기록한 시작 시각으로만 한다.
export const MIN_ATTEMPT_SECONDS = 180;
