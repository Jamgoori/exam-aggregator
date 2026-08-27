import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { WrongQuestionSample } from "@/lib/diagnosis-live";
import type { DiagnosisConceptCoaching } from "@/lib/ai-diagnosis";

// 맞춤 극복법(AI)의 프롬프트와 응답 파싱. 이 파일만이 "모델에게 뭘 물어보는지"를 안다.
//
// 따로 떼어 둔 이유는 같은 질문을 두 경로가 쓰기 때문이다:
//  - 즉시 생성(lib/diagnosis-generate.ts) — 눌렀을 때 그 자리에서 Messages API 1콜
//  - 배치 생성(lib/diagnosis-batch.ts)   — Message Batches API 로 모아 보내고 나중에 수거
// 프롬프트가 두 벌이 되면 같은 사용자가 경로에 따라 다른 품질의 극복법을 받게 되고,
// 한쪽만 고친 채 배포되는 사고가 반드시 난다. 문구를 고칠 일이 있으면 여기만 고칠 것.

export const DIAGNOSIS_MODEL = process.env.ANTHROPIC_DIAGNOSIS_MODEL || "claude-opus-5";

export type CoachInput = {
  concept: string;
  // 정본 개념 id(없으면 미분류 개념). 표본을 고르고 묶는 키.
  conceptId: string | null;
  // 지식형/기능형 — 조언의 방향이 갈린다(개념 학습 vs 풀이 전략).
  conceptKind: string | null;
  subject: string | null;
  // 과목 slug. 모델에게 보내지 않는다 — 응답을 받은 뒤 카드에 다시 붙이는 용도라
  // 여기(질문을 만든 대상 목록)에 같이 실어 둔다. 배치 경로는 이 목록을 그대로
  // 저장해 두었다가 몇 시간 뒤 수거할 때 쓴다.
  subjectSlug: string | null;
  // 이 기간에 틀린 문항 수 / 푼 문항 수. 모델이 "몇 개 중 몇 개"로 심각도를 읽는다.
  wrongCount: number;
  answeredCount: number;
  accuracyPct: number | null;
};

// 상위 개념들에 대해 weakPattern/howToOvercome 을 한 번에 물어보는 요청 본문을 만든다.
// (호출은 하지 않는다 — 즉시 경로는 messages.create 로, 배치 경로는 batches.create 의
// 한 요청으로 이걸 그대로 싣는다. targets 가 비어 있으면 부르지 말 것: 빈 입력으로
// 모델을 부르면 요금만 나간다.)
//
// 입력에는 통계뿐 아니라 "실제로 틀린 문항"의 발문·정답·유저가 고른 오답 선지가 함께
// 들어간다. 통계만 주면 모델이 문제를 본 적이 없어 "판례 위주로 반복하세요" 같은
// 일반론밖에 못 낸다 — 유형을 짚으려면 문항을 봐야 한다.
export function buildCoachingParams(
  targets: CoachInput[],
  samples: WrongQuestionSample[],
): Anthropic.MessageCreateParamsNonStreaming {
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

  return {
    model: DIAGNOSIS_MODEL,
    // 개념 20개 × 두 문장이면 4,000 토큰으로는 잘린다. 잘린 JSON 은 파싱에서 조용히
    // 실패해 극복법이 0개가 되고, 생성은 주기당 1회라 그 주가 통째로 빈다. 넉넉히 두되
    // SDK 타임아웃에 걸리지 않는 범위(비스트리밍 권장 상한)로 잡는다.
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
  };
}

// 모델 응답(JSON 텍스트)을 화면이 쓰는 코칭 배열로 되돌린다. 즉시 경로는 방금 받은
// 응답을, 배치 경로는 몇 시간 뒤 수거한 결과를 같은 함수로 읽는다.
//
// targets 는 "그때 무엇을 물어봤는지"다 — 모델이 개념 이름을 지어냈거나 입력에 없던
// 개념을 끼워 넣으면 여기서 버린다. subjectSlug 도 모델이 아니라 우리 데이터에서 붙인다.
export function parseCoachingItems(
  text: string,
  targets: { concept: string; subject: string | null; subjectSlug: string | null }[],
): DiagnosisConceptCoaching[] {
  if (!text.trim()) return [];
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
      subjectSlug: t.subjectSlug,
      weakPattern: it.weakPattern.trim(),
      howToOvercome: it.howToOvercome.trim(),
    });
  }
  return out;
}
