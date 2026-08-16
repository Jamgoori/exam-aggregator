"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";

// 로그아웃 서버 액션이 끝날 때까지 버튼이 아무 반응도 안 해서 "굼뜨다"고 느껴지던 문제를
// 없애기 위해, 클릭 즉시 pending 상태를 보여준다. useFormStatus는 부모 <form>의 상태를
// 읽어야 하므로 form 안에 들어가는 별도 클라이언트 컴포넌트로 분리했다.
//
// 자리는 헤더 맨 위가 아니라 계정 메뉴(데스크톱 드롭다운·모바일 서랍)의 맨 아래다 —
// 한 달에 한 번 누를까 말까 한 동작이 매일 쓰는 메뉴보다 눈에 띄면 안 된다. 그래서
// 모양도 다른 메뉴 줄과 같게 두고, 색은 hover 때만 붉게 들어온다(되돌리기 어려운
// 동작이라는 신호는 필요하지만, 평상시 시선을 끌 이유는 없다).
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/30 dark:hover:text-red-400"
    >
      <LogOut size={16} className="shrink-0" />
      {pending ? "로그아웃 중..." : "로그아웃"}
    </button>
  );
}
