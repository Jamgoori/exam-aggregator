"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, BookOpen, Check, Flame, Lightbulb, Target } from "lucide-react";
import type {
  ConceptStat,
  DiagnosisWindow,
  SubjectConceptGroup,
} from "@/lib/diagnosis-live";
import type { DiagnosisConceptCoaching } from "@/lib/ai-diagnosis";
import {
  ConceptSolveButton,
  DiagnosisConceptPicker,
  type DiagnosisPickerConcept,
} from "./diagnosis-actions";

// 진단 대시보드의 화면 전체(그래프 + 극복법). 서버 컴포넌트였던 것을 클라이언트로
// 내린 이유는 하나다 — **과목 탭이 느렸다**. 예전에는 과목 칩이 `?subject=` 링크라
// 한 번 누를 때마다 서버 왕복이 돌았고, 그 왕복 안에서 계정 전체 오답을 훑는 라이브
// 집계(getDiagnosisAggregate)가 두 번(전체 + 과목 필터) 돌았다. 과목만 바꿔 보고 싶은
// 사람에게 매번 몇 초를 물린 셈이다.
//
// 이제 서버는 전 과목 집계를 한 번만 내려주고, 과목 필터는 여기서 배열을 거르는 것으로
// 끝난다(즉시). 기간 칩만 서버 왕복으로 남는다 — 다른 기간은 애초에 다른 데이터라
// 받아 오는 수밖에 없다.

// 기간 칩은 서버(page.tsx)가 정의해 라벨만 내려준다. "use client" 모듈의 상수를 서버
// 컴포넌트가 읽으면 클라이언트 참조를 건드리는 것이라 런타임에 터진다.
export type DiagnosisRangeChoice = { key: string; label: string };

function rangeLabel(days: number | null): string {
  if (days == null) return "전체 기간";
  return `최근 ${days}일`;
}

// 과목별 막대 개수. 한 과목만 골라 봤을 때는 그 과목을 깊게 보려는 것이므로 더 세운다.
const BARS_PER_SUBJECT = 6;
const BARS_WHEN_FOCUSED = 20;
// 같은개념 기출 풀기를 열어줄 최소 코퍼스 문항 수(너무 적으면 연습 가치가 약함).
const MIN_CORPUS_FOR_SOLVE = 2;

export type DiagnosisBoardSubject = { name: string; slug: string };

