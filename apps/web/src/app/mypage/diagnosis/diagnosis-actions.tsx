"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewSession, createReviewFromConcept } from "@/app/mypage/wrong-notes/actions";
import { requestDiagnosis } from "@/app/mypage/actions";
import { COACH_MAX_TOTAL } from "@/lib/diagnosis-limits";

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

// 개념 선택창 + 생성 버튼.
//
// 예전에는 과목만 고르면 AI가 그 안에서 상위 개념을 알아서 집었다. 그런데 "많이 틀린
// 개념"과 "지금 잡고 싶은 개념"은 다르다 — 시험이 코앞인 과목, 이미 버린 단원이 사람마다
// 다르기 때문이다. 개념 수가 곧 요금이라 그 15칸을 누가 정하느냐가 곧 이 기능의 값어치다.
// 그래서 체크박스로 사용자가 직접 정한다.
//
// 처음부터 빈 체크박스로 두지는 않는다. 아무것도 안 골라 둔 화면은 "고르는 일"부터
// 시키는 화면이라 대부분 그냥 나간다 — 추천(자동 선정과 같은 규칙)을 미리 체크해 두고
// 손보게 한다. 그대로 눌러도 예전과 같은 결과가 나온다.
export type DiagnosisPickerConcept = {
  // 개념 선택 키(정본 id 우선). 서버의 conceptSelectionKey 와 같은 값이다.
  key: string;
  concept: string;
  conceptId: string | null;
  subject: string | null;
  // 과목 탭의 키. 표시 이름(subject)은 겹칠 수 있어 탭은 slug 로 가른다.
  subjectSlug: string | null;
  wrongCount: number;
  accuracyPct: number | null;
  scoreGainPct: number | null;
  // 자동 선정(pickCoachTargets)이 골랐을 개념. 처음에 체크된 상태로 뜬다.
  recommended: boolean;
};

