import type { SupabaseClient } from "@supabase/supabase-js";
import { DIAGNOSIS_WINDOW_DAYS } from "../data/home";
import { pickCoachTargets } from "../diagnosis-targets";
import {
  conceptSelectionKey,
  type AiDiagnosisReport,
  type DiagnosisConceptCoaching,
  type DiagnosisConceptSelection,
  type DiagnosisSubjectTrend,
  type DiagnosisWeakConcept,
} from "../diagnosis-report";
import {
  buildCoachingParams,
  DIAGNOSIS_MODEL_DEFAULT,
  type CoachInput,
  type DiagnosisMessageParams,
} from "../diagnosis-coach";
import { getDiagnosisAggregate, type DiagnosisAggregate } from "./diagnosis-aggregate";
import { getWrongQuestionSamples } from "./diagnosis-samples";

// AI 약점 진단 리포트의 "준비"와 "저장" — 웹 `lib/diagnosis-generate.ts` 에서 옮겼다
// (설계서 §6.8). 옮긴 것은 두 경로가 공유하던 순수 준비 단계뿐이고, 웹 전용 즉시 생성
// (`runDiagnosisForUser`, Messages API 스트리밍)은 웹에 남는다.
//
// 왜 core 인가: 제출 경로가 셋이 됐다 — 웹 서버 액션, 웹 크론, 그리고 Edge
// `diagnosis-request`(요청한 그 자리에서 제출). 준비 단계가 웹에만 있으면 Edge 는 사본을
// 갖거나 크론을 기다려야 하는데, 사본은 프롬프트·표본 수·개념 상한이 갈리는 순간 요금과
// 품질이 함께 갈리고 그 사실은 청구서에서 처음 보인다.
//
// 이 파일이 하는 일:
//   1) 리포트의 무AI 부분(요약·개념 목록·과목 추세)을 집계에서 만든다.
//   2) 코칭 대상 개념을 고르고(core pickCoachTargets), 그 개념들의 실제 오답 표본을 읽어
//      **개념 하나당 요청 하나**짜리 모델 요청 본문을 만든다.
//   3) 만들어진 극복법을 `ai_diagnoses.report` 에 저장한다(이미 채워져 있으면 덮지 않는다).
// 모델을 부르는 것은 여기가 아니다 — 부르는 쪽은 rules/diagnosis-batch.ts(배치)와 웹 즉시
// 생성이다. 빈 입력으로 모델을 부르면 요금만 나가므로, 만들 게 없으면 여기서 사유를 돌려준다.

// 개념마다 모델에 함께 넣을 "실제로 틀린 문항" 표본 수. 이 값과 표본 truncate 길이가 1회
// 요금을 정한다 — 개념 10 × 문항 8 × 약 600자 ≈ 5만 자(입력 30K 토큰 남짓). 늘리기 전에
// 비용을 다시 계산할 것.
//
// 6에서 8로 올린 이유: 극복법이 문항별 근거(evidence)를 쓰게 되면서 표본 수가 곧
// "내 이야기"의 개수가 됐다. 3~4개만 보이면 원인 분석이 다시 일반론으로 돌아간다.
const SAMPLES_PER_CONCEPT = 8;

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

// 요청 하나 = 개념 하나. 예전에는 개념 10개를 한 요청에 실었는데, 모델은 한 응답 안에서
// 개념을 앞에서부터 차례로 쓰므로 생성 시간이 개념 수에 정비례했다(10개면 10개째가 끝날
// 때까지 아무것도 못 본다). 개념별로 갈라 동시에 보내면 전체는 가장 오래 걸리는 개념 하나
// 시간으로 줄고, 프롬프트·모델·effort·스키마는 그대로라 극복법의 모양은 같다 — 오히려
// 요청마다 thinking 이 그 개념 하나에만 쓰이고, 한 응답이 길어질수록 뒤쪽 개념이 짧아지던
// 버릇도 사라진다. 한 요청이 잘리거나 실패해도 그 개념 하나만 빠진다.
export type CoachingRequest = {
  // targets 안에서 이 요청이 맡은 개념의 위치. 배치 custom_id 와 수거 시 정렬 키다.
  index: number;
  target: CoachInput;
  params: DiagnosisMessageParams;
};

export type CoachingPlan = {
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  targets: CoachInput[];
  // 개념 하나당 요청 하나. targets 와 같은 순서.
  requests: CoachingRequest[];
};

export type CoachingPlanDeps = {
  // 실제로 부를 모델. 기본은 core 상수 하나(DIAGNOSIS_MODEL_DEFAULT)이고, 어댑터가
  // 환경변수를 resolveDiagnosisModel 로 풀어 넘긴다 — 요금에 닿는 값이라 여기서 새로
  // 만들지 않는다.
  model?: string;
};

