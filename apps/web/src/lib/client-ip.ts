import "server-only";
import { headers } from "next/headers";

// 요청을 보낸 클라이언트의 IP. 프록시(Vercel 등)를 거치므로 x-forwarded-for를
// 우선 신뢰하고, 알 수 없는 환경(로컬 등)에서는 null을 돌려준다.
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}
