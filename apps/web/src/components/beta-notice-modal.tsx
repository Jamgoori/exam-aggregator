"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarCheck, Hammer, MessageSquareWarning, Sparkles, X } from "lucide-react";
import { TRIAL_DAYS } from "@gongmoa/core";

// 로그인한 사람에게 딱 한 번 뜨는 "아직 개발 중" 안내.
//
// 지금 사이트는 화면과 기능이 계속 바뀌는 중이라, 아무 말 없이 두면 사용자는 그걸
// "미완성"이 아니라 "고장"으로 읽는다. 먼저 말해두면 같은 화면도 다르게 보이고,
// 오류를 만났을 때 그냥 나가는 대신 신고를 눌러준다.
//
// 두 번째 문단(멤버십 무료)이 이 모달의 진짜 용건이다. 잠긴 기능을 만나기 전에
// "지금은 다 열려 있다"를 알려야, 잠금 아이콘을 보고 지레 발길을 돌리지 않는다.
//
// 로그인 콜백에 붙이지 않고 레이아웃에 두는 이유: 콜백은 원래 보던 곳으로 되돌려
// 보내기만 하므로(auth/callback), 로그인 직후 어느 화면에 떨어지든 이 안내가 한 번은
// 지나가야 한다. 대신 "한 번"은 브라우저에 기록해서 지킨다.
//
// 문구를 바꾸거나 다시 띄우고 싶으면 STORAGE_KEY 의 버전을 올린다 — 그러면 이미 본
// 사람에게도 새 안내가 한 번 더 뜬다.

const STORAGE_KEY = "beta-notice-seen-v1";

// 한 박자 늦게 띄운다. 화면이 그려지는 순간 같이 덮으면 사용자가 뭘 열었는지도 모르는
// 채로 닫기부터 누른다 — 로그인해서 도착한 화면을 먼저 보게 두는 것.
const OPEN_DELAY_MS = 500;

function seen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // 시크릿 모드 등 localStorage 가 막힌 환경. 매번 뜨는 것보다 안 뜨는 쪽이 낫다
    // (review-nudge-modal 과 같은 판단).
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // 무시: 기록이 안 되면 다음 방문에 한 번 더 뜰 뿐이다.
  }
}

export function BetaNoticeModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 풀이 화면(CBT·섞어풀기·복습)은 자체 UI로 화면을 꽉 쓰는 몰입형이라 띄우지 않는다.
  // 시험처럼 시간을 재며 푸는 중에 안내가 덮이면 그 회차를 통째로 망친다.
  // 판별 규칙은 site-header-gate.tsx·review-fab.tsx 와 같다.
  const immersive =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");

  useEffect(() => {
    if (immersive || seen()) return;
    const id = window.setTimeout(() => {
      // 띄우는 순간 "봤다"로 기록한다. 닫기를 안 누르고 나가도 다시 뜨면 안 된다.
      markSeen();
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [immersive]);

  // 열려 있는 동안 뒤 화면 스크롤을 막고 Esc 로 닫는다(다른 모달과 같은 규칙).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="개발 중 안내"
      onClick={() => setOpen(false)}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel-in flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10"
      >
        {/* 모바일에서 아래에서 올라온 판이라는 걸 알리는 손잡이 */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-5 pt-4 pb-4 dark:border-zinc-800 dark:from-blue-950/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
            <Hammer size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
              개발 중
            </span>
            <h3 className="mt-1 text-[15px] font-bold tracking-tight break-keep">
              공모아는 아직 만드는 중이에요
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="닫기"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/70 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4 text-[13px] leading-[1.75] break-keep text-zinc-600 dark:text-zinc-300">
          <p className="text-pretty">
            화면과 기능이 <B>거의 매일 바뀌고</B> 있어요. 그러다 보니 가끔 어색한 부분이나
            오류가 보일 수 있어요.
          </p>
          <p className="mt-2 text-pretty">
            이상한 걸 발견하면 문항 아래{" "}
            <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-baseline text-[12px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <MessageSquareWarning size={11} />
              오류 신고
            </span>
            로 알려주세요. 보이는 대로 고치고 있어요.
          </p>

          {/* 이 모달의 용건. 위 안내와 같은 톤으로 흘려보내지 않고 색 있는 판으로
              띄운다 — 잠긴 기능을 만나기 전에 이 문장을 봐야 의미가 있다. */}
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-emerald-900 dark:text-emerald-200">
              <Sparkles size={15} className="shrink-0" />
              멤버십 기능, 지금은 전부 무료예요
            </p>
            <p className="mt-1.5 text-[13px] text-pretty text-emerald-800/90 dark:text-emerald-300/80">
              가입하는 순간부터 <B tone="emerald">{TRIAL_DAYS}일</B> 동안 멤버십 전체가
              열려요. 카드 등록도 없고, 기간이 끝나도 자동으로 결제되지 않아요.
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] text-emerald-900/85 dark:text-emerald-200/85">
              <Perk icon={<BookOpen size={13} />}>문제지 해설 제한 없이 보기</Perk>
              <Perk icon={<CalendarCheck size={13} />}>오늘의 복습 — 잊을 때쯤 다시 풀기</Perk>
              <Perk icon={<Sparkles size={13} />}>오답노트 안에서 바로 해설 보기</Perk>
            </ul>
          </div>

          <p className="mt-3.5 text-center text-[12px] text-zinc-500 dark:text-zinc-500">
            <Link
              href="/membership"
              onClick={() => setOpen(false)}
              className="underline underline-offset-2 hover:text-blue-600 dark:hover:text-blue-400"
            >
              멤버십으로 뭐가 열리는지 보기
            </Link>
          </p>
        </div>

        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            알겠어요
          </button>
        </div>
      </div>
    </div>
  );
}

function B({ children, tone }: { children: React.ReactNode; tone?: "emerald" }) {
  return (
    <span
      className={
        tone === "emerald"
          ? "font-bold text-emerald-900 dark:text-emerald-100"
          : "font-bold text-zinc-900 dark:text-zinc-100"
      }
    >
      {children}
    </span>
  );
}

function Perk({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400">{icon}</span>
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
    </li>
  );
}
