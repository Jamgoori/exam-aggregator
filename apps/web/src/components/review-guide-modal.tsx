"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
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
        className="animate-modal-panel-in flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-2xl dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold">복습이 어떻게 돌아가나요?</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              1분이면 다 읽어요
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {/* 핵심 3장은 항상 펼쳐둔다. 이것만 읽고 닫아도 기능을 쓸 수 있어야 한다. */}
          <Step n={1} title="틀린 문제는 잊어버릴 때쯤 다시 나와요">
            <p>사람은 배운 걸 하루만 지나도 절반을 잊어요.</p>
            <p className="mt-1.5">
              그래서 <B>딱 잊어버릴 때쯤</B> 다시 보여줘요. 그때 다시 보면 오래 남아요.
            </p>
            <p className="mt-1.5">
              언제 다시 볼지는 문제마다 따로 정해져요. 직접 고르실 필요 없어요.
            </p>
          </Step>

          <Step n={2} title="맞히면 멀어지고, 틀리면 가까워져요">
            <p>한 문제가 어떻게 움직이는지 볼게요.</p>
            <Timeline />
            <p className="mt-2">
              계속 맞히면 점점 안 나와요. 그게 <B>외웠다</B>는 뜻이에요.
            </p>
            <p className="mt-1.5">
              그러다 한 번 틀리면 다시 처음부터 시작해요. 가까워졌다 멀어졌다 하면서,
              진짜 아는 문제만 조용히 사라져요.
            </p>
          </Step>

          <Step n={3} title="오늘 할 건 오늘 것뿐이에요">
            <p>
              하루에 <B>{dailyLimit}문항</B>만 나와요.
            </p>
            <p className="mt-1.5">
              밀린 게 300개여도 오늘 화면엔 {dailyLimit}개만 떠요. 그거 끝내면{" "}
              <B>오늘은 끝</B>이에요. 더 안 해도 돼요.
            </p>
          </Step>

          {/* 아래는 접어둔다. 한 번에 다 보이면 스크롤 길이만 보고 닫는다. */}
          <p className="mt-5 mb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            더 궁금하면
          </p>

          <Faq q="맞혔는데 왜 또 나와요?">
            <p>한 번 맞힌 거랑 아는 건 달라요.</p>
            <p className="mt-1.5">
              찍어서 맞았을 수도 있고, 오늘은 기억나도 다음 주엔 잊을 수도 있어요. 그래서{" "}
              <B>간격을 두고</B> 한 번 더 물어봐요. 거기서 또 맞히면 그다음엔 훨씬
              나중에 나와요.
            </p>
          </Faq>

          <Faq q="제 오답은 훨씬 많은데 왜 조금만 나와요?">
            <p>
              나머지는 <B>차례를 기다리는 중</B>이에요. 없어진 게 아니에요.
            </p>
            <p className="mt-1.5">
              한꺼번에 다 넣으면 며칠 뒤에 복습할 게 수백 개씩 몰려요. 그럼 아무도 못
              해요. 그래서 하루에 <B>{newLimit}개씩만</B> 새로 넣어요.
            </p>
            <p className="mt-1.5">
              밀린 복습이 많은 날은 새 문제를 아예 안 넣어요. 밀린 걸 먼저 비우는 게
              순서니까요.
            </p>
            <p className="mt-1.5 text-zinc-500 dark:text-zinc-400">
              기다리는 문제도 오답노트의 <B>섞어풀기</B>로는 지금 바로 풀 수 있어요.
            </p>
          </Faq>

          <Faq q="며칠 쉬면 엄청 쌓이나요?">
            <p>
              아니요. 쉬는 동안엔 <B>새 문제가 안 들어와요.</B>
            </p>
            <p className="mt-1.5">
              3일 쉬면 그 3일에 예약돼 있던 것만 밀려요. 돌아와서 며칠 풀면 원래대로
              돌아와요.
            </p>
            <p className="mt-1.5">
              너무 많이 밀렸으면 ⚙️ 설정에서 <B>밀린 복습 정리하기</B>를 누르세요. 며칠에
              나눠서 다시 예약해줘요. 문제가 지워지는 건 아니에요.
            </p>
          </Faq>

          <Faq q="없어진 문제가 있어요">
            <p>
              여덟 번 넘게 틀린 문제는 복습에서 <B>잠깐 빼놨어요.</B>
            </p>
            <p className="mt-1.5">
              계속 보여줘도 안 외워지는 문제예요. 그런 건 자꾸 푸는 것보다 해설을 한 번
              제대로 읽는 게 빨라요.
            </p>
            <p className="mt-1.5">
              ⚙️ 설정 → <B>접어둔 문제</B>에서 확인하고, 다시 넣을 수도 있어요.
            </p>
          </Faq>

          <Faq q="위에 있는 날짜 줄은 뭐예요?">
            <p>앞으로 며칠 동안 몇 개씩 나올지예요.</p>
            <p className="mt-1.5">
              <B>−는 쉬는 날</B>이에요. 그날은 복습할 게 없어요.
            </p>
          </Faq>

          <Faq q="양을 바꾸고 싶어요">
            <p>⚙️ 설정에서 바꿀 수 있어요.</p>
            <p className="mt-1.5">
              <B>하루에 풀 문항 수</B> — 시험이 가까우면 늘리고, 여유가 없으면 줄이세요.
            </p>
            <p className="mt-1.5">
              <B>복습에 넣을 과목</B> — 지금 안 보는 과목은 꺼두세요. 진도는 안 지워지고,
              다시 켜면 며칠에 나눠서 돌려줘요.
            </p>
          </Faq>
        </div>

        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            알겠어요
          </button>
        </div>
      </div>
    </div>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-bold text-zinc-900 dark:text-zinc-100">{children}</span>;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex gap-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold">{title}</h4>
        <div className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          {children}
        </div>
      </div>
    </section>
  );
}

