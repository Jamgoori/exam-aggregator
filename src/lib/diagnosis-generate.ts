import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDiagnosisAggregate, type DiagnosisAggregate } from "@/lib/diagnosis-live";
import type {
  AiDiagnosisReport,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";

// AI 약점 진단의 "생성기". 마이페이지 "진단받기"를 누른 시점에 온디맨드로 돈다.
// 무AI 데이터(막대그래프·오답패턴)는 페이지가 라이브로 그리고, 여기서는 AI가 필요한
// 부분 — 개념별 "맞춤 극복법"만 실API로 만든다. 결과를 report에 담아 하루 1회 캐시한다.
//
// 실비 API가 붙는 지점이라 실패/키 미설정에 안전해야 한다: 생성이 안 되면 report를
// 비운 채(pending) 두고, 기존 배치 생성기가 나중에 채우게 한다(호출부에서 처리).

const MODEL = process.env.ANTHROPIC_DIAGNOSIS_MODEL || "claude-opus-4-8";
// 코칭할 상위 취약 개념 수(1콜 묶음). 비용 상한 = 유저당 이 개수만큼의 짧은 생성.
const COACH_TOP_N = 5;

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
  subject: string | null;
  wrongCount: number;
  resolvedCount: number;
  accuracyPct: number | null;
};

// AI 호출: 상위 개념들에 대해 weakPattern/howToOvercome을 1콜로 생성한다. 실패하면 빈
// 배열(호출부가 pending 처리). 정답 자체는 입력에 없다(개념명·통계뿐).
async function generateCoaching(
  targets: CoachInput[],
  subjectSlugByConcept: Map<string, string | null>,
): Promise<DiagnosisConceptCoaching[]> {
  if (targets.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic();

  const system =
    "당신은 한국 공무원·자격 시험 학습 코치입니다. 수험생의 취약 개념 통계를 보고, " +
    "각 개념마다 (1) 같은 개념 안에서 주로 어떤 유형의 문제를 틀리는지, (2) 어떻게 극복하면 " +
    "좋을지를 담백하고 실천 가능하게 조언합니다. 규칙: 입력에 없는 수치·과목·개념을 지어내지 " +
    "말 것. 과장·위로성 표현 없이 구체적 행동으로. 각 항목 1~2문장, 한국어. 정답이나 특정 " +
    "문항 내용은 알 수 없으니 개념 학습 전략 수준에서 조언할 것.";

  const userPayload = {
    concepts: targets.map((t) => ({
      concept: t.concept,
      subject: t.subject,
      wrongCount: t.wrongCount,
      resolvedCount: t.resolvedCount,
      accuracyPct: t.accuracyPct,
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
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content:
          "다음 취약 개념들에 대해 개념별 극복 코칭을 만들어 주세요. 입력 JSON:\n" +
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
    conceptCoaching = await generateCoaching(
      targets.map((t) => ({
        concept: t.concept,
        subject: t.subject,
        wrongCount: t.wrongCount,
        resolvedCount: t.resolvedCount,
        accuracyPct: t.accuracyPct,
      })),
      subjectSlugByConcept,
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