export function DiagnosisConceptPicker({
  concepts,
  analysisDays,
  requestedThisWeek,
  nextDate,
}: {
  concepts: DiagnosisPickerConcept[];
  // 극복법이 실제로 훑는 기간(일). 그래프 기간과 다를 수 있어 여기서 밝혀 준다.
  analysisDays: number;
  requestedThisWeek: boolean;
  nextDate?: string | null;
}) {
  const router = useRouter();
  const recommended = concepts.filter((c) => c.recommended).map((c) => c.key);
  const [selected, setSelected] = useState<Set<string>>(new Set(recommended));
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 선택창의 과목 탭. 위쪽 대시보드의 과목 탭과 따로 논다 — "그래프는 국어를 보면서
  // 극복법은 전 과목에서 고르는" 것이 자연스럽고, 반대로 묶어 두면 그래프를 좁혔다는
  // 이유로 고를 수 있는 개념이 조용히 사라진다.
  const [tab, setTab] = useState<string | null>(null);

  const full = selected.size >= COACH_MAX_TOTAL;

  function toggle(key: string) {
    if (pending) return;
    setConfirming(false);
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      // 상한은 체크박스가 직접 막는다 — 20개를 고르게 해 놓고 나중에 "15개만 됐어요"
      // 라고 말하면, 잘려 나간 5개를 사용자가 고른 줄 알고 기다리게 된다.
      else if (next.size < COACH_MAX_TOTAL) next.add(key);
      return next;
    });
  }

  function go() {
    if (pending || selected.size === 0) return;
    setError(null);
    start(async () => {
      const picked = concepts
        .filter((c) => selected.has(c.key))
        .map((c) => ({ conceptId: c.conceptId, concept: c.concept }));
      const res = await requestDiagnosis(picked);
      if (res.error) {
        setConfirming(false);
        setError(res.error);
        return;
      }
      // ready(이미 이번 주기 리포트가 있다)든 queued(배치에 실렸다)든 화면을 새로 그린다.
      // queued 면 서버가 "만들고 있어요" 카드로 바꿔 주므로 여기서 따로 말할 게 없다.
      if (res.status === "ready" || res.status === "queued") {
        router.refresh();
        return;
      }
      setConfirming(false);
      setError("극복법 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
    });
  }

  // 과목 탭 목록. 개념이 있는 과목만 세운다(고를 것이 없는 탭은 만들지 않는다).
  const tabs: { slug: string; name: string }[] = [];
  for (const c of concepts) {
    const slug = c.subjectSlug ?? "";
    if (tabs.some((t) => t.slug === slug)) continue;
    tabs.push({ slug, name: c.subject ?? "기타" });
  }

  const visible = tab == null ? concepts : concepts.filter((c) => (c.subjectSlug ?? "") === tab);
  // 지금 탭에 안 보이지만 이미 골라 둔 개수. 탭을 옮겨 다니며 고르면 "왜 3개라고 하지"가
  // 되므로 밝혀 준다.
  const hiddenSelected = concepts.filter(
    (c) => selected.has(c.key) && !visible.some((v) => v.key === c.key),
  ).length;

  // 과목별로 묶되 순서는 받은 그대로(많이 틀린 순)를 따른다.
  const groups: { subject: string; items: DiagnosisPickerConcept[] }[] = [];
  for (const c of visible) {
    const name = c.subject ?? "기타";
    const g = groups.find((x) => x.subject === name);
    if (g) g.items.push(c);
    else groups.push({ subject: name, items: [c] });
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
        고른 개념마다 <b className="font-bold">내가 실제로 고른 오답</b>을 하나씩 짚어 왜 그렇게
        골랐는지 분석하고, 오늘부터의 극복 계획과 시험장 체크리스트까지 만들어드려요.{" "}
        <b className="font-bold">한 번에 {COACH_MAX_TOTAL}개까지</b> 고를 수 있고, 최근{" "}
        {analysisDays}일 안에 틀린 문제에서 고른 개념만 분석해요. 만드는 데 보통 몇 분 걸리고, 다 되면 이
        화면에 바로 떠요.
      </p>

      {/* 과목 탭: 고를 개념이 여러 과목에 걸쳐 있으면 목록이 길어져 스크롤로만 찾게 된다.
          준비 중인 과목부터 고르는 사람이 대부분이라 탭이 곧 "지금 급한 과목"이다. */}
      {tabs.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <PickerTab active={tab == null} onClick={() => setTab(null)}>
            전체 과목
          </PickerTab>
          {tabs.map((t) => (
            <PickerTab key={t.slug} active={tab === t.slug} onClick={() => setTab(t.slug)}>
              {t.name}
            </PickerTab>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setSelected(new Set(recommended));
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200 transition-colors hover:bg-violet-100 disabled:opacity-60 dark:bg-zinc-900 dark:text-violet-300 dark:ring-violet-900/60"
        >
          추천 {recommended.length}개로 되돌리기
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(new Set());
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700"
        >
          전체 과목 해제
        </button>
      </div>

      {/* 개념이 수십 개까지 올 수 있어 목록만 스크롤시킨다 — 카드가 화면을 통째로 밀어내면
          아래(지난 진단 결과)로 내려가는 길이 멀어진다. */}
      <div className="mt-2.5 max-h-96 overflow-y-auto rounded-lg bg-white/70 p-1 dark:bg-zinc-900/50">
        {groups.map((g) => (
          <div key={g.subject} className="mb-1 last:mb-0">
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-bold text-violet-700/70 dark:text-violet-300/60">
              {g.subject}
            </p>
            {g.items.map((c) => {
              const on = selected.has(c.key);
              return (
                <label
                  key={c.key}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                    on ? "bg-violet-100/70 dark:bg-violet-900/20" : "hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                  } ${!on && full ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.key)}
                    disabled={pending || (!on && full)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-snug text-slate-800 dark:text-zinc-200">
                      {c.concept}
                    </span>
                    {/* 체크박스는 고를 근거가 같이 보일 때만 의미가 있다. */}
                    <span className="block text-[11px] text-slate-500 dark:text-zinc-500">
                      {c.wrongCount}문항 틀림
                      {c.accuracyPct != null ? ` · 정답률 ${c.accuracyPct}%` : ""}
                      {c.scoreGainPct != null && c.scoreGainPct >= 0.5
                        ? ` · 잡으면 +${c.scoreGainPct}점`
                        : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-violet-700/60 dark:text-violet-300/50">
        {selected.size === 0
          ? "개념을 하나 이상 골라주세요."
          : `${selected.size}/${COACH_MAX_TOTAL}개 선택${full ? " (상한이에요)" : ""}`}
        {tab != null && hiddenSelected > 0 ? ` · 다른 과목에서 고른 ${hiddenSelected}개 포함` : ""}
        {requestedThisWeek && nextDate
          ? ` · 이번 주기는 ${nextDate.slice(5).replace("-", "/")}까지예요.`
          : ""}
      </p>

      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* 주 1회라 되돌릴 수 없다 — 누르기 전에 한 번 되묻는다. 별도 모달을 띄우지 않는
          이유는 고른 목록이 바로 위에 보여야 확인이 의미가 있기 때문이다. */}
      {confirming ? (
        <div className="mt-2.5 rounded-xl border border-violet-300 bg-white px-3 py-2.5 dark:border-violet-800 dark:bg-zinc-900">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-zinc-300">
            고른 <b className="font-bold">{selected.size}개 개념</b>으로 만들어요. 이번 주기
            (7일)에는 다시 만들 수 없어요.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-300"
            >
              더 고를게요
            </button>
            <button
              type="button"
              onClick={go}
              disabled={pending}
              className="flex-[2] rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
            >
              {pending ? "요청하는 중이에요…" : "이대로 만들기"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || selected.size === 0}
          className="mt-2.5 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          고른 {selected.size}개 개념으로 극복법 받기
        </button>
      )}
    </div>
  );
}

// 선택창 안의 과목 탭 하나. 위 대시보드 칩과 색이 다른 건 여기가 보라색(극복법) 카드
// 안이라서다 — 같은 파란 칩을 쓰면 카드 밖 그래프 칩과 헷갈린다.
function PickerTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
        active
          ? "bg-violet-600 text-white"
          : "bg-white text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100 dark:bg-zinc-900 dark:text-violet-300 dark:ring-violet-900/60"
      }`}
    >
      {children}
    </button>
  );
}
