import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DIAGNOSIS_MODEL,
  buildCoachingParams,
  parseCoachingItems,
  type CoachInput,
} from "@/lib/diagnosis-coach";
import { conceptSelectionKey } from "@/lib/diagnosis-limits";
import { pickCoachTargets } from "@gongmoa/core";
import {
  getDiagnosisAggregate,
  getWrongQuestionSamples,
  type DiagnosisAggregate,
} from "@/lib/diagnosis-live";
import { DIAGNOSIS_WINDOW_DAYS } from "@/lib/ai-diagnosis";
import type {
  AiDiagnosisReport,
  DiagnosisConceptSelection,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";

// AI 약점 진단의 "생성기". 무AI 데이터(막대그래프·개념 카드)는 페이지가 라이브로 그리고,
// 여기서는 AI가 필요한 부분 — 개념별 "맞춤 극복법"만 실API로 만든다.
//
// 이 파일이 담당하는 것은 두 가지다:
//  1) 리포트의 무AI 부분(요약·개념 목록·과목 추세)과 코칭 대상 선정 — 두 경로가 공유한다.
//  2) **즉시 생성**(Messages API, 개념마다 1콜을 동시에). 눌렀을 때 그 자리에서 결과를
//     채우는 경로다.
// 기본 경로는 배치(lib/diagnosis-batch.ts, Message Batches API)다 — 주 1회짜리 기능이라
// 몇 분 늦게 와도 되고 요금이 절반이다. 즉시 생성은 ANTHROPIC_DIAGNOSIS_SYNC=1 일 때만
// 쓰며(운영 중 급히 결과를 확인해야 할 때의 탈출구), 실패하면 report 를 비운 채 pending 으로
// 남겨 배치가 나중에 채우게 한다.

const MODEL = DIAGNOSIS_MODEL;
// 개념 수 상한은 lib/diagnosis-limits.ts 에 있다(선택창과 같은 숫자를 써야 한다).
// 개념마다 모델에 함께 넣을 "실제로 틀린 문항" 표본 수. 이 값과 diagnosis-live 의
// truncate 길이가 1회 요금을 정한다 — 개념 15 × 문항 8 × 약 600자 ≈ 7만 자(입력 40K
// 토큰 남짓). 늘리기 전에 비용을 다시 계산할 것.
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

// 코칭 대상 개념 선정(pickCoachTargets)은 core diagnosis-targets.ts 가 정본이다 —
// 웹 생성기(여기)·웹 진단 페이지의 "추천" 체크·Edge `diagnosis-aggregate` 의 선택창이
// 같은 개념을 골라야 하기 때문이다(한 벌 더 쓰면 같은 계정이 웹과 앱에서 다른 추천을
// 받는다). 기존 import 경로는 그대로 살린다.
export { pickCoachTargets } from "@gongmoa/core";

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
//
// 요청은 **개념 하나당 하나**다. 예전에는 개념 10개를 한 요청에 실었는데, 모델은 한
// 응답 안에서 개념을 앞에서부터 차례로 쓰므로 생성 시간이 개념 수에 정비례했다(10개면
// 10개째가 끝날 때까지 아무것도 못 본다). 개념별로 갈라 동시에 보내면 전체는 가장 오래
// 걸리는 개념 하나 시간으로 줄고, 프롬프트·모델·effort·스키마는 그대로라 극복법의 모양은
// 같다 — 오히려 요청마다 thinking 이 그 개념 하나에만 쓰이고, 한 응답이 길어질수록 뒤쪽
// 개념이 짧아지던 버릇도 사라진다. 한 요청이 잘리거나 실패해도 그 개념 하나만 빠진다.
export type CoachingRequest = {
  // targets 안에서 이 요청이 맡은 개념의 위치. 배치 custom_id 와 수거 시 정렬 키다.
  index: number;
  target: CoachInput;
  params: Anthropic.MessageCreateParamsNonStreaming;
};

export type CoachingPlan = {
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  targets: CoachInput[];
  // 개념 하나당 요청 하나. targets 와 같은 순서.
  requests: CoachingRequest[];
};

export async function planCoaching(
  userId: string,
  // 사용자가 진단에서 뺀 과목 slug. 극복법 대상에서만 빠진다 — 막대그래프는 무AI라
  // 그대로 다 보여준다.
  excludedSubjectSlugs: Set<string> = new Set(),
  // 사용자가 요청할 때 고른 개념(ai_diagnoses.selected_concepts). null 이면 자동 선정.
  selectedConcepts: DiagnosisConceptSelection[] | null = null,
): Promise<{ plan?: CoachingPlan; error?: string }> {
  // 분석 창은 언제나 최근 7일(DIAGNOSIS_WINDOW_DAYS)이다. 창이 곧 프롬프트 크기이자
  // 요금이라 widen:false 로 넘겨 절대 넓어지지 않게 한다 — 그 기간에 오답이 없으면
  // 조용히 90일치를 긁는 대신 아래에서 사유를 돌려준다.
  const agg = await getDiagnosisAggregate(userId, {
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
    userId,
    targets.map((t) => ({ conceptId: t.conceptId, concept: t.concept })),
    SAMPLES_PER_CONCEPT,
  );

  // 표본은 개념 키(정본 id 우선)로 나눈다 — 표시 이름은 과목이 다르면 겹칠 수 있다.
  // buildCoachingParams 도 같은 키로 표본을 붙이므로, 개념 하나짜리 요청에는 그 개념의
  // 표본만 넘긴다(전부 넘겨도 결과는 같지만 "이 요청이 무엇을 보는지"가 분명해진다).
  const requests: CoachingRequest[] = targets.map((target, index) => ({
    index,
    target,
    params: buildCoachingParams(
      [target],
      samples.filter((s) => s.conceptKey === conceptSelectionKey(target)),
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

// 즉시 생성(Messages API, 개념마다 1콜을 동시에). ANTHROPIC_DIAGNOSIS_SYNC=1 일 때만
// 호출부가 이 경로를 탄다 — 평소에는 배치(lib/diagnosis-batch.ts)가 절반 요금으로 만든다.
// 성공하면 "ready", 만들지 못하면(키 미설정·API 실패) report 는 비운 채 "pending"을
// 돌려준다(배치가 나중에 채운다).
export async function runDiagnosisForUser(
  diagnosisId: string,
  userId: string,
  excludedSubjectSlugs: Set<string> = new Set(),
  selectedConcepts: DiagnosisConceptSelection[] | null = null,
): Promise<{ status: "ready" | "pending"; error?: string }> {
  const { plan, error } = await planCoaching(userId, excludedSubjectSlugs, selectedConcepts);
  if (!plan) return { status: "pending", error };

  // 이 기능 전용 키다. 레포에 ANTHROPIC_API_KEY 를 읽는 곳이 이 파일 말고도 있다
  // (scripts/extract-answer-keys.mjs — 정답 추출 배치, 완전히 다른 용도). 같은 변수
  // 이름을 쓰면 여기 등록한 키가 그쪽에서도 그대로 읽혀 의도치 않게 그 배치의 실API
  // 요금까지 이 키로 나간다. 그래서 이 기능만 별도 변수명으로 읽는다.
  const apiKey = process.env.ANTHROPIC_DIAGNOSIS_API_KEY;
  if (!apiKey) return { status: "pending" };

  // 개념별 요청을 **동시에** 보낸다(배치 경로와 같은 분할). 하나씩 기다리면 예전처럼
  // 개념 수만큼 오래 걸리고, 서버리스 함수가 그 시간을 통째로 붙들고 있어야 한다.
  // 한 요청이 실패하면 그 개념만 빠진다 — 배치 경로의 저장 규칙(유효한 것은 남기고
  // 하나도 없을 때만 실패)과 같다.
  //
  // 스트리밍으로 받는다(결과는 finalMessage 로 한 번에 읽는다). 개념 1개짜리 요청의
  // max_tokens 는 SDK 의 비스트리밍 상한 아래지만, 여러 개념을 한 요청에 싣는 경우까지
  // 같은 코드가 감당하므로(diagnosis-coach.ts max_tokens 주석 참고) stream 을 유지한다.
  const client = new Anthropic({ apiKey });
  const settled = await Promise.allSettled(
    plan.requests.map(async (r) => {
      const response = await client.messages.stream(r.params).finalMessage();
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return parseCoachingItems(text, [r.target]);
    }),
  );
  // 요청 순서 = 개념 순서. 결과가 도착한 순서가 아니라 물어본 순서로 싣는다.
  const conceptCoaching: DiagnosisConceptCoaching[] = settled.flatMap((s) =>
    s.status === "fulfilled" ? s.value : [],
  );

  // AI 코칭이 하나도 없으면 "생성 실패"로 보고 report를 비운 채 pending. 데이터층(막대그래프)은
  // 페이지가 라이브로 그리므로 사용자 경험이 완전히 비지는 않는다.
  if (conceptCoaching.length === 0) return { status: "pending" };

  const saved = await saveDiagnosisReport(diagnosisId, plan.report, conceptCoaching);
  if (saved.error) return { status: "pending", error: saved.error };
  return { status: "ready" };
}