// 이 모달에서 가장 중요한 요소. 글로 읽지 않아도 "맞히면 간격이 벌어진다"가 보여야
// 한다 — 왼쪽 칸의 ⭕/❌와 오른쪽 칸의 늘어나는 숫자가 그 자체로 설명이다.
const TIMELINE: { ok: boolean; when: string }[] = [
  { ok: false, when: "3시간 뒤" },
  { ok: true, when: "내일" },
  { ok: true, when: "3일 뒤" },
  { ok: true, when: "8일 뒤" },
  { ok: true, when: "20일 뒤" },
];

function Timeline() {
  return (
    <ul className="mt-2 flex flex-col rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      {TIMELINE.map((row, i) => (
        <li key={i} className="flex items-center gap-2.5 py-1">
          <span
            aria-hidden
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              row.ok ? "bg-emerald-500" : "bg-red-500"
            }`}
          >
            {row.ok ? "O" : "X"}
          </span>
          <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {row.ok ? "맞힘" : "틀림"}
          </span>
          <span
            aria-hidden
            className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"
            style={{ marginLeft: i * 6 }}
          />
          <span className="shrink-0 text-[13px] font-bold tabular-nums">{row.when}</span>
        </li>
      ))}
    </ul>
  );
}

// <details>를 쓰는 이유: 열고 닫는 상태를 직접 들고 있을 이유가 없고, 키보드·스크린
// 리더 동작이 브라우저 기본으로 맞는다.
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-zinc-100 py-2.5 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold marker:hidden hover:text-blue-700 dark:hover:text-blue-300">
        <span className="min-w-0 flex-1">{q}</span>
        <span
          aria-hidden
          className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180 dark:text-zinc-500"
        >
          ▾
        </span>
      </summary>
      <div className="mt-2 pr-5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {children}
      </div>
    </details>
  );
}
