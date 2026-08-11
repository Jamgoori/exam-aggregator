"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Settings, Sparkles, X } from "lucide-react";
import { newItemsForLimit } from "@gongmoa/core";

// 복습이 어떻게 돌아가는지 설명하는 모달(카드 헤더의 ? 버튼).
//
// 카드 본문에는 설명을 안 붙이고 여기로 몰아둔 이유: 매일 보는 자리에 상시 설명이
// 있으면 정작 매일 확인해야 할 "오늘 몇 문항"이 밀려난다. 여기는 사용자가 궁금해서
// 스스로 연 자리라 길어도 된다.
//
// 순서는 기능 구조가 아니라 사용자가 겪는 시간순이다 — 무엇인지 → 어떻게 움직이는지
// → 오늘 뭘 하면 되는지. 그다음에야 "맞혔는데 왜 또 나와요" 같은 의문이 생긴다.
//
// 용어는 화면에 쓰는 말로만 쓴다. ease·lapses·간격 반복·SRS 같은 말이 한 번이라도
// 나오면 첫 사용자는 자기가 이해 못 할 기능이라고 결론 내고 닫는다.
//
// 줄바꿈: 본문에 break-keep(word-break: keep-all)을 건다. 이게 없으면 브라우저가
// 한글을 글자 단위로 끊어서 "필요 없어 / 요." 처럼 조사·어미만 다음 줄로 떨어진다.
// 전역(body)에 걸지 않는 건 사이트 모든 페이지의 줄바꿈이 같이 바뀌기 때문이다 —
// 여기서만 쓴다. text-pretty는 그 위에서 마지막 줄에 한 어절만 남는 걸 줄인다.

