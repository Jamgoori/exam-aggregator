import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDiagnosisAggregate,
  getWrongQuestionSamples,
  type DiagnosisAggregate,
  type WrongQuestionSample,
} from "@/lib/diagnosis-live";
import type {
  AiDiagnosisReport,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";

// AI 약점 진단의 "생성기". 마이페이지 "진단받기"를 누른 시점에 온디맨드로 돈다.
// 무AI 데이터(막대그래프·오답패턴)는 페이지가 라이브로 그리고, 여기서는 AI가 필요한
// 부분 — 개념별 "맞춤 극복법"만 실API로 만든다. 결과를 report에 담아 주 1회 캐시한다.
//
// 실비 API가 붙는 지점이라 실패/키 미설정에 안전해야 한다: 생성이 안 되면 report를
// 비운 채(pending) 두고, 기존 배치 생성기가 나중에 채우게 한다(호출부에서 처리).

const MODEL = process.env.ANTHROPIC_DIAGNOSIS_MODEL || "claude-opus-5";
// 코칭할 상위 취약 개념 수(1콜 묶음). 비용 상한 = 유저당 이 개수만큼의 짧은 생성.
const COACH_TOP_N = 5;
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
    resolvedCount: c.resolvedCount,
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

// 코칭 대상 개념: 미극복 우선 + wrongCount 높은 순으로 상위 N.
function pickCoachTargets(agg: DiagnosisAggregate) {
  return [...agg.concepts]
    .sort(
      (a, b) =>
        Number(a.resolvedCount >= a.wrongCount) - Number(b.resolvedCount >= b.wrongCount) ||
        b.wrongCount - a.wrongCount,
    )
    .slice(0, COACH_TOP_N);
}

type CoachInput = {
  concept: string;
  // 정본 개념 id(없으면 미분류 개념). 표본을 고르고 묶는 키.
  conceptId: string | null;
  // 지식형/기능형 — 조언의 방향이 갈린다(개념 학습 vs 풀이 전략).
  conceptKind: string | null;
  subject: string | null;
  wrongCount: number;
  resolvedCount: number;
  accuracyPct: number | null;
};

// AI 호출: 상위 개념들에 대해 weakPattern/howToOvercome을 1콜로 생성한다. 실패하면 빈
// 배열(호출부가 pending 처리).
//
// 입력에는 통계뿐 아니라 "실제로 틀린 문항"의 발문·정답·유저가 고른 오답 선지가 함께
// 들어간다. 통계만 주면 모델이 문제를 본 적이 없어 "판례 위주로 반복하세요" 같은
// 일반론밖에 못 낸다 — 유형을 짚으려면 문항을 봐야 한다.
async function generateCoaching(
  targets: CoachInput[],
  subjectSlugByConcept: Map<string, string | null>,
  samples: WrongQuestionSample[],
): Promise<DiagnosisConceptCoaching[]> {
  if (targets.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic();

  const system =
    "당신은 한국 공무원·자격 시험 학습 코치입니다. 수험생이 실제로 틀린 문항들(발문 요약, " +
    "정답과 그 근거, 수험생이 고른 오답 선지와 그 선지가 틀린 이유)을 개념별로 받아, 각 " +
    "개념마다 (1) 이 사람이 이 개념에서 무너지는 지점이 무엇인지 — 고른 오답들에서 드러나는 " +
    "공통된 오개념이나 문제 유형을 구체적으로, (2) 그것을 어떻게 극복할지 — 오늘 당장 할 수 " +
    "있는 행동으로 조언합니다.\n" +
    "규칙: 반드시 주어진 문항들에서 드러난 근거로만 말할 것. 입력에 없는 수치·과목·개념·판례를 " +
    "지어내지 말 것. 표본이 적어 공통점이 안 보이면 억지로 패턴을 만들지 말고 그 개념의 " +
    "핵심 함정을 짚을 것. 과장·위로성 표현 없이 담백하게. 각 항목 1~2문장, 한국어.";

  // 표본은 개념 키(정본 id 우선)로 묶는다 — 표시 이름은 과목이 다르면 겹칠 수 있다.
  const conceptKeyOf = (c: { conceptId: string | null; concept: string }) =>
    c.conceptId ?? `kw:${c.concept.trim()}`;
  const samplesByConcept = new Map<string, WrongQuestionSample[]>();
  for (const s of samples) {
    const list = samplesByConcept.get(s.conceptKey) ?? [];
    list.push(s);
    samplesByConcept.set(s.conceptKey, list);
  }

  const userPayload = {
    concepts: targets.map((t) => ({
      concept: t.concept,
      subject: t.subject,
      // 지식형이면 "개념을 모른다", 기능형이면 "이 유형 풀이에 약하다" 쪽으로 조언한다.
      유형: t.conceptKind === "skill" ? "문제풀이 기능" : "지식 개념",
      wrongCount: t.wrongCount,
      resolvedCount: t.resolvedCount,
      accuracyPct: t.accuracyPct,
      // 이 개념에서 실제로 틀린 문항들. pickedChoice가 없으면 CBT 응시 기록이 없는
      // 문항(섞어풀기 등)이라 "무엇을 골랐는지"는 알 수 없다.
      wrongQuestions: (samplesByConcept.get(conceptKeyOf(t)) ?? []).map((s) => ({
        발문: s.questionText,
        정답: s.correctChoice,
        정답근거: s.correctSummary,
        내가고른선지: s.pickedChoice,
        그선지가틀린이유: s.pickedReason,
      })),
    })),
  };

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            concept: { type: "string" },
            weakPattern: { type: "string" },
            howToOvercome: { type: "string" },
          },
          required: ["concept", "weakPattern", "howToOvercome"],
        },
      },
    },
    required: ["items"],
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // effort는 그대로 비용이다. 통계만 넣던 때는 low로 충분했지만, 이제는 문항 여러
    // 개에서 공통 오개념을 찾아야 해서 medium으로 둔다. 더 올리기 전에 결과를 눈으로
    // 비교할 것 — 체감이 없으면 요금만 오른다.
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content:
          "다음은 한 수험생이 개념별로 실제 틀린 문항들입니다. 개념마다 이 사람이 무너지는 " +
          "지점과 극복법을 만들어 주세요. 입력 JSON:\n" +
          JSON.stringify(userPayload),
      },
    ],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) return [];

  let parsed: { items?: { concept: string; weakPattern: string; howToOvercome: string }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = parsed.items ?? [];

  // AI가 준 concept 키를 우리 데이터의 subject/subjectSlug와 다시 묶는다(AI가 slug를 짓지
  // 않도록). 입력에 없던 개념은 버린다.
  const targetByConcept = new Map(targets.map((t) => [t.concept, t]));
  const out: DiagnosisConceptCoaching[] = [];
  for (const it of items) {
    const t = targetByConcept.get(it.concept);
    if (!t) continue;
    if (!it.weakPattern?.trim() || !it.howToOvercome?.trim()) continue;
    out.push({
      concept: t.concept,
      subject: t.subject,
      subjectSlug: subjectSlugByConcept.get(t.concept) ?? null,
      weakPattern: it.weakPattern.trim(),
      howToOvercome: it.howToOvercome.trim(),
    });
  }
  return out;
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

// 진단 리포트를 만들어 ai_diagnoses.report에 저장한다. 성공 시 "ready", AI 코칭을 만들지
// 못하면(키 미설정·API 실패) report는 비운 채로 두고 "pending"을 돌려준다(배치가 채우도록).
export async function runDiagnosisForUser(
  diagnosisId: string,
  userId: string,
): Promise<{ status: "ready" | "pending"; error?: string }> {
  const agg = await getDiagnosisAggregate(userId);

  const weakConcepts = toWeakConcepts(agg);
  const subjectTrends = toSubjectTrends(agg);

  const targets = pickCoachTargets(agg);
  const subjectSlugByConcept = new Map(agg.concepts.map((c) => [c.concept, c.subjectSlug]));

  let conceptCoaching: DiagnosisConceptCoaching[] = [];
  try {
    // 코칭 대상 개념에 한해서만 문항 표본을 읽는다(전체 오답을 다 읽으면 요금이 뛴다).
    const samples = await getWrongQuestionSamples(
      userId,
      targets.map((t) => ({ conceptId: t.conceptId, concept: t.concept })),
      SAMPLES_PER_CONCEPT,
    );
    conceptCoaching = await generateCoaching(
      targets.map((t) => ({
        concept: t.concept,
        conceptId: t.conceptId,
        conceptKind: t.conceptKind,
        subject: t.subject,
        wrongCount: t.wrongCount,
        resolvedCount: t.resolvedCount,
        accuracyPct: t.accuracyPct,
      })),
      subjectSlugByConcept,
      samples,
    );
  } catch {
    conceptCoaching = [];
  }

  // AI 코칭이 하나도 없으면 "생성 실패"로 보고 report를 비운 채 pending. 데이터층(막대그래프)은
  // 페이지가 라이브로 그리므로 사용자 경험이 완전히 비지는 않는다.
  if (conceptCoaching.length === 0) {
    return { status: "pending" };
  }

  const report: AiDiagnosisReport = {
    summary: buildSummary(agg),
    weakConcepts,
    subjectTrends,
    mission: null,
    insights: null,
    conceptCoaching,
  };

  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_diagnoses")
    .update({ report, model: MODEL, generated_at: new Date().toISOString() })
    .eq("id", diagnosisId);
  if (error) return { status: "pending", error: "진단 저장에 실패했어요." };

  return { status: "ready" };
}