export function DiagnosisBoard({
  window: win,
  bySubject,
  concepts,
  subjects,
  initialSubject,
  ranges,
  rangeKey,
  coaching,
  coachingDate,
  picker,
  analysisDays,
  requestedThisWeek,
  nextDate,
  generatingSince,
}: {
  // 그래프가 실제로 그린 기간(자동 확장 결과 포함).
  window: DiagnosisWindow;
  // 전 과목 그래프 데이터. 과목 필터는 이 배열을 거르는 것으로 끝난다.
  bySubject: SubjectConceptGroup[];
  // 극복법 카드에 숫자(몇 문항 틀림·기출 수)를 붙일 때 쓰는 조회용 목록.
  concepts: ConceptStat[];
  // 과목 탭 목록(응시한 과목 전체).
  subjects: DiagnosisBoardSubject[];
  // URL(?subject=)에서 넘어온 초기 선택. 기간 칩을 눌러 돌아와도 과목이 유지된다.
  initialSubject: string | null;
  // 기간 칩 목록과 지금 선택된 칩. 기간만 서버 왕복(링크)으로 남는다.
  ranges: DiagnosisRangeChoice[];
  rangeKey: string;
  // 이미 만들어진 맞춤 극복법. 고른 개념에 대해서만 온다.
  coaching: DiagnosisConceptCoaching[];
  // 그 극복법을 받은 날(YYYY-MM-DD). 주기가 풀린 뒤에도 지난 진단이 계속 보이므로,
  // 언제 것인지 밝히지 않으면 오늘 푼 문제까지 반영된 줄 안다.
  coachingDate: string | null;
  // 선택창에 뿌릴 개념 목록. null이면 지금은 만들 수 없는 상태(이미 받았거나·생성 중·
  // 최근 7일 오답이 없거나·자격 미달)라 선택창을 그리지 않는다.
  picker: DiagnosisPickerConcept[] | null;
  // 극복법이 훑는 기간(일). 그래프 기간과 다를 수 있어 선택창이 그대로 밝힌다.
  analysisDays: number;
  requestedThisWeek: boolean;
  nextDate: string | null;
  generatingSince: string | null;
}) {
  const [subject, setSubject] = useState<string | null>(initialSubject);

  const shownGroups = useMemo(
    () => (subject ? bySubject.filter((g) => g.subjectSlug === subject) : bySubject),
    [bySubject, subject],
  );
  const maxWrong = useMemo(
    () => Math.max(1, ...bySubject.flatMap((g) => g.concepts.map((c) => c.wrongCount))),
    [bySubject],
  );
  // 극복법 카드에 붙일 통계 조회표. 정본 개념 id 가 있으면 그 축으로, 없으면 표기+과목으로.
  const statByKey = useMemo(() => {
    const m = new Map<string, ConceptStat>();
    for (const c of concepts) {
      if (c.conceptId) m.set(c.conceptId, c);
      m.set(`kw:${c.concept}###${c.subjectSlug ?? ""}`, c);
    }
    return m;
  }, [concepts]);

  const subjectName = subjects.find((s) => s.slug === subject)?.name ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* 과목 탭. 그래프와 극복법 결과가 함께 좁혀진다 — 한 과목만 파고들 때 화면 전체가
          그 과목이 되는 편이, 위는 좁고 아래는 전 과목인 것보다 읽기 쉽다. */}
      {subjects.length > 1 && (
        <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
          <Chip active={subject == null} onClick={() => setSubject(null)}>
            전체 과목
          </Chip>
          {subjects.map((s) => (
            <Chip key={s.slug} active={subject === s.slug} onClick={() => setSubject(s.slug)}>
              {s.name}
            </Chip>
          ))}
        </div>
      )}

      {/* A. 과목별 틀린 개념 막대그래프 */}
      <Card>
        <SectionTitle icon={<BarChart3 size={16} className="text-blue-600 dark:text-blue-400" />}>
          {rangeLabel(win.days)} 틀린 개념
        </SectionTitle>
        <p className="mt-1 px-1 text-xs text-slate-500 dark:text-zinc-500">
          {win.widened
            ? "선택한 기간에 푼 문제가 없어 기간을 넓혔어요."
            : "막대가 길수록 그 개념에서 더 많이 틀렸어요."}
        </p>
        <div className="mt-3 flex gap-1.5 px-1">
          {ranges.map((r) => (
            <RangeChip key={r.key} rangeKey={r.key} subject={subject} active={r.key === rangeKey}>
              {r.label}
            </RangeChip>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-5">
          {shownGroups.length === 0 ? (
            <p className="px-1 text-sm text-slate-500 dark:text-zinc-400">
              {subjectName
                ? `${rangeLabel(win.days)} ${subjectName}에서 틀린 문제가 없어요.`
                : "이 기간에 틀린 문제가 없어요."}
            </p>
          ) : (
            shownGroups.map((g) => (
              <SubjectBars
                key={g.subjectSlug ?? g.subject}
                group={g}
                maxWrong={maxWrong}
                limit={subject ? BARS_WHEN_FOCUSED : BARS_PER_SUBJECT}
              />
            ))
          )}
        </div>
      </Card>

      {/* B. 맞춤 극복법 — 선택창(아직 안 받았으면) 또는 고른 개념의 진단 결과.
          예전에는 이 자리에 "많이 틀린 개념 TOP 8" 카드가 순위대로 서 있었는데, 그건
          바로 위 막대그래프가 이미 말한 것을 한 번 더 늘어놓은 것이라 정작 극복법이
          아래로 밀렸다. 이제 이 공간은 **고른 개념의 진단**만 쓴다. */}
      <div className="flex flex-col gap-3">
        <SectionTitle icon={<Flame size={16} className="text-blue-600 dark:text-blue-400" />}>
          맞춤 극복법
        </SectionTitle>
        <GeneratingNotice since={generatingSince} />
        {picker && picker.length > 0 && (
          <DiagnosisConceptPicker
            concepts={picker}
            analysisDays={analysisDays}
            requestedThisWeek={requestedThisWeek}
            nextDate={nextDate}
          />
        )}
        {coaching.length > 0 && coachingDate && (
          <p className="px-1 text-xs text-slate-400 dark:text-zinc-600">
            {formatMonthDay(coachingDate)}에 고른 {coaching.length}개 개념의 진단이에요.
          </p>
        )}
        <CoachingResults coaching={coaching} subject={subject} statByKey={statByKey} />
        {!picker && coaching.length === 0 && generatingSince == null && (
          <p className="px-1 text-xs text-slate-400 dark:text-zinc-600">
            최근 {analysisDays}일 안에 틀린 문제가 쌓이면 여기서 개념을 골라 극복법을 받을 수
            있어요.
          </p>
        )}
      </div>

      <p className="px-1 text-center text-xs text-slate-400 dark:text-zinc-600">
        그래프는 {rangeLabel(win.days)} 실시간 데이터예요. 맞춤 극복법은 주 1회, 최근{" "}
        {analysisDays}일 안에 틀린 문제에서 고른 개념을 분석해요.
        {coaching.length > 0 && nextDate ? ` 다음 진단은 ${formatMonthDay(nextDate)}부터.` : ""}
      </p>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </section>
  );
}

function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 px-1 text-sm font-bold text-slate-700 dark:text-zinc-300">
      {icon}
      {children}
    </h2>
  );
}

