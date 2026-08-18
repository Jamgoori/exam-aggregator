"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  kstDateKey,
} from "@gongmoa/core";
import { claimHomePopup } from "@/lib/home-popup";

// 홈에 뜨는 출석 이벤트 팝업. 기업 이벤트 팝업과 같은 모양이다 — 광고 한 장 + 아래
// "오늘 하루 보지 않기 / 닫기" 두 버튼.
//
// 광고는 HTML 이 아니라 PNG 한 장이다(/attendance-promo.png, lib/attendance-promo-card.tsx).
// 이유는 그쪽 머리말에 있다. 여기서는 그 이미지를 띄우고 닫는 일만 한다.
//
// 이미지를 누르면 출석 화면으로 간다. 광고를 보고 마음이 움직인 사람이 "그래서
// 어디서 하지"를 스스로 찾게 두면 대부분 그냥 닫는다.
//
// 빈도(팝업 피로를 줄이는 세 겹):
//   - 방문(탭)당 한 번 — sessionStorage. 홈을 몇 번 오가도 그 방문에선 다시 안 뜬다.
//   - "오늘 하루 보지 않기" — localStorage 에 KST 날짜를 적는다. 그 날은 안 뜬다.
//   - 홈 팝업은 한 화면에 하나만(claimHomePopup). 개발 중 안내·복습 유도와 겹치면
//     물러나고, 물러날 때는 아무 기록도 남기지 않아 다음 방문에 다시 기회를 얻는다.
// "닫기"만 눌렀을 때 다음 방문에 한 번 더 뜨는 건 의도한 것이다. 그래서 성가신
// 사람을 위한 문이 "오늘 하루 보지 않기"다.
//
// 하루 경계는 출석 자체와 같은 KST 달력 날짜다(core 의 kstDateKey). 팝업이 말하는
// "오늘"과 도장이 찍히는 "오늘"이 다르면 안 된다.

const HIDDEN_KEY = "attendance-promo-hidden-day-v1";
const SHOWN_KEY = "attendance-promo-shown-v1";

// 개발 중 안내(500ms)보다 늦게 잡는다. 둘 다 뜰 수 있는 첫 방문에서는 처음 온
// 사람에게 "지금은 전부 무료"가 먼저 닿아야 하고, 이 광고는 다음 방문에 뜬다.
const OPEN_DELAY_MS = 900;

// 시크릿 모드 등 저장소가 막힌 환경에서는 "이미 봤다"로 친다. 매번 뜨는 것보다 안
// 뜨는 쪽이 낫다(beta-notice-modal·review-nudge-modal 과 같은 판단).
function shouldSkip(): boolean {
  try {
    return (
      window.localStorage.getItem(HIDDEN_KEY) === kstDateKey() ||
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

function markHiddenToday(): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, kstDateKey());
  } catch {
    // 무시: 못 꺼도 방문당 한 번이라는 상한은 그대로다.
  }
}

export function AttendancePromoModal({ href }: { href: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (shouldSkip()) return;
    const id = window.setTimeout(() => {
      // 자리를 못 잡으면 아무 기록도 남기지 않고 물러난다 — 다음 방문에 다시 기회.
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

  // 이미지는 화면낭독기·번역기·검색이 못 읽는다. 그림에 적힌 내용을 그대로 문장으로
  // 옮겨두되, 숫자는 그림과 같은 출처(core)에서 받아 둘이 갈라지지 않게 한다.
  const alt = [
    "출석체크 이벤트.",
    `하루 ${ATTENDANCE_MIN_QUESTIONS}문항을 풀면 그날 출석으로 인정돼요.`,
    ATTENDANCE_MILESTONES.map((m) => `${m.days}일 출석 시 멤버십 ${m.grantDays}일`).join(", "),
    `— 한 달이면 멤버십 최대 ${ATTENDANCE_MONTHLY_MAX_DAYS}일 무료.`,
  ].join(" ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="출석체크 이벤트"
      onClick={() => setOpen(false)}
      // z-[55] — 개발 중 안내(z-60)보다 아래, 복습 유도(z-50)보다 위. 셋이 겹치는
      // 일은 claimHomePopup 이 막지만, 순서 자체는 겹쳤을 때를 대비해 정해 둔다.
      className="animate-modal-fade-in fixed inset-0 z-[55] flex items-end justify-center bg-zinc-900/50 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // 세로가 짧은 기기(가로로 든 폰·작은 창)에서 광고가 화면보다 길어지면 아래
        // 두 버튼이 화면 밖으로 밀려 닫을 방법이 사라진다. 그래서 높이를 화면에 묶되,
        // 줄이는 건 높이가 아니라 **폭**이다 — 광고가 4:5(720×900)라 폭을 그 비율로
        // 함께 줄여야 좌우에 흰 여백이 생기지 않는다(여백이 생기면 이미지 위에 얹은
        // 닫기 버튼이 그림 밖에 떠서 어긋나 보인다). 0.8 = 720/900, 3.5rem 은 아래
        // 버튼 띠의 높이다.
        className="animate-modal-panel-in flex max-h-[92dvh] w-full max-w-[min(360px,calc((92dvh-3.5rem)*0.8))] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl dark:bg-zinc-900"
      >
        {/* 닫기(X)를 이미지 위에 얹는다. 광고가 화면을 다 먹는 팝업에서 X 가 안
            보이면, 사용자는 갇혔다고 느끼고 뒤로가기로 사이트를 뜬다. */}
        <div className="relative flex min-h-0">
          <Link
            href={href}
            onClick={() => setOpen(false)}
            className="flex min-h-0 w-full"
            aria-label={`${alt} 출석 현황 보러 가기`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/attendance-promo.png"
              alt={alt}
              width={720}
              height={900}
              // 폭에 맞춰 줄어들되 비율은 고정 — 크기를 안 주면 이미지가 도착하기
              // 전까지 판이 납작하다가 툭 늘어난다. 화면이 짧으면 높이 쪽이 먼저
              // 막히므로 object-contain 으로 비율을 지키며 더 줄어든다.
              className="max-h-full w-full object-contain"
              style={{ aspectRatio: "720 / 900" }}
            />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="닫기"
            className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-sm transition-colors hover:bg-black/45"
          >
            <X size={18} />
          </button>
        </div>

        {/* 이벤트 팝업의 관례대로 아래 띠에 두 버튼을 나란히 둔다. 왼쪽이 "오늘 하루
            보지 않기", 오른쪽이 "닫기" — 위치를 바꾸면 습관적으로 누르던 사람이
            원하지 않는 쪽을 누른다. */}
        {/* pb-[env(safe-area-inset-bottom)] — 아이폰에서 판이 화면 바닥에 붙으므로
            홈 인디케이터가 "닫기" 위에 겹친다. 그만큼 아래를 비워 둔다. */}
        <div className="flex shrink-0 divide-x divide-zinc-200 border-t border-zinc-200 pb-[env(safe-area-inset-bottom)] text-sm sm:pb-0 dark:divide-zinc-800 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => {
              markHiddenToday();
              setOpen(false);
            }}
            className="flex-1 py-3.5 text-zinc-500 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            오늘 하루 보지 않기
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 py-3.5 font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
