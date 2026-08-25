"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewSession, createReviewFromConcept } from "@/app/mypage/wrong-notes/actions";
import { requestDiagnosis } from "@/app/mypage/actions";

// 같은개념 기출 랜덤(있는 만큼, 기본 5문제) 풀기. 유저 오답이 아니라 기출 전체에서 같은
// keyword_title 문항을 뽑아 세션을 만들고 풀이 페이지로 이동한다. subjectSlug가 없으면
// 풀이 라우트를 만들 수 없어 렌더하지 않는다(호출부에서 처리).
export function ConceptSolveButton({
  concept,
  conceptId = null,
  subjectSlug,
  limit = 5,
  label = "같은 개념 기출 풀기",
  className = "",
}: {
  concept: string;
  conceptId?: string | null;
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
      const res = await createReviewFromConcept({ concept, conceptId, subjectSlug, limit });
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
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 ${className}`}
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

// "맞춤 극복법 생성" 버튼. 진단 페이지에서 직접 이번 주 진단을 요청·생성한다(주 1회).
// 데이터층(막대그래프·개념 카드)은 AI 없이 이미 떠 있으므로, 이 버튼이 채우는 것은
// 개념별 극복법뿐이다. 생성이 실패하면(API 키 미설정·API 오류) 그 자리에서 이유를
// 보여주고 다시 누를 수 있게 둔다 — 예전처럼 눌러도 아무 일도 안 일어나면 안 된다.
// 페이지에 들어오면 맞춤 극복법을 알아서 만든다. 진단은 "눌렀더니 결과가 나오는 것"이지
// 링크 한 번, 버튼 한 번을 요구할 일이 아니다.
//
// 다만 실제 API 요금이 나가는 경로라 자동 실행 조건을 좁게 잠근다 — 호출부(page.tsx)가
// "이번 주기에 요청 행이 아직 없음 + 자격 충족 + 극복법 없음"일 때만 이 컴포넌트를
// 그린다. 그래서 자동 생성은 주기당 최대 한 번이고, 실패해 pending 으로 남은 뒤에는
// 자동으로 다시 부르지 않는다(수동 "다시 시도" 버튼으로 넘어간다). 새로고침을 반복해도
// 요금이 새지 않아야 한다.
export function DiagnosisAutoGenerate() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // StrictMode 의 이펙트 2회 실행으로 API 를 두 번 부르지 않게 막는다.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    let alive = true;
    (async () => {
      try {
        const res = await requestDiagnosis();
        if (!alive) return;
        if (res.error) {
          setError(res.error);
          return;
        }
        setDone(true);
        router.refresh();
      } catch {
        if (alive) setError("극복법을 만들지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (error) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-bold text-slate-900 dark:text-zinc-100">맞춤 극복법</p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
          아래 그래프와 문제 풀기는 그대로 쓸 수 있어요.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900"
      aria-live="polite"
    >
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600 dark:border-zinc-700 dark:border-t-zinc-300" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-zinc-100">
          {done ? "극복법을 불러오는 중이에요" : "맞춤 극복법을 만들고 있어요"}
        </p>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
          틀린 문항을 개념별로 읽는 중이에요. 20초쯤 걸려요.
        </p>
      </div>
    </div>
  );
}

export function DiagnosisCoachingButton({
  requestedThisWeek,
  nextDate,
}: {
  requestedThisWeek: boolean;
  // 이번 주기에 이미 받았을 때 다음 가능일(YYYY-MM-DD). 없으면 지금 받을 수 있다.
  nextDate?: string | null;
}) {
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
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-zinc-100">
            맞춤 극복법
            <span className="text-xs font-medium text-slate-400 dark:text-zinc-500">주 1회</span>
          </p>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
            위 취약 개념마다 &lsquo;어떤 유형에서 무너지는지 + 어떻게 극복할지&rsquo;를 만들어드려요.
          </p>
          {/* 생성이 실패해 남은 주기는 다시 시도할 수 있다 — 잠금은 "성공한 진단"에만
              걸리므로, 여기서는 언제까지가 이번 주기인지만 알려준다. */}
          {requestedThisWeek && nextDate && (
            <p className="mt-0.5 text-xs text-slate-400 dark:text-zinc-500">
              이번 주기는 {nextDate.slice(5).replace("-", "/")}까지예요.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={go}
          disabled={pending}
          className="shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "생성 중..." : requestedThisWeek ? "다시 시도" : "극복법 만들기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