// 배치·즉시 두 경로가 공유하는 준비 단계. 이 기간에 무엇을 틀렸는지 집계하고, 코칭 대상
// 개념을 고르고, 그 개념들의 실제 오답 문항 표본까지 읽어 요청 본문을 만든다.
//
// 만들 것이 없으면(그 기간에 오답이 없다·고른 과목에 오답이 없다) error 를 돌려준다 —
// 빈 입력으로 모델을 부르면 요금만 나가므로 반드시 호출부에서 끊어야 한다.
export async function planCoaching(
  admin: SupabaseClient,
  userId: string,
  // 사용자가 진단에서 뺀 과목 slug. 극복법 대상에서만 빠진다 — 막대그래프는 무AI라
  // 그대로 다 보여준다.
  excludedSubjectSlugs: Set<string> = new Set(),
  // 사용자가 요청할 때 고른 개념(ai_diagnoses.selected_concepts). null 이면 자동 선정.
  selectedConcepts: DiagnosisConceptSelection[] | null = null,
  deps: CoachingPlanDeps = {},
): Promise<{ plan?: CoachingPlan; error?: string }> {
  // 분석 창은 언제나 최근 7일(DIAGNOSIS_WINDOW_DAYS)이다. 창이 곧 프롬프트 크기이자
  // 요금이라 widen:false 로 넘겨 절대 넓어지지 않게 한다 — 그 기간에 오답이 없으면
  // 조용히 90일치를 긁는 대신 아래에서 사유를 돌려준다.
  const agg = await getDiagnosisAggregate(admin, userId, {
    days: DIAGNOSIS_WINDOW_DAYS,
    widen: false,
  });

  if (agg.concepts.length === 0) {
    return {
      error: `최근 ${DIAGNOSIS_WINDOW_DAYS}일 동안 새로 틀린 문제가 없어요. 문제를 좀 더 풀고 다시 받아보세요.`,
    };
  }

  const picked = pickCoachTargets(agg, excludedSubjectSlugs, selectedConcepts);
  if (picked.length === 0) {
    return {
      error:
        selectedConcepts && selectedConcepts.length > 0
          ? `고른 개념에 최근 ${DIAGNOSIS_WINDOW_DAYS}일 오답이 없어요. 개념을 다시 골라주세요.`
          : "진단할 과목을 하나 이상 선택해주세요(고른 과목에 최근 오답이 없어요).",
    };
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
    admin,
    userId,
    targets.map((t) => ({ conceptId: t.conceptId, concept: t.concept })),
    SAMPLES_PER_CONCEPT,
  );

  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;

  // 표본은 개념 키(정본 id 우선)로 나눈다 — 표시 이름은 과목이 다르면 겹칠 수 있다.
  // buildCoachingParams 도 같은 키로 표본을 붙이므로, 개념 하나짜리 요청에는 그 개념의
  // 표본만 넘긴다(전부 넘겨도 결과는 같지만 "이 요청이 무엇을 보는지"가 분명해진다).
  const requests: CoachingRequest[] = targets.map((target, index) => ({
    index,
    target,
    params: buildCoachingParams(
      [target],
      samples.filter((s) => s.conceptKey === conceptSelectionKey(target)),
      model,
    ),
  }));

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
      requests,
    },
  };
}

// 준비된 리포트 뼈대에 코칭을 얹어 ai_diagnoses.report 에 저장한다. 즉시 경로와 배치
// 수거(웹 크론·Edge `diagnosis-collect`)가 같은 함수를 쓴다 — 저장 모양이 갈라지면 화면이
// 경로에 따라 다르게 그려진다.
export async function saveDiagnosisReport(
  admin: SupabaseClient,
  diagnosisId: string,
  skeleton: Omit<AiDiagnosisReport, "conceptCoaching">,
  conceptCoaching: DiagnosisConceptCoaching[],
  model: string = DIAGNOSIS_MODEL_DEFAULT,
  now: Date = new Date(),
): Promise<{ error?: string }> {
  const report: AiDiagnosisReport = { ...skeleton, conceptCoaching };
  // report 가 아직 비어 있을 때만 쓴다. 배치는 제출과 수거가 몇 시간 떨어져 있어서, 그
  // 사이에 다른 경로(즉시 생성·수동 배치 scripts/save-diagnosis.mjs·앱이 부른
  // `diagnosis-collect`)가 이미 채워 뒀을 수 있다. 그걸 덮어쓰면 사용자가 보던 리포트가
  // 더 오래된 내용으로 바뀐다. 0행 갱신(이미 채워짐)은 오류가 아니다 — 목표 상태는 이미
  // 이뤄져 있다. 수거가 두 번 도는 경우의 **마지막 방어선**이 이 조건이다(첫 방어선은
  // rules/diagnosis-batch.ts 의 행 선점).
  const { error } = await admin
    .from("ai_diagnoses")
    .update({ report, model, generated_at: now.toISOString() })
    .eq("id", diagnosisId)
    .is("report", null);
  return error ? { error: "진단 저장에 실패했어요." } : {};
}
