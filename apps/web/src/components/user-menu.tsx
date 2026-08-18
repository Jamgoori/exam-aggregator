"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { signOutUser } from "@/app/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { ACCOUNT_NAV, avatarInitial } from "@/components/site-nav-items";

// 데스크톱 헤더 오른쪽의 계정 메뉴.
//
// 예전에는 헤더에 "닉네임 · 로그아웃" 두 개가 그대로 나와 있었다. 로그아웃은 한 달에
// 한 번 누를까 말까 한 동작인데 가장 눈에 띄는 자리를 차지하고, 정작 매일 쓰는
// AI 약점 진단·결제 내역·내 정보 수정으로는 마이페이지를 거쳐야만 갈 수 있었다.
// 그래서 이 드롭다운으로 계정 관련 항목을 전부 모으고, 로그아웃은 그 맨 아래로 내렸다.
//
// role="menu"를 쓰지 않는 이유: 그 역할을 붙이면 스크린리더 사용자는 화살표 키
// 이동을 기대하는데, 여기 항목은 전부 평범한 링크라 Tab 이동이 자연스럽다.
// 거짓 약속을 하느니 aria-expanded/aria-controls 로 "열고 닫는 패널"이라고만 알린다.
export function UserMenu({
  nickname,
  isAdmin = false,
  isPremium = false,
}: {
  nickname: string;
  isAdmin?: boolean;
  isPremium?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // 페이지가 바뀌어도 이 컴포넌트는 레이아웃에 살아남아 상태를 그대로 들고 있다.
  // 그래서 항목마다 onClick으로 직접 닫는다(아래) — 이동한 화면 위에 이전 메뉴가
  // 남아 있으면 클릭이 안 먹은 것처럼 보인다.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Esc로 닫았을 때는 키보드 포커스를 열었던 버튼으로 되돌려준다 — 안 그러면
      // 사라진 패널에 포커스가 남아 다음 Tab이 페이지 맨 앞으로 튄다.
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${nickname}님 계정 메뉴`}
        className={`flex h-9 items-center gap-2 rounded-full border py-1 pr-2 pl-1 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none ${
          open
            ? "border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30"
            : "border-zinc-200 hover:border-blue-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-zinc-800/60"
        }`}
      >
        <Avatar nickname={nickname} />
        {/* 태블릿 폭(md)에서는 메뉴 5개까지 한 줄에 들어가느라 남는 폭이 없다.
            닉네임은 lg부터 붙이고, 그 아래에서는 아바타만으로 계정 버튼임을 알린다
            (버튼 자체에 "○○님 계정 메뉴" aria-label이 붙어 있다). */}
        <span className="hidden max-w-[7rem] truncate text-sm font-medium text-zinc-700 lg:inline dark:text-zinc-200">
          {nickname}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-zinc-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="animate-modal-panel-in absolute right-0 top-full z-50 mt-2 w-60 origin-top-right overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        >
          <div className="flex items-center gap-2.5 border-b border-zinc-100 bg-gradient-to-b from-blue-50/70 to-transparent px-3.5 py-3 dark:border-zinc-800 dark:from-blue-950/25">
            <Avatar nickname={nickname} size="lg" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                {nickname}님
                {isPremium && <MembershipBadge />}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                오늘도 한 문제씩
              </p>
            </div>
          </div>

          <div className="p-1.5">
            {ACCOUNT_NAV.map((group, i) => (
              <div
                key={i}
                className={
                  i === 0
                    ? ""
                    : "mt-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-800"
                }
              >
                {group.map((item) => {
                  const active = item.match(pathname ?? "");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      }`}
                    >
                      <item.icon size={16} className="shrink-0 text-zinc-400" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}

            {isAdmin && (
              <div className="mt-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
                <Link
                  href="/admin/upload"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <ShieldCheck size={16} className="shrink-0 text-zinc-400" />
                  관리자 페이지
                </Link>
              </div>
            )}

            <div className="mt-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
              <form action={signOutUser}>
                <SignOutButton />
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 계정 메뉴·모바일 서랍에서 닉네임 옆에 붙이는 멤버십 배지. 체험 중인지 결제
// 회원인지는 여기서 구분하지 않는다 — "지금 유료 기능을 쓸 수 있는가" 하나만 본다.
export function MembershipBadge() {
  return (
    <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
      멤버십
    </span>
  );
}

// 프로필 사진을 받지 않는 서비스라 닉네임 첫 글자로 대신한다. 회색 원 하나보다
// 이쪽이 "내 계정"으로 훨씬 빨리 읽힌다.
export function Avatar({
  nickname,
  size = "md",
}: {
  nickname: string;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 font-bold text-white ${
        size === "lg" ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs"
      }`}
    >
      {avatarInitial(nickname)}
    </span>
  );
}
