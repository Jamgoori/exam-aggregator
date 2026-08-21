"use client";

import Link from "next/link";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  kstDateKey,
} from "@gongmoa/core";
import { PROMO_SIZE } from "@/lib/attendance-promo-size";
import type { HomePopupContext, HomePopupControls, HomePopupSource } from "@/lib/home-popup";

// 홈에 뜨는 출석 이벤트 광고. 기업 이벤트 팝업과 같은 모양이다 — 광고 한 장 + 아래
// "오늘 하루 보지 않기 / 닫기" 두 버튼.
//
// 광고는 HTML 이 아니라 PNG 한 장이다(/attendance-promo.png, lib/attendance-promo-card.tsx).
// 이유는 그쪽 머리말에 있다. 여기서는 그 이미지를 띄우고 닫는 일만 한다.
//
// 이미지를 누르면 출석 화면으로 간다. 광고를 보고 마음이 움직인 사람이 "그래서
// 어디서 하지"를 스스로 찾게 두면 대부분 그냥 닫는다.
//
// 빈도(팝업 피로를 줄이는 두 겹):
//   - 방문(탭)당 한 번 — sessionStorage. 홈을 몇 번 오가도 그 방문에선 다시 안 뜬다.
//   - "오늘 하루 보지 않기" — localStorage 에 KST 날짜를 적는다. 그 날은 안 뜬다.
// "닫기"만 눌렀을 때 다음 방문에 한 번 더 뜨는 건 의도한 것이다. 그래서 성가신
// 사람을 위한 문이 "오늘 하루 보지 않기"다.
//
// 하루 경계는 출석 자체와 같은 KST 달력 날짜다(core 의 kstDateKey). 광고가 말하는
// "오늘"과 도장이 찍히는 "오늘"이 다르면 안 된다.
//
// 홈 팝업 슬라이드에서는 마지막 장이다 — 개발 중 안내·복습 유도가 먼저고, 이 광고는
// 그 뒤에 실린다(components/home-popup-slider.tsx).

const HIDDEN_KEY = "attendance-promo-hidden-day-v1";
const SHOWN_KEY = "attendance-promo-shown-v1";

// 시크릿 모드 등 저장소가 막힌 환경에서는 "이미 봤다"로 친다. 매번 뜨는 것보다 안
// 뜨는 쪽이 낫다(beta-notice-slide·review-nudge-slide 와 같은 판단).
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

export const attendancePromoSource: HomePopupSource = {
  id: "attendance-promo",
  resolve: ({ attendanceHref }: HomePopupContext) =>
    shouldSkip()
      ? null
      : {
          id: "attendance-promo",
          title: "출석체크 이벤트",
          // 그림 한 장이라 판이 이 비율을 지켜야 잘리지 않는다.
          aspect: PROMO_SIZE.width / PROMO_SIZE.height,
          // 눈앞에 온 순간에만 "이번 방문에 봤다"로 기록한다. 뒷장에 실려만 있다가
          // 못 보고 닫힌 경우에는 기록하지 않아 다음 방문에 다시 뜬다.
          onShown: markShown,
          body: (controls) => <AttendancePromoBody href={attendanceHref} {...controls} />,
          footer: (controls) => <AttendancePromoFooter {...controls} />,
        },
};

// 이미지는 화면낭독기·번역기·검색이 못 읽는다. 그림에 적힌 내용을 그대로 문장으로
// 옮겨두되, 숫자는 그림과 같은 출처(core)에서 받아 둘이 갈라지지 않게 한다.
const ALT = [
  "출석체크 이벤트.",
  `하루 ${ATTENDANCE_MIN_QUESTIONS}문항을 풀면 그날 출석으로 인정돼요.`,
  ATTENDANCE_MILESTONES.map((m) => `${m.days}일 출석 시 멤버십 ${m.grantDays}일`).join(", "),
  `— 한 달이면 멤버십 최대 ${ATTENDANCE_MONTHLY_MAX_DAYS}일 무료.`,
].join(" ");

function AttendancePromoBody({ href, close }: { href: string } & HomePopupControls) {
  return (
    <Link href={href} onClick={close} className="flex" aria-label={`${ALT} 출석 현황 보러 가기`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/attendance-promo.png"
        alt={ALT}
        width={PROMO_SIZE.width}
        height={PROMO_SIZE.height}
        // 크기를 안 주면 이미지가 도착하기 전까지 판이 납작하다가 툭 늘어난다. 그리는
        // 쪽과 같은 값을 써야(lib/attendance-promo-size.ts) 미리 잡아 둔 자리와 실제
        // 그림이 어긋나 위아래에 빈 띠가 생기지 않는다. 세로가 짧은 기기에서는 판 폭이
        // 이 비율만큼 함께 줄어들므로(home-popup-slider.tsx), 폭만 맞추면 높이는 언제나
        // 들어간다.
        className="w-full"
        style={{ aspectRatio: `${PROMO_SIZE.width} / ${PROMO_SIZE.height}` }}
      />
    </Link>
  );
}

// 이벤트 팝업의 관례대로 아래 띠에 두 버튼을 나란히 둔다. 왼쪽이 "오늘 하루
// 보지 않기", 오른쪽이 "닫기" — 위치를 바꾸면 습관적으로 누르던 사람이 원하지 않는
// 쪽을 누른다. 왼쪽은 이 장만 치우고 다음 장으로 넘어간다(뒤에 실린 안내는 남는다).
// break-keep — 세로가 짧은 기기에서는 판이 좁아지므로 "보지 않기"가 낱글자로 쪼개져
// 줄이 넘어간다. 어절 단위로만 넘기게 한다.
function AttendancePromoFooter({ close, dismiss }: HomePopupControls) {
  return (
    <div className="flex divide-x divide-zinc-200 border-t border-zinc-200 text-sm break-keep dark:divide-zinc-800 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => {
          markHiddenToday();
          dismiss();
        }}
        className="flex-1 py-3.5 text-zinc-500 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        오늘 하루 보지 않기
      </button>
      <button
        type="button"
        onClick={close}
        className="flex-1 py-3.5 font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        닫기
      </button>
    </div>
  );
}