export function ReviewGuideModal({
  dailyLimit,
  onClose,
}: {
  dailyLimit: number;
  onClose: () => void;
}) {
  const newLimit = newItemsForLimit(dailyLimit);

  // 설정 모달과 같은 규칙 — 열려 있는 동안 뒤 화면 스크롤을 막고 Esc로 닫는다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="복습 안내"
      onClick={onClose}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel-in flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* 헤더에만 옅은 색을 깔아 본문과 층을 나눈다. 스크롤이 헤더 밑으로 지나가도
            제목이 본문에 섞여 보이지 않는다. */}
        <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-5 pt-4 pb-4 dark:border-zinc-800 dark:from-blue-950/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold tracking-tight">
              복습이 어떻게 돌아가나요?
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              읽는 데 1분이면 충분해요
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/70 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-2 break-keep">
          {/* 핵심 3장은 항상 펼쳐둔다. 이것만 읽고 닫아도 기능을 쓸 수 있어야 한다. */}
          <Step n={1} title="틀린 문제는 잊어버릴 때쯤 다시 나와요">
            <P>배운 건 하루만 지나도 절반이 날아가요.</P>
            <P>
              그래서 <B>딱 잊어버릴 때쯤</B> 다시 보여줘요. 그때 다시 보면 훨씬 오래
              남아요.
            </P>
            <P>언제 다시 볼지는 문제마다 따로 정해요. 직접 고르지 않아도 돼요.</P>
          </Step>

          <Step n={2} title="맞히면 멀어지고, 틀리면 가까워져요">
            <P>한 문제가 어떻게 움직이는지 볼까요?</P>
            <Timeline />
            <P>
              계속 맞히면 점점 안 나와요. 그게 <B>외웠다</B>는 뜻이에요.
            </P>
            {/* "틀리면 처음부터"를 무조건으로 쓰지 않는다 — 예정일 전에 회독·섞어풀기로
                만나 틀린 건 간격만 반감하고 실패로 세지 않는다(srs.ts의 조기 실패).
                여기서 단정하면 "분명 틀렸는데 왜 그대로냐"가 되므로 조건을 붙이고,
                자세한 건 아래 FAQ("복습 말고 그냥 문제지 풀 때도")로 넘긴다. */}
            <P>
              그러다 복습에서 한 번 틀리면 다시 처음부터예요. 가까워졌다 멀어졌다 하면서,
              진짜 아는 문제만 조용히 사라져요.
            </P>
          </Step>

          <Step n={3} title="오늘은 오늘 것만 하면 돼요" last>
            <P>
              하루에 <B>{dailyLimit}문항</B>만 나와요.
            </P>
            <P>
              밀린 게 300개라도 오늘 화면엔 {dailyLimit}개만 떠요. 그것만 끝내면{" "}
              <B>오늘은 끝</B>이에요. 더 안 해도 돼요.
            </P>
          </Step>

          {/* 아래는 접어둔다. 한 번에 다 보이면 스크롤 길이만 보고 닫는다. */}
          <p className="mt-6 mb-1 text-[11px] font-bold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
            더 궁금하면
          </p>

          <Faq q="맞혔는데 왜 또 나와요?">
            <P first>한 번 맞힌 거랑 아는 건 달라요.</P>
            <P>
              찍어서 맞았을 수도 있고, 오늘은 기억나도 다음 주엔 잊을 수도 있어요. 그래서{" "}
              <B>간격을 두고</B> 한 번 더 물어봐요. 거기서 또 맞히면 그다음엔 훨씬
              나중에 나와요.
            </P>
          </Faq>

          {/* 복습 세션 밖의 채점(회독·섞어풀기)도 스케줄에 들어간다는 걸 안내가 한
              번도 말하지 않았다. 공시생의 기본 학습은 회독이라 이 경로로 채점되는
              양이 복습 세션보다 많고, 그 결과가 예정일 전이면 살살 반영된다
              (dueProgress·retainedProgress·boundByElapsed). 말해주지 않으면 "섞어풀기에서
              맞혔는데 왜 날짜가 그대로냐"로 읽힌다. */}
          <Faq q="복습 말고 그냥 문제지 풀 때도 반영되나요?">
            <P first>
              네. 회독이든 섞어풀기든 <B>채점되면 다 반영</B>돼요.
            </P>
            <P>
              다만 예정일보다 일찍 만난 문제는 살살 반영해요. 20일 뒤에 보라고 잡아둔
              문제를 3일 만에 맞혔다면 그건 3일치 기억이라, 다음 날짜가 조금만 밀려요.
            </P>
            <P>
              틀렸을 때도 같아요. 예정일이 한참 남았는데 틀린 건 <B>실패로 안 쳐요.</B>{" "}
              다시 나올 때까지가 절반으로 줄기만 하고, 접어두는 횟수에도 안 들어가요.
              대신 오늘 안에 한 번 더 나와요.
            </P>
          </Faq>

          <Faq q="제 오답은 훨씬 많은데 왜 조금만 나와요?">
            <P first>
              나머지는 <B>차례를 기다리는 중</B>이에요. 없어진 게 아니에요.
            </P>
            <P>
              한꺼번에 다 넣으면 며칠 뒤에 복습할 게 수백 개씩 몰려요. 그러면 아무도 못
              해요. 그래서 하루에 <B>{newLimit}개씩만</B> 새로 넣어요.
            </P>
            <P>
              밀린 복습이 많은 날은 새 문제를 아예 안 넣어요. 밀린 걸 먼저 비우는 게
              순서니까요.
            </P>
            <Note>
              기다리는 문제도 오답노트의 <B>섞어풀기</B>로는 지금 바로 풀 수 있어요.
            </Note>
          </Faq>

          <Faq q="며칠 쉬면 엄청 쌓이나요?">
            <P first>
              아니요. 쉬는 동안엔 <B>새 문제가 안 들어와요.</B>
            </P>
            <P>
              3일 쉬면 그 3일에 예약돼 있던 것만 밀려요. 며칠만 풀면 금방 원래대로
              돌아와요.
            </P>
            <P>
              너무 많이 밀렸다면 <Chip /> 에서 <B>밀린 복습 정리하기</B>를 누르세요.
              며칠에 나눠서 다시 예약해줘요. 문제가 지워지는 건 아니에요.
            </P>
          </Faq>

          <Faq q="없어진 문제가 있어요">
            <P first>
              여덟 번 넘게 틀린 문제는 복습에서 <B>잠깐 빼놨어요.</B>
            </P>
            <P>
              계속 보여줘도 안 외워지는 문제예요. 그런 건 자꾸 푸는 것보다 해설을 한 번
              제대로 읽는 게 빨라요.
            </P>
            <P>
              <Chip /> 의 <B>접어둔 문제</B>에서 확인하고, 다시 넣을 수도 있어요.
            </P>
          </Faq>

          <Faq q="위에 있는 날짜 줄은 뭐예요?">
            <P first>앞으로 며칠 동안 몇 개씩 나올지 보여줘요.</P>
            <P>
              <B>−는 쉬는 날</B>이에요. 그날은 복습할 게 없어요.
            </P>
          </Faq>

          <Faq q="양을 바꾸고 싶어요">
            <P first>
              <Chip /> 에서 바꿀 수 있어요.
            </P>
            <P>
              <B>하루에 풀 문항 수</B> — 시험이 가까우면 늘리고, 여유가 없으면 줄이세요.
            </P>
            <P>
              <B>복습에 넣을 과목</B> — 지금 안 보는 과목은 꺼두세요. 진도는 안 지워지고,
              다시 켜면 며칠에 나눠서 돌려줘요.
            </P>
          </Faq>
        </div>

        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            알겠어요
          </button>
        </div>
      </div>
    </div>
  );
}

