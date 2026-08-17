// 웹 서버 액션(src/app/papers/actions.ts, src/lib/cbt-attempt.ts)과 동일한 규칙.
// 채점은 반드시 service_role 로만 한다 — 정답(paper_answers)은 RLS 로 클라이언트에
// 완전 차단돼 있고, 시작시각·점수 위조를 막기 위해 쓰기도 전부 service_role 이다.

// submit 과 클라이언트가 공유하는 최소 응시시간. 실제 검증은 서버 기록 시각으로만 한다.
// 웹(src/lib/cbt-attempt.ts)·앱(src/lib/cbt.ts)과 반드시 같은 값을 유지할 것.
export const MIN_ATTEMPT_SECONDS = 90;

// N분 M초 표기. packages/core의 formatDuration과 동일한 규칙이지만, Edge Function은
// Deno 런타임이라 그 워크스페이스 패키지를 그대로 import할 수 없어 여기 따로 둔다.
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}분 ${seconds}초`;
}

// 제출 답안 정제: 클라이언트 값이라 소수·NaN·거대한 수가 섞일 수 있어 1~10 정수만 통과.
export function sanitizeSelectedChoice(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 10
    ? value
    : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
