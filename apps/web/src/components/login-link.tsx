"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 헤더는 서버 컴포넌트라 현재 경로를 모르므로, 로그인 링크만 클라이언트 컴포넌트로 분리해서
// "지금 보고 있던 페이지로 돌아가기"용 next 파라미터를 붙인다.
export function LoginLink({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <Link
      href={`/login?next=${encodeURIComponent(pathname || "/")}`}
      className={className}
    >
      로그인
    </Link>
  );
}
