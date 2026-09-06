import "server-only";
import { timingSafeEqual } from "node:crypto";

// Vercel 크론이 붙여 보내는 Authorization: Bearer <CRON_SECRET> 검사.
//
// Vercel 은 프로젝트 환경변수에 CRON_SECRET 이 있으면 크론 호출마다 이 헤더를 자동으로
// 실어 보낸다. 사람이 손으로 부를 때도 같은 헤더를 붙이면 된다.
//
// 반환값은 셋이다. "unset" 은 비밀값 자체가 없어서 검사할 수 없는 상태 — 무거운
// 엔드포인트는 이때 거절해야 한다(누구나 밖에서 두드려 함수 비용을 태울 수 있다).
export type CronAuthResult = "ok" | "unauthorized" | "unset";

export function checkCronAuth(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "unset";
  const auth = request.headers.get("authorization");
  return timingSafeEqualStr(auth, `Bearer ${secret}`) ? "ok" : "unauthorized";
}

// 상수시간 문자열 비교. 길이가 다르면 어차피 다르므로 먼저 걸러낸다(길이는 timingSafeEqual
// 이 던지는 조건이기도 하다). 비교 시간으로 토큰을 한 글자씩 알아내는 걸 막는다.
function timingSafeEqualStr(a: string | null, b: string): boolean {
  if (a === null) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
