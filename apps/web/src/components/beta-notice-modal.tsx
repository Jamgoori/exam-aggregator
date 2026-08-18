"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarCheck,
  FileText,
  Hammer,
  MessageSquareWarning,
  Sparkles,
  X,
} from "lucide-react";
import { TRIAL_DAYS } from "@gongmoa/core";
import { claimHomePopup } from "@/lib/home-popup";

// 홈에 들어왔을 때 뜨는 "아직 개발 중" 안내. 로그인 여부는 보지 않는다 —
// 처음 들른 비회원일수록 "화면이 계속 바뀐다"와 "지금은 전부 무료"를 먼저 알아야
// 미완성 화면을 고장으로 읽지 않고, 가입할 이유도 그 자리에서 보인다.
//
// 지금 사이트는 화면과 기능이 계속 바뀌는 중이라, 아무 말 없이 두면 사용자는 그걸
// "미완성"이 아니라 "고장"으로 읽는다. 먼저 말해두면 같은 화면도 다르게 보이고,
// 오류를 만났을 때 그냥 나가는 대신 신고를 눌러준다.
//
// 두 번째 문단(멤버십 무료)이 이 모달의 진짜 용건이다. 잠긴 기능을 만나기 전에
// "지금은 다 열려 있다"를 알려야, 잠금 아이콘을 보고 지레 발길을 돌리지 않는다.
//
// 뜨는 자리는 홈뿐이다(app/page.tsx). 문제지·풀이 화면에서 덮으면 하려던 일을
// 끊는 셈이고, 홈은 어차피 대부분이 거쳐 가는 입구라 안내가 닿는다.
//
// 빈도는 두 겹으로 잡는다:
//   - 방문(탭)당 한 번 — sessionStorage. 홈을 몇 번 오가도 그 방문에선 다시 안 뜬다.
//   - "다음부터 보지 않기" 를 누르면 영영 안 뜬다 — localStorage.
// 닫기만 눌렀을 때 다음 방문에 한 번 더 뜨는 건 의도한 것이다. 안 읽고 닫은 사람에게
// 멤버십이 무료라는 말이 한 번은 더 가야 한다. 그게 성가신 사람을 위한 문이
// "다음부터 보지 않기" 다.
//
// 문구를 바꿔서 이미 끈 사람에게도 다시 알리고 싶으면 아래 키의 버전을 올린다.

const HIDDEN_KEY = "beta-notice-hidden-v1";
const SHOWN_KEY = "beta-notice-shown-v1";

// 한 박자 늦게 띄운다. 화면이 그려지는 순간 같이 덮으면 사용자가 뭘 열었는지도 모르는
// 채로 닫기부터 누른다 — 도착한 화면을 먼저 보게 두는 것.
const OPEN_DELAY_MS = 500;

// 시크릿 모드 등 저장소가 막힌 환경에서는 "이미 봤다"로 친다. 매번 뜨는 것보다 안 뜨는
// 쪽이 낫다(review-nudge-modal 과 같은 판단).
function shouldSkip(): boolean {
  try {
    return (
      window.localStorage.getItem(HIDDEN_KEY) === "1" ||
      window.sessionStorage.getItem(SHOWN_KEY) === "1"
    );
  } catch {
    return true;
  }
}

function markShown(): void {
  try {
    window.sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // 무시: 기록이 안 되면 다음에 한 번 더 뜰 뿐이다.
  }
}

function markHidden(): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, "1");
  } catch {
    // 무시: 끄지 못해도 방문당 한 번이라는 상한은 그대로다.
  }
}

export function BetaNoticeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (shouldSkip()) return;
    const id = window.setTimeout(() => {
      // 홈 팝업은 한 화면에 하나만 뜬다(lib/home-popup.ts). 자리를 못 잡으면 아무
      // 기록도 남기지 않고 물러나, 다음 방문에 다시 기회를 얻는다.
      if (!claimHomePopup()) return;
      // 띄우는 순간 "이번 방문에 봤다"로 기록한다. 닫기를 안 누르고 다른 데로 가도
      // 홈에 돌아올 때마다 다시 뜨면 안 된다.
      markShown();
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

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

  function dismissForever() {
    markHidden();
    setOpen(false);
  }

  // z-[60] — 홈에는 복습 유도 모달(review-nudge-modal, z-50)도 뜬다. 둘이 겹치는 날엔
  // 이쪽이 위에 와야 한다: 한 번 보고 마는 안내를 먼저 치워야 아래 것이 보인다.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="개발 중 안내"
      onClick={() => setOpen(false)}
      className="animate-modal-fade-in fixed inset-0 z-[60] flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
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
          {/* 두 문장을 한 문단에 붙이면 좁은 폭에서 "그러다"가 첫 줄 끝에 혼자 남는다.
              <br> 대신 문단을 나누는 건, 글자 크기를 키운 사용자에게도 두 번째 문장이
              언제나 새 줄에서 시작하게 하려는 것 — 줄바꿈 위치를 폭에 맡기지 않는다. */}
          <p className="text-pretty">
            만들어가는 중이라 <B>화면과 기능이 바뀔 수 있어요.</B>
          </p>
          <p className="mt-1 text-pretty">
            그러다 보니 가끔 어색한 부분이나 오류가 보일 수 있어요.
          </p>

          {/* 자료가 비어 보이는 건 사이트가 부실한 게 아니라 아직 올리는 중이라는 뜻이다.
              이 말이 없으면 찾던 시험지가 없을 때 그대로 나가고 다시 안 온다. */}
          <p className="mt-3 flex gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-pretty dark:bg-zinc-800/50">
            <FileText size={14} className="mt-1 shrink-0 text-blue-500 dark:text-blue-400" />
            <span>
              <B>기출문제와 해설도 계속 올라오는 중</B>이에요. 지금 안 보이는 시험지나
              해설도 차례로 채워지고 있으니 조금만 기다려 주세요.
            </span>
          </p>

          <p className="mt-3 text-pretty">
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
              열려요.
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] text-emerald-900/85 dark:text-emerald-200/85">
              <Perk icon={<BookOpen size={13} />}>문제지 해설 제한 없이 보기</Perk>
              <Perk icon={<CalendarCheck size={13} />}>오늘의 복습 — 잊을 때쯤 다시 풀기</Perk>
              <Perk icon={<Sparkles size={13} />}>오답노트 안에서 바로 해설 보기</Perk>
            </ul>
          </div>
        </div>

        {/* "다음부터 보지 않기"를 체크박스가 아니라 버튼으로 둔다. 체크박스는 누른 뒤
            닫기까지 두 번 눌러야 하고, 안 누르고 닫으면 아무 일도 안 일어난다.
            폭은 확인 버튼에 양보한다 — 대부분은 읽고 닫는 쪽이다. */}
        <div className="flex gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={dismissForever}
            className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            다음부터 보지 않기
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-[1.2] rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
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
