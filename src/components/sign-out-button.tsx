"use client";

import { useFormStatus } from "react-dom";

// 로그아웃 서버 액션이 끝날 때까지 버튼이 아무 반응도 안 해서 "굼뜨다"고 느껴지던 문제를
// 없애기 위해, 클릭 즉시 pending 상태를 보여준다. useFormStatus는 부모 <form>의 상태를
// 읽어야 하므로 form 안에 들어가는 별도 클라이언트 컴포넌트로 분리했다.
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "로그아웃 중..." : "로그아웃"}
    </button>
  );
}