const CHIP_BASE = "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors";
const CHIP_ON = "bg-blue-600 text-white";
const CHIP_OFF =
  "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`}
    >
      {children}
    </button>
  );
}

// 기간 칩만 링크다(다른 기간은 다른 데이터라 서버에서 받아야 한다). 지금 보고 있는
// 과목을 링크에 실어 준다 — 기간을 바꿨다고 과목 선택이 풀리면 다시 찾아 눌러야 한다.
function RangeChip({
  rangeKey,
  subject,
  active,
  children,
}: {
  rangeKey: string;
  subject: string | null;
  active: boolean;
  // next/link 의 children 타입과 맞추려고 문자열로 못 박는다(칩 라벨은 늘 문자열이다).
  children: string;
}) {
  const q = new URLSearchParams({ range: rangeKey });
  if (subject) q.set("subject", subject);
  return (
    <Link
      href={`/mypage/diagnosis?${q.toString()}`}
      scroll={false}
      className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`}
    >
      {children}
    </Link>
  );
}

// "만드는 중" 카드. 배치는 보통 몇 분, 늦어도 24시간 안에 끝난다 — 그 사이 화면이
// 아무 말도 안 하면 사용자는 버튼이 먹통이라고 생각하고 다시 누르러 온다(그때마다
// 요금이 나갈 수 있었다). 언제 요청했는지도 같이 적는다.
function GeneratingNotice({ since }: { since: string | null }) {
  if (!since) return null;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900/50 dark:bg-violet-950/20">
      <p className="text-sm font-bold text-violet-900 dark:text-violet-200">
        맞춤 극복법을 만들고 있어요
      </p>
      <p className="mt-1 text-xs leading-relaxed text-violet-700/80 dark:text-violet-300/70">
        {formatRequestedAt(since)}에 요청했어요. 보통 몇 분이면 끝나고, 준비되면 이 화면에
        바로 떠요 — 기다리는 동안 위 그래프에서 어떤 개념을 틀렸는지 볼 수 있어요.
      </p>
    </div>
  );
}

// "2026-08-27T05:12:00Z" → "오후 2:12". 한국 시간 기준(사용자가 사는 시간대다).
function formatRequestedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "조금 전";
  return new Date(t).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "2026-08-31" → "8월 31일". 주기 안내에 쓴다.
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 한 과목 그룹의 개념 막대들. 개념이 많으면 상위만 보이고 나머지는 접는다.
function SubjectBars({
  group,
  maxWrong,
  limit,
}: {
  group: SubjectConceptGroup;
  maxWrong: number;
  limit: number;
}) {
  const shown = group.concepts.slice(0, limit);
  const hidden = group.concepts.length - shown.length;
  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-sm font-bold text-slate-900 dark:text-zinc-100">{group.subject}</span>
        <span className="text-xs text-slate-400 dark:text-zinc-500">{group.totalWrong}문항 틀림</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {shown.map((c, i) => (
          <ConceptBar key={`${c.concept}-${i}`} concept={c} maxWrong={maxWrong} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-1.5 px-1 text-xs text-slate-400 dark:text-zinc-600">외 {hidden}개 개념</p>
      )}
    </div>
  );
}

// 개념 막대 하나. 라벨을 막대 위에 두는 건 개념 이름이 길기 때문이다 — 좌측 고정폭에
// 넣으면 "글의 내용과 일치·불일치 판단"이 "글의 내용과 일치…"로 잘려 정작 알아야 할
// 정보가 사라진다. 막대는 이 기간에 틀린 문항 수만 나타낸다(극복 여부는 세지 않는다).
function ConceptBar({ concept, maxWrong }: { concept: ConceptStat; maxWrong: number }) {
  const pct = Math.max(4, Math.round((concept.wrongCount / maxWrong) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-[13px] leading-snug text-slate-700 dark:text-zinc-300">
          {concept.concept}
        </span>
        <span className="shrink-0 text-xs text-slate-400 dark:text-zinc-500">
          <b className="text-sm font-bold text-blue-600 dark:text-blue-400">{concept.wrongCount}</b>
          문항
          {concept.accuracyPct != null ? ` · 정답률 ${concept.accuracyPct}%` : ""}
          {concept.scoreGainPct != null && concept.scoreGainPct >= 0.5
            ? ` · +${concept.scoreGainPct}점`
            : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── 극복법 결과 ──────────────────────────────────────────────────────────────
// 고른 개념에 대해서만 그린다. 과목 탭을 걸면 그 과목 것만 남는다.
function CoachingResults({
  coaching,
  subject,
  statByKey,
}: {
  coaching: DiagnosisConceptCoaching[];
  subject: string | null;
  statByKey: Map<string, ConceptStat>;
}) {
  const shown = subject ? coaching.filter((c) => c.subjectSlug === subject) : coaching;
  if (coaching.length === 0) return null;
  if (shown.length === 0) {
    return (
      <p className="px-1 text-xs text-slate-400 dark:text-zinc-600">
        이 과목은 이번 진단에서 고르지 않았어요. 다른 과목 탭에 극복법이 있어요.
      </p>
    );
  }
  return (
    <>
      {shown.map((c, i) => (
        <CoachingCard
          key={`${c.concept}-${i}`}
          coaching={c}
          stat={
            (c.conceptId ? statByKey.get(c.conceptId) : undefined) ??
            statByKey.get(`kw:${c.concept}###${c.subjectSlug ?? ""}`) ??
            null
          }
        />
      ))}
    </>
  );
}

