"use client";

import Link from "next/link";
import { BrainCircuit, FileCheck2, NotebookPen, Sparkles } from "lucide-react";
import { FREE_UNTIL_LABEL, isFreeForAll, kstDateKey } from "@gongmoa/core";
import type { HomePopupContext, HomePopupControls, HomePopupSource } from "@/lib/home-popup";

// 홈에 뜨는 "전면 무료" 이벤트 팝업 — 비회원 전용, 홈 팝업 슬라이드의 첫 장.
//
// 왜 비회원에게만 띄우는가: 이 장이 파는 것은 "가입"이다. 이미 로그인한 사람에게는
// 이벤트가 이미 적용돼 있어서(계정 상태와 무관하게 열린다 — core 의 isFreeForAll)
// 누를 것이 없는 광고가 되고, 정작 필요한 안내(복습 유도)를 한 칸 뒤로 민다.
// 회원에게 이벤트를 알리는 자리는 마이페이지 멤버십 칸과 /membership 이다.
//
// 왜 개발 중 안내(beta-notice)와 따로 두는가: 그쪽은 "미완성이라 화면이 바뀐다"는
// 양해를 구하는 글이라 톤이 조용해야 하고, 이 장은 반대로 눈에 띄어야 한다. 한 장에
// 합치면 둘 중 하나가 반드시 죽는다. 대신 beta-notice 의 멤버십 문단은 이 이벤트를
// 가리키게 줄여 뒀다(같은 말을 두 장에서 길게 반복하지 않게).
//
// 기간이 끝나면(FREE_UNTIL 이 지나면) resolve 가 null 을 돌려줘 이 장은 저절로
// 사라진다 — 배포로 걷어내지 않아도 옛 이벤트를 광고하는 일이 없다.
//
// 빈도(팝업 피로를 줄이는 두 겹) — 출석 광고와 같은 방식:
//   - 방문(탭)당 한 번 — sessionStorage. 홈을 몇 번 오가도 그 방문에선 다시 안 뜬다.
//   - "오늘 하루 보지 않기" — localStorage 에 KST 날짜. 그 날은 안 뜬다.
// 영구 숨김을 두지 않은 건 이벤트가 기간 한정이라서다. 오늘 지나친 사람에게 내일
// 한 번 더 닿아야 하고, 어차피 이벤트가 끝나면 장 자체가 없어진다.

const HIDDEN_KEY = "free-promo-hidden-day-v1";
const SHOWN_KEY = "free-promo-shown-v1";

// 시크릿 모드 등 저장소가 막힌 환경에서는 "이미 봤다"로 친다. 매번 뜨는 것보다 안
// 뜨는 쪽이 낫다(beta-notice-slide·attendance-promo-slide 와 같은 판단).
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

export const freePromoSource: HomePopupSource = {
  id: "free-promo",
  resolve: ({ signedIn }: HomePopupContext) =>
    signedIn || !isFreeForAll() || shouldSkip()
      ? null
      : {
          id: "free-promo",
          title: "전면 무료 이벤트",
          // 히어로가 짙은 색이라 판의 닫기(X)를 반투명 칩으로 띄우고, 광고 장이라
          // 판도 한 단계 넓게 쓴다(lib/home-popup.ts).
          darkHeader: true,
          wide: true,
          onShown: markShown,
          body: () => <FreePromoBody />,
          footer: (controls) => <FreePromoFooter {...controls} />,
        },
};

