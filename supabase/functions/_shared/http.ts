// Edge Function 10개가 전부 쓰는 HTTP 공통(예전 _shared/cbt.ts 의 corsHeaders·json·isUuid).
// 규칙(채점·상수)은 _shared/core.mjs(packages/core 번들)로 옮겨 갔고 여기엔 응답 헬퍼만 남는다.

// @ts-types="./core.d.ts"
export { isPaperUuid as isUuid } from "./core.mjs";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // x-gongmoa-app-build / x-gongmoa-platform: 앱이 supabase-js createClient 의
  // global.headers 로 고정해 보내는 빌드 번호·플랫폼(설계서 §6.6 "Edge 계약 버전").
  // 네이티브에는 preflight 가 없어 무관하지만 Expo web/dev 클라이언트에서는 여기 없으면
  // preflight 가 막힌다.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gongmoa-app-build, x-gongmoa-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