function CoachingCard({
  coaching,
  stat,
}: {
  coaching: DiagnosisConceptCoaching;
  stat: ConceptStat | null;
}) {
  const subjectSlug = coaching.subjectSlug ?? stat?.subjectSlug ?? null;
  const canSolve = subjectSlug != null && (stat?.corpusCount ?? 0) >= MIN_CORPUS_FOR_SOLVE;
  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-center gap-2">
        {stat && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {stat.wrongCount}회 틀림
          </span>
        )}
        {stat?.accuracyPct != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
            정답률 {stat.accuracyPct}%
          </span>
        )}
        {(stat?.corpusCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            기출 {stat?.corpusCount}문항
          </span>
        )}
        {/* 예상 점수. 0.5점 미만은 뱃지로 띄우면 오히려 "해봐야 소용없다"로 읽혀 숨긴다. */}
        {stat?.scoreGainPct != null && stat.scoreGainPct >= 0.5 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            잡으면 +{stat.scoreGainPct}점
          </span>
        )}
      </div>

      <div className="mt-2.5">
        {coaching.subject && (
          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-500">
            {coaching.subject}
          </p>
        )}
        <p className="text-base font-bold text-slate-900 dark:text-zinc-100">{coaching.concept}</p>
      </div>

      {/* 1) 무너지는 지점 */}
      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/10">
        <p className="flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
          <Lightbulb size={13} /> 어디서 무너지고 있나
        </p>
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
          {coaching.weakPattern}
        </p>
        {coaching.rootCause && (
          <>
            <p className="mt-3 text-xs font-bold text-blue-700/80 dark:text-blue-300/80">
              왜 그렇게 골랐을까
            </p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
              {coaching.rootCause}
            </p>
          </>
        )}
      </div>

      {/* 2) 내 오답에서 나온 근거 — 이 기능이 "개념별 풀이법 사전"과 갈리는 지점이다. */}
      {coaching.evidence && coaching.evidence.length > 0 && (
        <div className="mt-3">
          <p className="px-1 text-xs font-bold text-slate-600 dark:text-zinc-400">
            내가 틀린 문항에서
          </p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {coaching.evidence.map((e, i) => (
              <li
                key={i}
                className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40"
              >
                <p className="text-[13px] font-semibold leading-snug text-slate-800 dark:text-zinc-200">
                  {e.question}
                </p>
                {e.myChoice && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                    내 선택 · {e.myChoice}
                  </p>
                )}
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700 dark:text-zinc-300">
                  {e.insight}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3) 처방 한 줄 + 실행 계획 */}
      <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5 dark:border-violet-900/40 dark:bg-violet-950/15">
        <p className="flex items-center gap-1.5 text-xs font-bold text-violet-700 dark:text-violet-300">
          <Target size={13} /> 이렇게 극복해요
        </p>
        <p className="mt-1.5 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-800 dark:text-zinc-200">
          {coaching.howToOvercome}
        </p>
        {coaching.steps && coaching.steps.length > 0 && (
          <ol className="mt-2.5 flex flex-col gap-2">
            {coaching.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    <b className="text-[13px] font-bold text-slate-800 dark:text-zinc-200">
                      {s.title}
                    </b>
                    {s.minutes != null && (
                      <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                        약 {s.minutes}분
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-600 dark:text-zinc-400">
                    {s.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* 4) 시험장 체크리스트 · 함정 */}
      {coaching.checkpoints && coaching.checkpoints.length > 0 && (
        <div className="mt-3">
          <p className="px-1 text-xs font-bold text-slate-600 dark:text-zinc-400">
            다음에 이 유형을 만나면
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {coaching.checkpoints.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[13px] leading-relaxed text-slate-700 dark:text-zinc-300">
                  {c}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {coaching.trap && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <b className="font-bold">자주 걸리는 함정 · </b>
          {coaching.trap}
        </p>
      )}

      {/* 액션: 틀린 문항 다시 보기 · 같은 개념 기출 풀기 */}
      <div className="mt-3.5 flex items-center gap-2">
        {subjectSlug && (
          <Link
            href={`/mypage/wrong-notes/${subjectSlug}?view=questions`}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:text-blue-300"
          >
            <BookOpen size={15} /> 틀린 문항 보기
          </Link>
        )}
        {canSolve && (
          <ConceptSolveButton
            concept={coaching.concept}
            conceptId={coaching.conceptId ?? null}
            subjectSlug={subjectSlug as string}
            limit={5}
            label="같은 개념 기출 5문제"
            className="flex-1"
          />
        )}
      </div>
    </Card>
  );
}
