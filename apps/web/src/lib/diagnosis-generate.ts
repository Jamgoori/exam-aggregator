import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DIAGNOSIS_MODEL,
  buildCoachingParams,
  parseCoachingItems,
  type CoachInput,
} from "@/lib/diagnosis-coach";
import { COACH_MAX_TOTAL, COACH_PER_SUBJECT } from "@/lib/diagnosis-limits";
import {
  getDiagnosisAggregate,
  getWrongQuestionSamples,
  type ConceptStat,
  type DiagnosisAggregate,
} from "@/lib/diagnosis-live";
import type {
  AiDiagnosisReport,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";

// AI 약점 진단의 "생성기". 무AI 데이터(막대그래프·개념 카드)는 페이지가 라이브로 그리고,
// 여기서는 AI가 필요한 부분 — 개념별 "맞춤 극복법"만 실API로 만든다.
//
// 이 파일이 담당하는 것은 두 가지다:
//  1) 리포트의 무AI 부분(요약·개념 목록·과목 추세)과 코칭 대상 선정 — 두 경로가 공유한다.
//  2) **즉시 생성**(Messages API 1콜). 눌렀을 때 그 자리에서 결과를 채우는 경로다.
// 기본 경로는 배치(lib/diagnosis-batch.ts, Message Batches API)다 — 주 1회짜리 기능이라
// 몇 분 늦게 와도 되고 요금이 절반이다. 즉시 생성은 ANTHROPIC_DIAGNOSIS_SYNC=1 일 때만
// 쓰며(운영 중 급히 결과를 확인해야 할 때의 탈출구), 실패하면 report 를 비운 채 pending 으로
// 남겨 배치가 나중에 채우게 한다.

const MODEL = DIAGNOSIS_MODEL;
// 개념 수 상한은 lib/diagnosis-limits.ts 에 있다(선택창과 같은 숫자를 써야 한다).
// 개념마다 모델에 함께 넣을 "실제로 틀린 문항" 표본 수. 이 값과 diagnosis-live 의
// truncate 길이가 1회 요금을 정한다 — 개념 5 × 문항 6 × 약 300자 ≈ 9천 자(입력 10K
// 토큰 남짓, 회당 수백 원). 늘리기 전에 비용을 다시 계산할 것.
const SAMPLES_PER_CONCEPT = 6;

// corpusCount(전체 기출 빈도)를 유저 개념 집합 안에서 3분위로 눌러 1~3점. next-diagnosis와
// 같은 규칙 — 절대 스케일을 모르므로 상대 분위로 "자주 나오는데 약한 것"을 가린다.
function frequencyTerciles(corpusCounts: number[]): (n: number) => number | null {
  const counts = corpusCounts.filter((n) => n > 0).sort((a, b) => a - b);
  const q1 = counts.length ? counts[Math.floor(counts.length / 3)] : 0;
  const q2 = counts.length ? counts[Math.floor((counts.length * 2) / 3)] : 0;
  return (n: number) => (n <= 0 ? null : n > q2 ? 3 : n > q1 ? 2 : 1);
}

function toWeakConcepts(agg: DiagnosisAggregate): DiagnosisWeakConcept[] {
  const freq = frequencyTerciles(agg.concepts.map((c) => c.corpusCount));
  return agg.concepts.map((c) => ({
    concept: c.concept,
    subject: c.subject,
    subjectSlug: c.subjectSlug,
    wrongCount: c.wrongCount,
    // 리포트 스키마의 필드지만 진단은 더 이상 극복 여부를 세지 않는다(기간 안에
    // 무엇을 틀렸는지만 본다). 앱이 값이 있을 때만 그리므로 null 로 둔다.
    resolvedCount: null,
    frequency: freq(c.corpusCount),
    accuracyPct: c.accuracyPct,
  }));
}

function toSubjectTrends(agg: DiagnosisAggregate): DiagnosisSubjectTrend[] {
  return agg.subjects
    .filter((s) => s.recentScores.length > 0)
    .map((s) => {
      const scores = s.recentScores;
      let trend: DiagnosisSubjectTrend["trend"] = "flat";
      if (scores.length >= 2) {
        const first = scores[0];
        const last = scores[scores.length - 1];
        if (last - first >= 5) trend = "up";
        else if (first - last >= 5) trend = "down";
      }
      const last = scores[scores.length - 1];
      const note =
        scores.length >= 2
          ? `최근 ${scores.length}회 ${scores.join(" → ")}점.`
          : `최근 ${last}점.`;
      return { subject: s.name, trend, note, scores };
    });
}

// 코칭 대상 개념을 고른다. 과목 안에서는 많이 틀린 순, 동률이면 정답률이 낮은 쪽을
// 먼저 — 같은 3문항이라도 "5문항 중 3개"가 "20문항 중 3개"보다 급하다.
//
// 과목당 COACH_PER_SUBJECT 개까지 뽑되 전체가 COACH_MAX_TOTAL 을 넘지 않게, 순위별로
// 돌아가며(1위끼리 → 2위끼리 → …) 채운다. 과목 순서대로 7개씩 채우면 상한에 걸릴 때
// 뒤쪽 과목이 통째로 빠지는데, 그러면 "내 과목은 아예 안 봐주네"가 된다.
//
// excludedSubjectSlugs 는 사용자가 진단에서 뺀 과목이다. 빼는 만큼 남은 과목이 상한을
// 더 깊게 쓴다.
export function pickCoachTargets(agg: DiagnosisAggregate, excludedSubjectSlugs: Set<string>) {
  const bySubject = new Map<string, ConceptStat[]>();
  for (const c of agg.concepts) {
    const slug = c.subjectSlug ?? "";
    if (slug && excludedSubjectSlugs.has(slug)) continue;
    const list = bySubject.get(slug) ?? [];
    if (list.length >= COACH_PER_SUBJECT) continue;
    list.push(c);
    bySubject.set(slug, list);
  }
  // 과목 순서는 그 과목에서 틀린 문항이 많은 쪽부터 — 상한에 걸려 잘리는 자리는
  // 오답이 적은 과목의 하위 개념이어야 한다.
  const groups = [...bySubject.values()].sort(
    (a, b) =>
      b.reduce((n, c) => n + c.wrongCount, 0) - a.reduce((n, c) => n + c.wrongCount, 0),
  );
  for (const g of groups) {
    g.sort((a, b) => b.wrongCount - a.wrongCount || (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101));
  }

  const picked: ConceptStat[] = [];
  for (let rank = 0; rank < COACH_PER_SUBJECT && picked.length < COACH_MAX_TOTAL; rank++) {
    for (const g of groups) {
      if (picked.length >= COACH_MAX_TOTAL) break;
      if (g[rank]) picked.push(g[rank]);
    }
  }
  return picked;
}

// 담백한 요약 한 줄(무AI). 가장 시급한 개념과 안정권 과목을 데이터로만 짚는다.
function buildSummary(agg: DiagnosisAggregate): string {
  const top = agg.concepts[0];
  const parts: string[] = [];
  if (top) {
    const where = top.subject ? `${top.subject} ` : "";
    parts.push(`가장 시급한 약점은 ${where}'${top.concept}'예요(${top.wrongCount}회 틀림).`);
  }
  const up = agg.subjects.find((s) => {
    const sc = s.recentScores;
    return sc.length >= 2 && sc[sc.length - 1] - sc[0] >= 5;
  });
  if (up) parts.push(`${up.name}은(는) 점수가 오르는 중이에요.`);
  return parts.join(" ") || "오답을 개념별로 정리했어요. 하나씩 잡아봐요.";
}

// 두 경로(즉시·배치)가 공유하는 준비 단계. 이 기간에 무엇을 틀렸는지 집계하고,
// 코칭 대상 개념을 고르고, 그 개념들의 실제 오답 문항 표본까지 읽어 온다.
//
// 만들 것이 없으면(그 기간에 오답이 없다·고른 과목에 오답이 없다) error 를 돌려준다 —
// 빈 입력으로 모델을 부르면 요금만 나가므로 반드시 호출부에서 끊어야 한다.
export type CoachingPlan = {
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  targets: CoachInput[];
  params: Anthropic.MessageCreateParamsNonStreaming;
};

export async function planCoaching(
  userId: string,
  // 이번 분석이 훑을 기간(일) — 마지막 진단일부터 오늘까지, 최대 2주
  // (ai-diagnosis.ts analysisWindowDays). 창이 곧 프롬프트 크기이자 요금이라
  // widen:false 로 넘겨 절대 넓어지지 않게 한다.
  windowDays: number,
  // 사용자가 진단에서 뺀 과목 slug. 극복법 대상에서만 빠진다 — 막대그래프는 무AI라
  // 그대로 다 보여준다.
  excludedSubjectSlugs: Set<string> = new Set(),
): Promise<{ plan?: CoachingPlan; error?: string }> {
  const agg = await getDiagnosisAggregate(userId, { days: windowDays, widen: false });

  if (agg.concepts.length === 0) {
    return {
      error: `최근 ${windowDays}일 동안 새로 틀린 문제가 없어요. 문제를 좀 더 풀고 다시 받아보세요.`,
    };
  }

  const picked = pickCoachTargets(agg, excludedSubjectSlugs);
  if (picked.length === 0) {
    return { error: "진단할 과목을 하나 이상 선택해주세요(고른 과목에 최근 오답이 없어요)." };
  }

  const targets: CoachInput[] = picked.map((t) => ({
    concept: t.concept,
    conceptId: t.conceptId,
    conceptKind: t.conceptKind,
    subject: t.subject,
    subjectSlug: t.subjectSlug,
    wrongCount: t.wrongCount,
    answeredCount: t.answeredCount,
    accuracyPct: t.accuracyPct,
  }));

  // 코칭 대상 개념에 한해서만 문항 표본을 읽는다(전체 오답을 다 읽으면 요금이 뛴다).
  const samples = await getWrongQuestionSamples(
    userId,
    targets.map((t) => ({ conceptId: t.conceptId, concept: t.concept })),
    SAMPLES_PER_CONCEPT,
  );

  return {
    plan: {
      report: {
        summary: buildSummary(agg),
        weakConcepts: toWeakConcepts(agg),
        subjectTrends: toSubjectTrends(agg),
        mission: null,
        insights: null,
      },
      targets,
      params: buildCoachingParams(targets, samples),
    },
  };
}

// 준비된 리포트 뼈대에 코칭을 얹어 ai_diagnoses.report 에 저장한다. 즉시 경로와 배치
// 수거가 같은 함수를 쓴다 — 저장 모양이 갈라지면 화면이 경로에 따라 다르게 그려진다.
export async function saveDiagnosisReport(
  diagnosisId: string,
  skeleton: Omit<AiDiagnosisReport, "conceptCoaching">,
  conceptCoaching: DiagnosisConceptCoaching[],
): Promise<{ error?: string }> {
  const report: AiDiagnosisReport = { ...skeleton, conceptCoaching };
  const admin = createAdminClient();
  // report 가 아직 비어 있을 때만 쓴다. 배치는 제출과 수거가 몇 시간 떨어져 있어서, 그
  // 사이에 다른 경로(즉시 생성·수동 배치 scripts/save-diagnosis.mjs)가 이미 채워 뒀을 수
  // 있다. 그걸 덮어쓰면 사용자가 보던 리포트가 더 오래된 내용으로 바뀐다.
  // 0행 갱신(이미 채워짐)은 오류가 아니다 — 목표 상태는 이미 이뤄져 있다.
  const { error } = await admin
    .from("ai_diagnoses")
    .update({ report, model: MODEL, generated_at: new Date().toISOString() })
    .eq("id", diagnosisId)
    .is("report", null);
  return error ? { error: "진단 저장에 실패했어요." } : {};
}

// 즉시 생성(Messages API 1콜). ANTHROPIC_DIAGNOSIS_SYNC=1 일 때만 호출부가 이 경로를
// 탄다 — 평소에는 배치(lib/diagnosis-batch.ts)가 절반 요금으로 만든다.
// 성공하면 "ready", 만들지 못하면(키 미설정·API 실패) report 는 비운 채 "pending"을
// 돌려준다(배치가 나중에 채운다).
export async function runDiagnosisForUser(
  diagnosisId: string,
  userId: string,
  windowDays: number,
  excludedSubjectSlugs: Set<string> = new Set(),
): Promise<{ status: "ready" | "pending"; error?: string }> {
  const { plan, error } = await planCoaching(userId, windowDays, excludedSubjectSlugs);
  if (!plan) return { status: "pending", error };

  // 이 기능 전용 키다. 레포에 ANTHROPIC_API_KEY 를 읽는 곳이 이 파일 말고도 있다
  // (scripts/extract-answer-keys.mjs — 정답 추출 배치, 완전히 다른 용도). 같은 변수
  // 이름을 쓰면 여기 등록한 키가 그쪽에서도 그대로 읽혀 의도치 않게 그 배치의 실API
  // 요금까지 이 키로 나간다. 그래서 이 기능만 별도 변수명으로 읽는다.
  const apiKey = process.env.ANTHROPIC_DIAGNOSIS_API_KEY;
  if (!apiKey) return { status: "pending" };

  let conceptCoaching: DiagnosisConceptCoaching[] = [];
  try {
    const response = await new Anthropic({ apiKey }).messages.create(plan.params);
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    conceptCoaching = parseCoachingItems(text, plan.targets);
  } catch {
    conceptCoaching = [];
  }

  // AI 코칭이 하나도 없으면 "생성 실패"로 보고 report를 비운 채 pending. 데이터층(막대그래프)은
  // 페이지가 라이브로 그리므로 사용자 경험이 완전히 비지는 않는다.
  if (conceptCoaching.length === 0) return { status: "pending" };

  const saved = await saveDiagnosisReport(diagnosisId, plan.report, conceptCoaching);
  if (saved.error) return { status: "pending", error: saved.error };
  return { status: "ready" };
}
