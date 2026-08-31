"use client";

import {
  BookOpen,
  CalendarCheck,
  FileText,
  Hammer,
  MessageSquareWarning,
  Sparkles,
} from "lucide-react";
import { FREE_UNTIL_LABEL, isFreeForAll, TRIAL_DAYS } from "@gongmoa/core";
import type { HomePopupControls, HomePopupSource } from "@/lib/home-popup";

// 홈에 들어왔을 때 뜨는 "아직 개발 중" 안내. 로그인 여부는 보지 않는다 —
// 처음 들른 비회원일수록 "화면이 계속 바뀐다"와 "지금은 전부 무료"를 먼저 알아야
// 미완성 화면을 고장으로 읽지 않고, 가입할 이유도 그 자리에서 보인다.
//
// 지금 사이트는 화면과 기능이 계속 바뀌는 중이라, 아무 말 없이 두면 사용자는 그걸
// "미완성"이 아니라 "고장"으로 읽는다. 먼저 말해두면 같은 화면도 다르게 보이고,
// 오류를 만났을 때 그냥 나가는 대신 신고를 눌러준다.
//
// 두 번째 문단(멤버십 무료)이 이 안내의 진짜 용건이다. 잠긴 기능을 만나기 전에
// "지금은 다 열려 있다"를 알려야, 잠금 아이콘을 보고 지레 발길을 돌리지 않는다.
//
// 뜨는 자리는 홈뿐이다(app/page.tsx). 문제지·풀이 화면에서 덮으면 하려던 일을
// 끊는 셈이고, 홈은 어차피 대부분이 거쳐 가는 입구라 안내가 닿는다. 홈 팝업 슬라이드의
// 한 장으로 실린다 — 판을 띄우고 넘기는 일은 components/home-popup-slider.tsx 가 한다.
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

// 시크릿 모드 등 저장소가 막힌 환경에서는 "이미 봤다"로 친다. 매번 뜨는 것보다 안 뜨는
// 쪽이 낫다(review-nudge-slide 와 같은 판단).
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

export const betaNoticeSource: HomePopupSource = {
  id: "beta-notice",
  resolve: () =>
    shouldSkip()
      ? null
      : {
          id: "beta-notice",
          title: "개발 중 안내",
          // 이 장이 눈앞에 온 순간에만 "이번 방문에 봤다"로 기록한다. 뒷장에 실려만
          // 있다가 못 보고 닫힌 경우에는 기록하지 않아 다음 방문에 다시 뜬다.
          onShown: markShown,
          body: () => <BetaNoticeBody />,
          footer: (controls) => <BetaNoticeFooter {...controls} />,
        },
};

function BetaNoticeBody() {
  return (
    <>
      {/* pr-12 — 판 오른쪽 위의 닫기(X)가 이 자리에 얹힌다. 제목이 그 아래로 들어가면
          글자가 X 에 가린다. */}
      <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-5 pt-4 pr-12 pb-4 dark:border-zinc-800 dark:from-blue-950/30">
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
      </div>

      <div className="px-5 pt-4 pb-4 text-[13px] leading-[1.75] break-keep text-zinc-600 dark:text-zinc-300">
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

        {/* 이 장의 용건. 위 안내와 같은 톤으로 흘려보내지 않고 색 있는 판으로
            띄운다 — 잠긴 기능을 만나기 전에 이 문장을 봐야 의미가 있다. */}
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
          <p className="flex items-center gap-1.5 text-[14px] font-bold text-emerald-900 dark:text-emerald-200">
            <Sparkles size={15} className="shrink-0" />
            멤버십 기능, 지금은 전부 무료예요
          </p>
          {/* 전면 무료 이벤트 기간에는 "가입하면 60일"이 아니라 "언제까지 전부
              무료"가 맞는 말이다. 날짜·기간 모두 core 상수에서 오므로 이벤트가
              끝나면 아래 문장으로 저절로 돌아간다. */}
          <p className="mt-1.5 text-[13px] text-pretty text-emerald-800/90 dark:text-emerald-300/80">
            {isFreeForAll() ? (
              <>
                <B tone="emerald">{FREE_UNTIL_LABEL}까지</B> 멤버십 전체가 열려 있어요.
                결제도 카드 등록도 없어요.
              </>
            ) : (
              <>
                가입하는 순간부터 <B tone="emerald">{TRIAL_DAYS}일</B> 동안 멤버십
                전체가 열려요.
              </>
            )}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] text-emerald-900/85 dark:text-emerald-200/85">
            <Perk icon={<BookOpen size={13} />}>문제지 해설 제한 없이 보기</Perk>
            <Perk icon={<CalendarCheck size={13} />}>오늘의 복습 — 잊을 때쯤 다시 풀기</Perk>
            <Perk icon={<Sparkles size={13} />}>오답노트 안에서 바로 해설 보기</Perk>
          </ul>
        </div>
      </div>
    </>
  );
}

// "다음부터 보지 않기"를 체크박스가 아니라 버튼으로 둔다. 체크박스는 누른 뒤
// 닫기까지 두 번 눌러야 하고, 안 누르고 닫으면 아무 일도 안 일어난다.
// 폭은 확인 버튼에 양보한다 — 대부분은 읽고 닫는 쪽이다.
//
// 왼쪽은 이 장만 치우고(dismiss) 다음 장으로 넘어간다. 이 안내가 싫다고 뒤에 실린
// 다른 안내까지 못 보게 할 이유는 없다. 오른쪽은 판 전체를 닫는다.
function BetaNoticeFooter({ close, dismiss }: HomePopupControls) {
  return (
    <div className="flex gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => {
          markHidden();
          dismiss();
        }}
        className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        다음부터 보지 않기
      </button>
      <button
        type="button"
        onClick={close}
        className="flex-[1.2] rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
      >
        알겠어요
      </button>
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
