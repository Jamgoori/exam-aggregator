"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Menu, ShieldCheck, X } from "lucide-react";
import { signOutUser } from "@/app/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginLink } from "@/components/login-link";
import { Avatar, MembershipBadge } from "@/components/user-menu";
import { ACCOUNT_NAV, PRIMARY_NAV } from "@/components/site-nav-items";

// 모바일 메뉴(햄버거 → 오른쪽에서 밀려 나오는 서랍).
//
// 좁은 화면에 메뉴 5개를 가로로 늘어놓으면 글자가 겹치거나 가로 스크롤이 생긴다.
// 그렇다고 예전처럼 "닉네임 + 로그아웃"만 놔두면 시험별·과목별·멤버십으로 가는 길이
// 푸터 링크밖에 없다. 서랍은 그 둘을 다 푼다 — 헤더는 아이콘 하나만 쓰고, 열면
// 사이트의 모든 입구가 한 화면에 보인다.
export function MobileNav({
  user,
}: {
  user: { nickname: string; isAdmin: boolean; isPremium: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="메뉴 열기"
        className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Menu size={20} />
      </button>

      {open && (
        <MobileNavDrawer
          user={user}
          onClose={() => {
            setOpen(false);
            // 서랍이 사라진 자리에 포커스를 남기지 않는다 — 키보드/스크린리더
            // 사용자가 닫자마자 페이지 맨 앞으로 튕기지 않게 햄버거로 돌려준다.
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function MobileNavDrawer({
  user,
  onClose,
}: {
  user: { nickname: string; isAdmin: boolean; isPremium: boolean } | null;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);

  // 열려 있는 동안 뒤 화면 스크롤을 막고 Esc로 닫는다(사이트의 다른 모달과 같은 규칙).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 이 서랍은 사용자가 햄버거를 누른 뒤에만(=하이드레이션 이후) 렌더되므로 서버
  // 렌더에서 document를 만질 일이 없다. 그래서 마운트 여부를 따로 재지 않는다.
  //
  // 헤더(sticky z-30)는 자체 쌓임 맥락을 만든다 — 그 안에서 z-50을 줘도 헤더 바깥의
  // z-40 요소(복습 FAB, 오답 정리 바)보다 아래로 깔린다. 그래서 body로 포털을 뺀다.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="사이트 메뉴"
      className="animate-modal-fade-in fixed inset-0 z-50 flex justify-end bg-zinc-900/40 backdrop-blur-sm dark:bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-drawer-in flex h-full w-[86%] max-w-[20rem] flex-col bg-white shadow-2xl dark:bg-zinc-900"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <Link href="/" onClick={onClose} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#12b382] text-white">
              <GraduationCap size={18} />
            </span>
            <span className="text-lg font-bold dark:text-zinc-100">
              공<span className="text-[#12b382]">모아</span>
            </span>
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="메뉴 닫기"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={19} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {user ? (
            <Link
              href="/mypage"
              onClick={onClose}
              className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-50/30 px-3.5 py-3 transition-colors hover:from-blue-100/80 dark:from-blue-950/40 dark:to-blue-950/10 dark:hover:from-blue-950/60"
            >
              <Avatar nickname={user.nickname} size="lg" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                  {user.nickname}님
                  {user.isPremium && <MembershipBadge />}
                </p>
                <p className="text-[11px] text-blue-600 dark:text-blue-400">
                  마이페이지 보기
                </p>
              </div>
            </Link>
          ) : (
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-blue-50/30 px-3.5 py-3.5 dark:from-blue-950/40 dark:to-blue-950/10">
              <p className="text-[13px] font-medium text-pretty text-zinc-600 dark:text-zinc-300">
                로그인하면 틀린 문제가 오답노트에 자동으로 쌓여요.
              </p>
              <LoginLink
                onClick={onClose}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              />
            </div>
          )}

          <SectionLabel>메뉴</SectionLabel>
          <nav className="flex flex-col gap-0.5">
            {PRIMARY_NAV.map((item) => {
              const active = item.match(pathname ?? "");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    onClose();
                    // 기출문제 목록(/papers)에서 여러 페이지째 보고 있을 때 같은
                    // 항목을 다시 누르면 1페이지로 되돌린다. 목록의 페이지 상태는
                    // history.replaceState로만 URL과 동기화될 뿐 Next 라우터가 모르는
                    // 값이라, 같은 주소로의 Link는 아무 리렌더도 일으키지 않는다
                    // (exam-browser.tsx 의 gongmoa:browser-reset 리스너).
                    if (item.href === "/papers" && window.location.pathname === "/papers") {
                      window.history.replaceState(null, "", "/papers");
                      window.dispatchEvent(new Event("gongmoa:browser-reset"));
                    }
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                    active
                      ? "bg-blue-50 dark:bg-blue-950/40"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <item.icon
                    size={18}
                    className={
                      active
                        ? "shrink-0 text-blue-600 dark:text-blue-400"
                        : "shrink-0 text-zinc-400"
                    }
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${
                        active ? "text-blue-700 dark:text-blue-300" : ""
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                        {item.hint}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>

          {user && (
            <>
              <SectionLabel>내 학습·계정</SectionLabel>
              <nav className="flex flex-col gap-0.5">
                {ACCOUNT_NAV.flat().map((item) => {
                  const active = item.match(pathname ?? "");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <item.icon size={17} className="shrink-0 text-zinc-400" />
                      {item.label}
                    </Link>
                  );
                })}
                {user.isAdmin && (
                  <Link
                    href="/admin/upload"
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <ShieldCheck size={17} className="shrink-0 text-zinc-400" />
                    관리자 페이지
                  </Link>
                )}
              </nav>
            </>
          )}
        </div>

        {user && (
          <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <form action={signOutUser}>
              <SignOutButton />
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 mb-1.5 px-3 text-[11px] font-bold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
      {children}
    </p>
  );
}