// 문단. 첫 문단만 위 여백을 없앤다(제목·질문 바로 아래에 붙어야 한 덩어리로 읽힌다).
function P({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p className={`text-pretty ${first ? "" : "mt-2"}`}>{children}</p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-bold text-zinc-900 dark:text-zinc-100">{children}</span>;
}

// 본문보다 한 단계 낮은 곁다리. 이모지(⚙️) 대신 실제 아이콘을 쓰는 건 설정 버튼과
// 같은 모양이어야 어디를 누르라는 건지 바로 알기 때문이다.
function Chip() {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-baseline text-[12px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Settings size={11} />
      설정
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 rounded-lg border-l-2 border-blue-300 bg-blue-50/60 py-1.5 pr-2 pl-2.5 text-pretty text-zinc-600 dark:border-blue-800 dark:bg-blue-950/25 dark:text-zinc-300">
      {children}
    </p>
  );
}

// 번호 원과 그 아래로 흐르는 세로선. 세 장이 따로 노는 카드가 아니라 순서가 있는
// 한 흐름이라는 걸 선 하나로 알린다.
function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className="relative flex gap-3.5 pb-6 last:pb-1">
      {!last && (
        <span
          aria-hidden
          className="absolute top-8 bottom-2 left-[13.5px] w-px bg-gradient-to-b from-blue-200 to-blue-100/0 dark:from-blue-800 dark:to-blue-900/0"
        />
      )}
      <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-xs font-bold text-white shadow-sm shadow-blue-500/25">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h4 className="text-[14px] font-bold text-pretty">{title}</h4>
        <div className="mt-2 text-[13px] leading-[1.75] text-zinc-600 dark:text-zinc-300">
          {children}
        </div>
      </div>
    </section>
  );
}

// 이 모달에서 가장 중요한 요소. 글로 읽지 않아도 "맞히면 간격이 벌어진다"가 보여야
// 한다 — 막대가 길어지는 것 자체가 설명이라, 숫자를 안 읽어도 전달된다.
const TIMELINE: { ok: boolean; when: string; pct: number }[] = [
  { ok: false, when: "3시간 뒤", pct: 6 },
  { ok: true, when: "내일", pct: 16 },
  { ok: true, when: "3일 뒤", pct: 34 },
  { ok: true, when: "8일 뒤", pct: 62 },
  { ok: true, when: "20일 뒤", pct: 100 },
];

// 모션 설정은 React 밖(브라우저)에 있는 상태라 useSyncExternalStore로 읽는다.
// useState 초기값으로 읽으면 서버 렌더 결과(모션 허용)와 어긋나 하이드레이션이 깨지고,
// useEffect에서 setState로 읽으면 첫 페인트가 지난 뒤라 0%짜리 막대가 한 번 스쳤다가
// 튄다 — 움직임을 줄여달라고 한 사용자에게 정확히 보이면 안 되는 그림이다.
// 서버 스냅샷을 false로 두는 건 theme-toggle.tsx와 같은 이유다(서버는 알 수 없으므로
// 기본값으로 그리고, 클라이언트에서 실제 값으로 맞춘다).
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionOnServer() {
  return false;
}

function Timeline() {
  // 열자마자 막대가 차례로 늘어난다. 정지된 그림이면 "길이가 다르다"에서 그치는데,
  // 늘어나는 걸 보면 "점점 벌어진다"가 된다.
  //
  // 움직임을 줄여달라고 한 사용자에게는 처음부터 다 자란 상태로 준다 — 이 애니메이션은
  // 장식이 아니라 내용이라, 빼는 게 아니라 결과만 보여줘야 한다.
  const still = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getReducedMotionOnServer,
  );
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (still) return;
    const id = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(id);
  }, [still]);
  const grown = still || started;

  return (
    <ul className="my-3 flex flex-col gap-2 rounded-xl bg-zinc-50 px-3.5 py-3 dark:bg-zinc-800/50">
      {TIMELINE.map((row, i) => (
        <li key={i} className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white ${
              row.ok ? "bg-emerald-500" : "bg-rose-500"
            }`}
          >
            {row.ok ? <Check size={11} strokeWidth={3.5} /> : <X size={11} strokeWidth={3.5} />}
          </span>
          <span className="sr-only">{row.ok ? "맞힘" : "틀림"}</span>

          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-700/60">
            <span
              className={`block h-full rounded-full ${
                still ? "" : "transition-[width] duration-700 ease-out"
              } ${
                row.ok
                  ? "bg-gradient-to-r from-blue-400 to-blue-600"
                  : "bg-gradient-to-r from-rose-400 to-rose-500"
              }`}
              style={{
                width: grown ? `${row.pct}%` : "0%",
                transitionDelay: still ? undefined : `${i * 90}ms`,
              }}
            />
          </span>

          <span className="w-[52px] shrink-0 text-right text-[12px] font-bold tabular-nums">
            {row.when}
          </span>
        </li>
      ))}
    </ul>
  );
}

// <details>를 쓰는 이유: 열고 닫는 상태를 직접 들고 있을 이유가 없고, 키보드·스크린
// 리더 동작이 브라우저 기본으로 맞는다.
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-zinc-100 dark:border-zinc-800">
      <summary className="-mx-2 flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-3 text-[13px] font-semibold transition-colors marker:hidden hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="min-w-0 flex-1 text-pretty">{q}</span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180 dark:text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </summary>
      <div className="pb-3.5 pl-0.5 text-[13px] leading-[1.75] text-zinc-600 dark:text-zinc-300">
        {children}
      </div>
    </details>
  );
}
