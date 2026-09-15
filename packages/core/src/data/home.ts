import { computeStreakDays } from "../streak";
import { kstDateKey } from "../attendance";
import {
  computeDiagnosisProgress,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_MIN_WRONG,
} from "../diagnosis-progress";

// 홈 랜딩(`/`)·AI 약점 진단 소개(`/diagnosis`)의 순수 계산 — 웹·모바일 공유.
//
// 웹은 이 값들을 서버 컴포넌트(app/page.tsx, lib/exam-index.ts, lib/ai-diagnosis.ts)에서
// 'use cache'·RSC 로 계산하고, 앱은 카탈로그 쿼리 + 본인 RLS 행에서 같은 함수를 부른다.
// 이 파일에는 데이터 접근이 없다 — 입력은 이미 받아 온 행이고 출력은 화면 모양이다.

// ── 시험 색인 (웹 lib/exam-index.ts getExamIndex 의 집계부) ──────────────────

// 시행처(국가직·지방직 …) × 급수(9급·7급 …) 한 칸을 가리키는 "시험" 단위.
// 경찰·계리직은 level 이 비어 있어 슬러그가 시행처 이름 그대로다("경찰").
export type ExamCombo = {
  slug: string;
  examTypeName: string;
  level: string | null;
  /** 화면·제목에 쓰는 이름. "국가직 9급" / "경찰" */
  label: string;
  /** 중복 시험지를 합친 뒤의 자료 수 */
  count: number;
  /** 내림차순 연도 목록 */
  years: number[];
  yearCounts: { year: number; count: number }[];
  examTypeOrder: number;
};

export function comboSlug(examTypeName: string, level: string | null): string {
  return level ? `${examTypeName}-${level}` : examTypeName;
}

export function comboLabel(examTypeName: string, level: string | null): string {
  return level ? `${examTypeName} ${level}` : examTypeName;
}

