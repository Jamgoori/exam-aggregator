"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FlaskConical, X } from "lucide-react";

// "지금은 테스트 단계"라는 걸 처음 온 사람에게 한 번 알려주는 모달.
//
// 이 안내가 필요한 이유는 기능이 없어서가 아니라, 있는데 아직 덜 다듬어졌기
// 때문이다. 사용자는 오류를 만났을 때 "이 사이트는 원래 이런가 보다"라고 결론
// 내리고 조용히 떠난다. 미리 한 줄 말해두면 같은 오류가 "아직 만드는 중이구나"로
// 읽히고, 제보로도 돌아온다.
//
// 그래서 문구는 사과문이 아니라 현황 공유로 쓴다 — 무엇이 되는지(대부분 다 된다)를
// 먼저 말하고, 그다음에 무엇이 아직 불안정한지, 마지막으로 기록은 지켜진다는 것까지.
// 순서를 바꿔 "미완성입니다"부터 꺼내면 쓸 수 있는 기능까지 못 미더워 보인다.
//
// 정답·해설 확인 당부는 빼지 않는다. 시험 준비에 쓰는 자료라 틀린 정답 하나가
// 사용자에게는 실점으로 돌아온다. 면책 문구로 읽히지 않게 마지막에 담담히 둔다.
//
// 줄바꿈: 본문에 break-keep을 건다(review-guide-modal과 같은 이유). 없으면 한글이
// 글자 단위로 끊겨 조사만 다음 줄로 떨어진다.

// 안내 내용이 크게 바뀌면 이 값을 올린다 — "다시 보지 않기"를 눌렀던 사람에게도
// 새 안내는 한 번 더 보여줘야 하기 때문이다.
const NOTICE_VERSION = "1";
const DISMISS_KEY = "beta-notice-dismissed";
const SESSION_KEY = "beta-notice-closed";

// "다시 보지 않기"는 브라우저에 계속 남기고(localStorage), "닫기"는 이번 방문
// 동안만 접어둔다(sessionStorage). 닫기를 세션에도 안 남기면 페이지를 옮길 때마다
// 같은 모달이 다시 떠서 사이트를 못 쓴다.
function shouldShow(): boolean {
  try {
    if (window.localStorage.getItem(DISMISS_KEY) === NOTICE_VERSION) return false;
    if (window.sessionStorage.getItem(SESSION_KEY) === NOTICE_VERSION) return false;
    return true;
  } catch {
    // 시크릿 모드 등 저장소가 막힌 환경. 닫아도 계속 다시 뜨는 것보다 안 뜨는 쪽이 낫다.
    return false;
  }
}

function remember(storage: "local" | "session"): void {
  try {
    const target = storage === "local" ? window.localStorage : window.sessionStorage;
    target.setItem(storage === "local" ? DISMISS_KEY : SESSION_KEY, NOTICE_VERSION);
  } catch {
    // 무시: 저장이 안 되면 다음 방문에 한 번 더 뜰 뿐이다.
  }
}

export function BetaNoticeModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // CBT/복습 풀이 화면(몰입형)과 관리자 화면에는 띄우지 않는다 — 풀이 중에 뜨면
  // 시간을 재는 사람의 흐름을 끊고, 관리자는 이 안내의 대상이 아니다.
  const isBlockedPage =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "") ||
    /^\/admin(\/|$)/.test(pathname ?? "");

  useEffect(() => {
    if (isBlockedPage) return;
    if (!shouldShow()) return;
    // 첫 화면이 그려지고 나서 뜨게 한다. 페이지보다 모달이 먼저 보이면 무엇에
    // 대한 안내인지 모르는 채로 닫게 된다.
    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [isBlockedPage]);

  // 열려 있는 동안 뒤 화면 스크롤을 막고 Esc로 닫는다(다른 모달과 같은 규칙).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    remember("session");
    setOpen(false);
  }

  function dismissForever() {
    remember("local");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="테스트 기간 안내"
      onClick={close}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 print:hidden dark:bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel-in flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10"
      >
        {/* 모바일 바텀시트로 붙을 때의 손잡이. 데스크톱에서는 감춘다. */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-5 pt-4 pb-4 dark:border-zinc-800 dark:from-blue-950/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
            <FlaskConical size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold tracking-tight">
              공모아는 지금 테스트 중이에요
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              읽는 데 20초면 충분해요
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/70 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-4 pb-4 text-[13px] leading-relaxed break-keep text-zinc-600 text-pretty dark:text-zinc-300">
          <Item title="기능은 대부분 지금 그대로 쓸 수 있어요">
            기출문제 검색부터 CBT 풀이, 오답노트, 복습까지 준비된 기능은 모두 열려
            있어요. 회원가입 없이 볼 수 있는 자료도 그대로예요.
          </Item>

          <Item title="다만 아직 다듬는 중이라 어색한 곳이 있어요">
            문제·정답·해설이 원본과 다르거나, 화면이 잠깐 어긋나거나, 방금 되던 게
            잠시 안 될 수 있어요. 대부분 저희가 바로 고치는 중인 문제예요.
          </Item>

          <Item title="풀이 기록은 그대로 남아요">
            지금 푼 기록과 오답노트, 복습 일정은 정식 오픈 뒤에도 이어서 쓸 수
            있어요. 테스트 기간이라고 초기화하지 않아요.
          </Item>

          <Item title="이상한 걸 발견하면 알려주세요" last>
            잘못된 정답 하나, 깨진 화면 하나가 저희에게는 가장 큰 도움이에요.{" "}
            <a
              href="mailto:lks2354@gmail.com?subject=%EA%B3%B5%EB%AA%A8%EC%95%84%20%EC%98%A4%EB%A5%98%20%EC%A0%9C%EB%B3%B4"
              className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              문의 메일
            </a>
            로 한 줄만 보내주셔도 돼요.
          </Item>

          <p className="rounded-xl bg-zinc-50 px-3.5 py-3 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            시험 준비에 쓰이는 자료인 만큼, 중요한 정답과 해설은 시행처의 공식 발표
            자료로 한 번 더 확인해주세요.
          </p>
        </div>

        {/* 버튼 줄은 스크롤과 분리해 항상 보이게 둔다. 안내가 길어져도 닫는 방법을
            찾으려고 끝까지 내릴 일이 없어야 한다. */}
        <div className="flex gap-2 border-t border-zinc-100 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] dark:border-zinc-800">
          <button
            type="button"
            onClick={dismissForever}
            className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            다시 보지 않기
          </button>
          <button
            type="button"
            onClick={close}
            className="flex-[1.4] rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function Item({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? undefined : "border-b border-zinc-100 pb-4 dark:border-zinc-800"}>
      <p className="text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