function FreePromoBody() {
  return (
    <>
      {/* 히어로. 판(흰 배경) 위에 색을 통째로 덮어 첫인상을 바꾼다 — 이 장은
          "읽어주세요"가 아니라 "이건 놓치면 손해다"를 먼저 말해야 한다.
          pr-12 는 판 오른쪽 위 닫기(X) 자리. */}
      <div className="promo-hero relative overflow-hidden bg-[linear-gradient(135deg,#1e3a8a_0%,#4338ca_45%,#7e22ce_100%)] px-5 pt-5 pr-12 pb-6 text-white">
        {/* 배경 장식(빛 번짐). 글자 뒤에서만 은은하게 돌고 내용에는 닿지 않는다. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-fuchsia-400/25 blur-2xl"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-sky-300/20 blur-2xl"
        />

        <span className="relative inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-extrabold tracking-wide ring-1 ring-white/25 backdrop-blur-sm">
          <Sparkles size={12} />
          기간 한정 이벤트
        </span>

        {/* 숫자가 주인공이라 크기를 몰아준다. 뷰포트에 맞춰 줄여 좁은 폰에서도
            "전면 무료"가 한 줄에 남게 한다(줄바꿈이 숫자와 단어 사이에 끼면
            문장이 아니라 조각으로 읽힌다). */}
        <p className="relative mt-3 text-[clamp(1.5rem,7.5vw,2rem)] leading-[1.15] font-black tracking-tight break-keep">
          <span className="promo-shine bg-[linear-gradient(100deg,#fff_35%,#fde68a_50%,#fff_65%)] bg-clip-text text-transparent">
            {FREE_UNTIL_LABEL}까지
          </span>
          <br />
          멤버십 <span className="text-amber-300">전면 무료</span>
        </p>

        <p className="relative mt-2.5 text-[13px] leading-[1.7] text-pretty text-white/85">
          결제도 카드 등록도 없어요. <b className="font-bold text-white">가입만 하면</b>{" "}
          유료 기능이 전부 열립니다.
        </p>
      </div>

      {/* 무엇이 열리는지. 이벤트 문구만 있고 내용이 없으면 "무료로 뭘 준다는
          거지"에서 멈춘다 — 셋 다 이 사이트에 다시 올 이유가 되는 기능이다. */}
      <div className="flex flex-col gap-2 px-5 pt-4 pb-4">
        <Perk
          icon={<BrainCircuit size={16} />}
          tone="violet"
          title="AI 약점 진단"
          desc="내가 틀린 문항을 개념 단위로 모아 약한 곳과 극복법까지 짚어줘요."
        />
        <Perk
          icon={<NotebookPen size={16} />}
          tone="blue"
          title="오답노트 · 오늘의 복습"
          desc="틀린 문제를 잊을 때쯤 다시 꺼내줘요. 해설도 그 자리에서 바로."
        />
        <Perk
          icon={<FileCheck2 size={16} />}
          tone="emerald"
          title="2026년 최신 해설 배포 중"
          desc="올해 시험까지 문항별 해설을 계속 올리고 있어요."
          badge="NEW"
        />
      </div>
    </>
  );
}

const TONES = {
  violet:
    "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  emerald:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
} as const;

function Perk({
  icon,
  tone,
  title,
  desc,
  badge,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100">
          {title}
          {badge && (
            <span className="rounded bg-rose-500 px-1.5 py-px text-[9px] font-extrabold tracking-wide text-white">
              {badge}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-[1.6] text-pretty text-zinc-600 dark:text-zinc-400">
          {desc}
        </p>
      </div>
    </div>
  );
}

// 오른쪽(주요) 버튼은 가입으로 보낸다. 이 장의 용건이 그것이고, 비회원에게만 뜨므로
// 로그인 화면이 아니라 가입 화면이 맞다(계정이 없는 사람에게 로그인 화면은 막다른 길).
// 왼쪽은 이 장만 오늘 하루 치운다 — 뒤에 실린 다른 안내까지 같이 없애지 않는다.
function FreePromoFooter({ close, dismiss }: HomePopupControls) {
  return (
    <div className="flex gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => {
          markHiddenToday();
          dismiss();
        }}
        className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        오늘 하루 보지 않기
      </button>
      <Link
        href="/signup"
        onClick={close}
        className="promo-cta flex flex-[1.4] items-center justify-center rounded-xl bg-[linear-gradient(100deg,#4338ca,#7e22ce)] py-2.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/30 transition-transform hover:scale-[1.02] active:scale-[0.99]"
      >
        3초 만에 무료로 시작하기
      </Link>
    </div>
  );
}
