import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { COACH_MAX_TOTAL, COACH_PER_SUBJECT } from "@/lib/diagnosis-limits";
import {
  getDiagnosisAggregate,
  getWrongQuestionSamples,
  type ConceptStat,
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

type CoachInput = {
  concept: string;
  // 정본 개념 id(없으면 미분류 개념). 표본을 고르고 묶는 키.
  conceptId: string | null;
  // 지식형/기능형 — 조언의 방향이 갈린다(개념 학습 vs 풀이 전략).
  conceptKind: string | null;
  subject: string | null;
  // 이 기간에 틀린 문항 수 / 푼 문항 수. 모델이 "몇 개 중 몇 개"로 심각도를 읽는다.
  wrongCount: number;
  answeredCount: number;
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
    "핵심 함정을 짚을 것. 과장·위로성 표현 없이 담백하게. 각 항목 1~2문장, 한국어.\n" +
    "발문이 '옳지 않은 것 / 적절하지 않은 것 / 아닌 것'을 묻는 문항에서는 '고른 선지가 사실은 " +
    "맞는 설명이었다', '발문의 부정 방향을 놓쳤다'를 진단으로 쓰지 말 것 — 그런 문항은 정답 하나만 " +
    "틀린 진술이라 오답이면 반드시 맞는 선지를 고르게 된다. 아무나 해당하는 동어반복이라 " +
    "이 수험생에 대해 아무것도 말해 주지 않는다. 이 유형에서는 '내가고른선지'가 아니라 " +
    "**놓친 정답 진술(정답근거)**이 무엇을 요구했는지를 근거로 삼을 것.";

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
      answeredCount: t.answeredCount,
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
    // 개념 20개 × 두 문장이면 4,000 토큰으로는 잘린다. 잘린 JSON 은 아래 JSON.parse 에서
    // 조용히 실패해 극복법이 0개가 되고, 자동 생성은 주기당 1회라 그 주가 통째로 빈다.
    // 넉넉히 두되 SDK 타임아웃에 걸리지 않는 범위(비스트리밍 권장 상한)로 잡는다.
    max_tokens: 16000,
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
  // 이번 분석이 훑을 기간(일) — 마지막 진단일부터 오늘까지, 최대 2주
  // (ai-diagnosis.ts analysisWindowDays). 창이 곧 프롬프트 크기이자 요금이라
  // widen:false 로 넘겨 절대 넓어지지 않게 한다.
  windowDays: number,
  // 사용자가 진단에서 뺀 과목 slug. 극복법 대상에서만 빠진다 — 막대그래프는 무AI라
  // 그대로 다 보여준다.
  excludedSubjectSlugs: Set<string> = new Set(),
): Promise<{ status: "ready" | "pending"; error?: string }> {
  const agg = await getDiagnosisAggregate(userId, { days: windowDays, widen: false });

  // 그 기간에 틀린 게 없으면 만들 리포트가 없다. 여기서 끊지 않으면 빈 입력으로
  // API를 호출해 요금만 나간다.
  if (agg.concepts.length === 0) {
    return {
      status: "pending",
      error: `최근 ${windowDays}일 동안 새로 틀린 문제가 없어요. 문제를 좀 더 풀고 다시 받아보세요.`,
    };
  }

  const weakConcepts = toWeakConcepts(agg);
  const subjectTrends = toSubjectTrends(agg);

  // 고른 과목에서 틀린 게 없으면 만들 극복법이 없다. 빈 입력으로 API 를 부르지 않는다.
  if (pickCoachTargets(agg, excludedSubjectSlugs).length === 0) {
    return {
      status: "pending",
      error: "진단할 과목을 하나 이상 선택해주세요(고른 과목에 최근 오답이 없어요).",
    };
  }

  const targets = pickCoachTargets(agg, excludedSubjectSlugs);
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
        answeredCount: t.answeredCount,
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
