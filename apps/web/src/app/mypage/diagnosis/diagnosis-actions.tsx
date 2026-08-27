"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewSession, createReviewFromConcept } from "@/app/mypage/wrong-notes/actions";
import { requestDiagnosis, toggleDiagnosisSubject } from "@/app/mypage/actions";
import {
  COACH_MAX_TOTAL,
  COACH_PER_SUBJECT,
  plannedConceptCount,
} from "@/lib/diagnosis-limits";

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
// 진단 과목 선택창 + 생성 버튼.
//
// 예전에는 페이지에 들어오면 자동으로 극복법을 만들었다(DiagnosisAutoGenerate). 그러면
// 사용자가 과목을 고를 틈이 없고, 준비하지 않는 과목이 상한(과목당 7개·전체 15개)을
// 차지한 채 요금까지 나간다. 그래서 고른 뒤 직접 누르는 흐름으로 바꿨다.
export function DiagnosisSubjectPicker({
  subjects,
  excludedSubjectIds,
  requestedThisWeek,
  nextDate,
}: {
  subjects: { id: string; name: string; wrongCount: number }[];
  excludedSubjectIds: string[];
  requestedThisWeek: boolean;
  nextDate?: string | null;
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<string>>(new Set(excludedSubjectIds));
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const included = subjects.filter((s) => !excluded.has(s.id));
  // 이번 생성이 실제로 몇 개 개념을 다룰지. 상한 규칙을 말로만 적어 두면 와닿지 않는다.
  const planned = plannedConceptCount(included.length);
  const perSubject = included.length > 0 ? Math.floor(planned / included.length) : 0;

  function toggle(id: string) {
    if (pending || saving) return;
    const include = excluded.has(id);
    setSaving(id);
    setError(null);
    // 낙관적 갱신 — 저장이 실패하면 되돌린다.
    setExcluded((prev) => {
      const next = new Set(prev);
      if (include) next.delete(id);
      else next.add(id);
      return next;
    });
    void (async () => {
      const res = await toggleDiagnosisSubject(id, include);
      setSaving(null);
      if (res.error) {
        setError(res.error);
        setExcluded((prev) => {
          const next = new Set(prev);
          if (include) next.add(id);
          else next.delete(id);
          return next;
        });
      }
    })();
  }

  function go() {
    if (pending || included.length === 0) return;
    setError(null);
    start(async () => {
      const res = await requestDiagnosis();
      if (res.error) {
        setError(res.error);
        return;
      }
      // ready(이미 이번 주기 리포트가 있다)든 queued(배치에 실렸다)든 화면을 새로 그린다.
      // queued 면 서버가 "만들고 있어요" 카드로 바꿔 주므로 여기서 따로 말할 게 없다.
      if (res.status === "ready" || res.status === "queued") {
        router.refresh();
        return;
      }
      setError("극복법 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
    });
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900/50 dark:bg-violet-950/20">
      <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900 dark:text-violet-200">
        맞춤 극복법
        <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          주 1회
        </span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-violet-700/80 dark:text-violet-300/70">
        취약 개념마다 &lsquo;어떤 유형에서 무너지는지 + 어떻게 극복할지&rsquo;를 만들어드려요.{" "}
        <b className="font-bold">
          과목당 {COACH_PER_SUBJECT}개, 전체 {COACH_MAX_TOTAL}개 개념까지
        </b>{" "}
        다뤄요 — 안 보는 과목을 빼면 남은 과목을 그만큼 더 깊게 짚어줘요. 만드는 데는
        보통 몇 분 걸리고, 다 되면 이 화면에 바로 떠요.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {subjects.map((s) => {
          const on = !excluded.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              disabled={pending || saving != null}
              aria-pressed={on}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
                on
                  ? "bg-violet-600 text-white"
                  : "bg-white text-slate-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
              }`}
            >
              {on ? "✓ " : ""}
              {s.name}
              <span className={on ? "opacity-70" : ""}> {s.wrongCount}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-violet-700/60 dark:text-violet-300/50">
        {included.length === 0
          ? "과목을 하나 이상 골라주세요."
          : `${included.length}과목 · 개념 ${planned}개를 다뤄요 (과목당 약 ${perSubject}개).`}
        {requestedThisWeek && nextDate
          ? ` 이번 주기는 ${nextDate.slice(5).replace("-", "/")}까지예요.`
          : ""}
      </p>

      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={go}
        disabled={pending || included.length === 0}
        className="mt-2.5 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
      >
        {pending ? "요청하는 중이에요…" : "맞춤 극복법 만들기"}
      </button>
    </div>
  );
}
