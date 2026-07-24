"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewSession, createReviewFromConcept } from "@/app/mypage/wrong-notes/actions";

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
