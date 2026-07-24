import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/safe-redirect";

// 이메일/비밀번호 회원가입은 폐쇄됐다 — 가입과 로그인 모두 소셜 로그인(구글·카카오)으로
// 일원화. 기존에 공유·북마크된 /signup 링크가 깨지지 않게 로그인 화면으로 넘긴다.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  redirect(`/login?next=${encodeURIComponent(sanitizeNextPath(rawNext))}`);
}