// 존재하는 시험 조합 전체. 자료가 하나도 없는 조합은 애초에 만들어지지 않는다.
// papers 는 중복 통합이 끝난 목록이어야 count 가 화면(과목·시험 페이지)과 같다.
// 시행처 순서는 관리자가 정한 display_order, 같은 시행처 안에서는 자료가 많은 급수부터.
// (앱 카탈로그의 examTypes 에는 display_order 가 없어 0 으로 두면 슬러그순만 남는다 —
//  홈은 슬러그로 찾아 쓰므로 순서는 쓰지 않는다.)
export function buildExamIndex(
  papers: readonly { exam_type_id: string; level: string | null; year: number }[],
  examTypes: readonly { id: string; name: string; display_order?: number }[],
): ExamCombo[] {
  const examTypeById = new Map(examTypes.map((t) => [t.id, t]));
  const acc = new Map<
    string,
    {
      examTypeName: string;
      level: string | null;
      count: number;
      years: Map<number, number>;
      examTypeOrder: number;
    }
  >();

  for (const p of papers) {
    const examType = examTypeById.get(p.exam_type_id);
    if (!examType) continue;
    const slug = comboSlug(examType.name, p.level);
    let entry = acc.get(slug);
    if (!entry) {
      entry = {
        examTypeName: examType.name,
        level: p.level,
        count: 0,
        years: new Map(),
        examTypeOrder: examType.display_order ?? 0,
      };
      acc.set(slug, entry);
    }
    entry.count += 1;
    entry.years.set(p.year, (entry.years.get(p.year) ?? 0) + 1);
  }

  const combos = [...acc.entries()].map<ExamCombo>(([slug, e]) => {
    const yearCounts = [...e.years.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
    return {
      slug,
      examTypeName: e.examTypeName,
      level: e.level,
      label: comboLabel(e.examTypeName, e.level),
      count: e.count,
      years: yearCounts.map((y) => y.year),
      yearCounts,
      examTypeOrder: e.examTypeOrder,
    };
  });

  combos.sort(
    (a, b) =>
      a.examTypeOrder - b.examTypeOrder ||
      b.count - a.count ||
      a.slug.localeCompare(b.slug, "ko"),
  );
  return combos;
}

// ── 오늘의 학습 현황 카드 (웹 app/page.tsx TodayStudy 의 집계부) ──────────────

export type TodayStudyAttempt = {
  score: number | null;
  total_questions: number | null;
  created_at: string;
};

export type TodayStudyData = {
  todayAttempts: number;
  // 전체 응시의 정답률(%). 응시가 없으면 null.
  accuracyPct: number | null;
  streakDays: number;
  // 이번 주 월~일, 그날 푼 문항 수. 막대 높이는 이 배열의 최댓값 기준.
  week: number[];
  // 0=월 … 6=일 (KST)
  todayIndex: number;
  attemptCount: number;
  wrongCount: number;
};

// 비회원에게 보여주는 예시("예시 화면" 표기). 진단 문턱 상수에서 한 회차 모자란 상태로
// 두어 "AI 약점 진단까지 응시 2/3" 줄이 보이게 한다.
export const SAMPLE_TODAY_STUDY: TodayStudyData = {
  todayAttempts: 2,
  accuracyPct: 84,
  streakDays: 7,
  week: [38, 55, 46, 72, 61, 88, 24],
  todayIndex: 5,
  attemptCount: DIAGNOSIS_MIN_ATTEMPTS - 1,
  wrongCount: 5,
};

// 본인 응시 행(RLS) + 진단 자격 카운트 → 카드 한 장. 이번 주는 KST 월요일부터 7일.
// kstDateKey 는 "YYYY-MM-DD" 라 UTC 자정으로 파싱해 요일을 구해도 어긋나지 않는다.
export function computeTodayStudy(
  attempts: readonly TodayStudyAttempt[],
  counts: { attemptCount: number; wrongCount: number },
  now: Date = new Date(),
): TodayStudyData {
  const todayKey = kstDateKey(now);
  const todayUtc = new Date(`${todayKey}T00:00:00Z`);
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7;
  const weekKeys = Array.from({ length: 7 }, (_, i) =>
    new Date(todayUtc.getTime() + (i - mondayOffset) * 86_400_000).toISOString().slice(0, 10),
  );
  const week = weekKeys.map(() => 0);
  let todayAttempts = 0;
  let score = 0;
  let total = 0;
  for (const a of attempts) {
    const key = kstDateKey(new Date(a.created_at));
    if (key === todayKey) todayAttempts++;
    const i = weekKeys.indexOf(key);
    if (i >= 0) week[i] += a.total_questions ?? 0;
    score += a.score ?? 0;
    total += a.total_questions ?? 0;
  }
  return {
    todayAttempts,
    accuracyPct: total > 0 ? Math.round((score / total) * 100) : null,
    streakDays: computeStreakDays(attempts.map((a) => a.created_at)),
    week,
    todayIndex: mondayOffset,
    attemptCount: counts.attemptCount,
    wrongCount: counts.wrongCount,
  };
}

// ── AI 약점 진단 주기·소개 화면 CTA (웹 lib/ai-diagnosis.ts·lib/diagnosis-limits.ts·
//    app/diagnosis/page.tsx ctaFor) ───────────────────────────────────────────

// 진단 주기(일). 마지막으로 진단을 받은 날로부터 이만큼 지나야 다시 받을 수 있다.
export const DIAGNOSIS_CYCLE_DAYS = 7;

// 분석 창(일). 진단이 보는 것은 **최근 7일 동안 틀린 문제**뿐이다 — 그래프의 기본 기간도,
// 극복법이 실제로 훑는 기간도 같은 7일이다.
export const DIAGNOSIS_WINDOW_DAYS = 7;

// 맞춤 극복법의 개념 수 전체 상한(요금이 개념 수에 정비례한다 — 웹 lib/diagnosis-limits.ts
// 머리말). 배치(apps/web/scripts/next-diagnosis.mjs)는 plain node 라 같은 값을 복제해 두었다 —
// 바꿀 때 반드시 함께 고칠 것.
export const COACH_MAX_TOTAL = 10;

// 오늘(KST) "YYYY-MM-DD". (attendance.ts kstDateKey 와 같은 값 — 웹 ai-diagnosis.ts 의 이름.)
export function kstToday(now: Date = new Date()): string {
  return kstDateKey(now);
}

function kstDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(`${kstToday(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// 지금 주기의 시작 날짜(YYYY-MM-DD). "이 날짜 이후의 진단 행이 있으면 이번 주기는 이미
// 썼다"가 잠금의 정의다. 조회와 관리자 초기화가 **같은 경계**를 써야 한다.
export function currentCycleStartDate(now: Date = new Date()): string {
  return kstDaysAgo(DIAGNOSIS_CYCLE_DAYS - 1, now);
}

// 주기가 풀리는 날(YYYY-MM-DD) — 마지막으로 받은 날 + 7일. 화면 안내용.
export function nextDiagnosisDate(lastDate: string): string {
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAGNOSIS_CYCLE_DAYS);
  return d.toISOString().slice(0, 10);
}

// 오늘(KST)부터 그 날짜까지 남은 일수. 이미 지났으면 0.
export function daysUntilKst(date: string, now: Date = new Date()): number {
  const to = Date.parse(`${date}T00:00:00Z`);
  const from = Date.parse(`${kstToday(now)}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// 자격 문턱(웹 getDiagnosisEligibility 의 판정부): 오답 15개 또는 응시 3회.
export function isDiagnosisEligible(counts: { attemptCount: number; wrongCount: number }): boolean {
  return computeDiagnosisProgress(counts).eligible;
}

// 자격 미달일 때의 안내 한 줄(웹 getDiagnosisEligibility hint).
export const DIAGNOSIS_LOCKED_HINT = `문제를 조금 더 풀면 진단을 받을 수 있어요 (오답 ${DIAGNOSIS_MIN_WRONG}개 또는 ${DIAGNOSIS_MIN_ATTEMPTS}회 응시).`;

// 소개 페이지의 버튼은 하나뿐이다 — 지금 이 사람이 할 수 있는 단 하나의 다음 행동.
// 로그인 → 멤버십 → 문제 더 풀기 → 진단 보기 순으로 막히는 곳을 먼저 푼다.
export type DiagnosisIntroCta = { href: string; label: string; note: string | null };

export function diagnosisIntroCta({
  loggedIn,
  premium,
  eligible,
  daysLeft,
}: {
  loggedIn: boolean;
  premium: boolean;
  eligible: boolean;
  // 다음 진단까지 남은 일수(이번 주기에 이미 받았을 때만).
  daysLeft: number | null;
}): DiagnosisIntroCta {
  if (!loggedIn) {
    return {
      href: `/login?next=${encodeURIComponent("/diagnosis")}`,
      label: "로그인하고 시작하기",
      note: null,
    };
  }
  if (!premium) {
    return {
      href: `/membership?next=${encodeURIComponent("/diagnosis")}`,
      label: "멤버십 보러 가기",
      note: "AI 약점 진단은 멤버십 기능이에요.",
    };
  }
  if (!eligible) {
    return {
      href: "/mypage?tab=wrong-notes",
      label: "문제 풀러 가기",
      note: `오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회를 넘기면 진단이 열려요.`,
    };
  }
  if (daysLeft != null && daysLeft > 0) {
    return {
      href: "/mypage/diagnosis",
      label: "내 진단 보기",
      note: `다음 진단은 ${daysLeft}일 뒤부터 받을 수 있어요.`,
    };
  }
  return { href: "/mypage/diagnosis", label: "진단 받으러 가기", note: null };
}
