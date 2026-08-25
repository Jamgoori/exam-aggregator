"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewSession, createReviewFromConcept } from "@/app/mypage/wrong-notes/actions";
import { requestDiagnosis } from "@/app/mypage/actions";

// 같은개념 기출 랜덤(있는 만큼, 기본 5문제) 풀기. 유저 오답이 아니라 기출 전체에서 같은
// keyword_title 문항을 뽑아 세션을 만들고 풀이 페이지로 이동한다. subjectSlug가 없으면
// 풀이 라우트를 만들 수 없어 렌더하지 않는다(호출부에서 처리).
export function ConceptSolveButton({
  concept,
  subjectSlug,
  limit = 5,
  label = "같은 개념 기출 풀기",
  className = "",
}: {
  concept: string;
  subjectSlug: string;
  limit?: number;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewFromConcept({ concept, subjectSlug, limit });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "문제를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={`inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 ${className}`}
      >
        {pending ? "준비 중..." : (
          <>
            {label}
            <span aria-hidden>→</span>
          </>
        )}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// 진단 대시보드의 "풀기" 버튼들. 과목 오답에서 섞어풀기 세션(createReviewSession)을
// 만들고, 성공하면 풀이 페이지로 이동한다. 서버 컴포넌트인 page.tsx가 상호작용이 필요한
// 이 부분만 클라이언트로 분리해서 쓴다.
export function SolveButton({
  subjectSlug,
  limit = 5,
  label,
  variant = "primary",
  className = "",
}: {
  subjectSlug: string;
  limit?: number;
  label: string;
  variant?: "primary" | "hero";
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewSession({ subjectSlug, onlyUnresolved: true, limit });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "문제를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  const base =
    variant === "hero"
      ? "inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
      : "inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60";

  return (
    <div className={variant === "hero" ? "w-full" : "flex-1"}>
      <button type="button" onClick={go} disabled={pending} className={`${base} ${className}`}>
        {pending ? (
          "준비 중..."
        ) : (
          <>
            {label}
            <span aria-hidden>→</span>
          </>
        )}
      </button>
      {error && (
        <p className="mt-1.5 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// "맞춤 극복법 생성" 버튼. 진단 페이지에서 직접 오늘 진단을 요청·생성한다(하루 1회).
// 데이터층(막대그래프·개념 카드)은 AI 없이 이미 떠 있으므로, 이 버튼이 채우는 것은
// 개념별 극복법뿐이다. 생성이 실패하면(API 키 미설정·API 오류) 그 자리에서 이유를
// 보여주고 다시 누를 수 있게 둔다 — 예전처럼 눌러도 아무 일도 안 일어나면 안 된다.
export function DiagnosisCoachingButton({ requestedToday }: { requestedToday: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await requestDiagnosis();
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.status === "ready") {
        router.refresh();
        return;
      }
      setError("극복법을 생성하지 못했어요. 잠시 후 다시 시도해주세요.");
    });
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900 dark:text-violet-200">
            맞춤 극복법
            <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              일 1회
            </span>
          </p>
          <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
            위 취약 개념마다 &lsquo;어떤 유형에서 무너지는지 + 어떻게 극복할지&rsquo;를 만들어드려요.
          </p>
        </div>
        <button
          type="button"
          onClick={go}
          disabled={pending}
          className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {pending ? "생성 중..." : requestedToday ? "다시 시도" : "극복법 만들기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
