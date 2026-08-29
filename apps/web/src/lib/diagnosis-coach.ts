import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { WrongQuestionSample } from "@/lib/diagnosis-live";
import type {
  DiagnosisCoachingEvidence,
  DiagnosisCoachingStep,
  DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";

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

// 개념마다 만들 배열의 개수 상한. 모델이 20개를 쏟아내면 카드가 스크롤 벽이 되고
// 출력 요금만 늘어난다 — 프롬프트로 범위를 주고, 파싱에서 한 번 더 자른다.
const MAX_EVIDENCE = 6;
const MAX_STEPS = 5;
const MAX_CHECKPOINTS = 5;

// 상위 개념들에 대해 개념별 진단(무너지는 지점·원인·문항별 근거·극복 계획·체크리스트)을
// 한 번에 물어보는 요청 본문을 만든다. (호출은 하지 않는다 — 즉시 경로는 messages.create
// 로, 배치 경로는 batches.create 의 한 요청으로 이걸 그대로 싣는다. targets 가 비어 있으면
// 부르지 말 것: 빈 입력으로 모델을 부르면 요금만 나간다.)
//
// 입력에는 통계뿐 아니라 "실제로 틀린 문항"의 발문·정답·유저가 고른 오답 선지가 함께
// 들어간다. 통계만 주면 모델이 문제를 본 적이 없어 "판례 위주로 반복하세요" 같은
// 일반론밖에 못 낸다 — 유형을 짚으려면 문항을 봐야 한다.
//
// 요구하는 분량을 키운 이유: 두 문장(무너지는 지점 + 조언)만 받던 때는 결과물이
// "개념별 풀이법 사전"과 구별되지 않았다. 그런 건 개념마다 미리 써 두고 꺼내 주면
// 되는 것이라 굳이 사람마다 AI를 돌릴 이유가 없다. 프리미엄으로 값을 받는 이상,
// **이 사람이 고른 오답에서 출발한 진단**이어야 한다 — 그래서 원인(rootCause)과
// 문항별 근거(evidence)를 따로 받는다. 그 둘이 이 기능이 파는 것 자체다.
export function buildCoachingParams(
  targets: CoachInput[],
  samples: WrongQuestionSample[],
): Anthropic.MessageCreateParamsNonStreaming {
  // 개념은 최근 7일(DIAGNOSIS_WINDOW_DAYS) 오답에서 골랐지만, 아래 표본 문항은 그 개념에서
  // **지금까지** 틀린 것들이다(user_question_status 축). 프롬프트가 "최근 7일에 틀린
  // 문항"이라고 말하면 모델이 없는 시점을 근거로 쓰게 되므로 기간을 주장하지 않는다.
  const system =
    "당신은 한국 공무원·자격 시험 학습 코치입니다. 한 수험생이 개념별로 실제 틀린 " +
    "문항들을 받습니다 — 발문 요약, 정답과 그 근거, 그 사람이 고른 오답 선지와 그 선지가 " +
    "틀린 이유, 같은 문항을 몇 번 틀렸는지까지.\n" +
    "\n" +
    "당신이 쓸 것은 개념 설명이 아니라 **이 사람 한 명에 대한 진단서**입니다. 판단 기준은 " +
    "하나입니다: 여기서 이 사람의 오답 기록을 빼면 남는 말이 없어야 합니다. 개념만 보고 " +
    "누구에게나 쓸 수 있는 학습법(예: '기출을 반복하세요', '개념을 정리하세요')은 쓰지 마세요 — " +
    "그런 내용이라면 개념마다 미리 써 두면 되는 것이라 이 진단은 실패입니다.\n" +
    "\n" +
    "개념마다 아래를 씁니다.\n" +
    "1) weakPattern — 이 개념에서 무너지는 지점(2~4문장). 고른 오답들에 공통으로 흐르는 " +
    "판단 방식을 짚습니다.\n" +
    "2) rootCause — 왜 그렇게 골랐는지(3~5문장). 무엇을 무엇으로 착각했는지, 어떤 판단 단계를 " +
    "건너뛰었는지, 어떤 지식이 반쯤만 잡혀 있는지. 증상이 아니라 원인을 씁니다.\n" +
    "3) evidence — 입력에 있는 문항에 한해, 문항마다 한 덩이씩. question 은 그 문항이 무엇을 " +
    "물었는지 한 줄, myChoice 는 '내가고른선지'가 무엇이었고 그게 어떤 판단이었는지(기록이 " +
    "없으면 null), insight 는 그 선택이 드러내는 착각. 최대 " + `${MAX_EVIDENCE}` + "개.\n" +
    "4) steps — 오늘부터의 극복 계획 3~" + `${MAX_STEPS}` + "단계. title 은 할 일 이름, detail 은 " +
    "무엇을 어떻게 하는지(예: '정답 선지 5개를 옮겨 적고 각 문장에서 조건절에 밑줄'), minutes 는 " +
    "예상 소요 시간(분). 순서대로 실행할 수 있어야 합니다.\n" +
    "5) checkpoints — 시험장에서 같은 유형을 만났을 때 순서대로 확인할 것 3~" +
    `${MAX_CHECKPOINTS}` + "개. 각 한 줄, 생각이 아니라 동작으로.\n" +
    "6) trap — 이 개념 문항에서 반복되는 함정 한 줄.\n" +
    "7) howToOvercome — 처방 한 줄 요약(steps 를 한 문장으로).\n" +
    "\n" +
    "규칙:\n" +
    "- 반드시 주어진 문항들에서 드러난 근거로만 말할 것. 입력에 없는 수치·과목·개념·판례·조문·" +
    "교재명·강의명을 지어내지 말 것. 문항 수나 정답률을 다시 계산해 쓰지 말 것.\n" +
    "- 표본이 적어 공통점이 안 보이면 억지로 패턴을 만들지 말고, 놓친 정답 진술이 무엇을 " +
    "요구했는지와 그 개념의 핵심 함정을 근거로 쓸 것.\n" +
    "- 분량은 충분히 써도 됩니다. 다만 같은 말을 표현만 바꿔 반복하지 말 것 — 길이는 근거의 " +
    "개수에서 나와야 합니다.\n" +
    "- 과장·위로·응원 문구 없이 담백하게. 수험생 본인에게 '~해요/~하세요' 체로 직접 말할 것.\n" +
    "- 발문이 '옳지 않은 것 / 적절하지 않은 것 / 아닌 것'을 묻는 문항에서는 '고른 선지가 사실은 " +
    "맞는 설명이었다', '발문의 부정 방향을 놓쳤다'를 진단으로 쓰지 말 것 — 그런 문항은 정답 하나만 " +
    "틀린 진술이라 오답이면 반드시 맞는 선지를 고르게 된다. 아무나 해당하는 동어반복이라 " +
    "이 수험생에 대해 아무것도 말해 주지 않는다. 이 유형에서는 '내가고른선지'가 아니라 " +
    "**놓친 정답 진술(정답근거)**이 무엇을 요구했는지를 근거로 삼을 것.\n" +
    "- 같은 문항을 여러 번 틀렸다면(틀린횟수 2 이상) 그 사실을 원인 분석에 반영할 것 — 한 번 " +
    "보고 넘긴 것과 다시 걸린 것은 처방이 다릅니다.";

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
        틀린횟수: s.wrongTimes,
        // 마지막에 맞혔는지. "다시 걸렸다"와 "이미 잡았다"를 구분해 준다.
        지금은맞히는지: s.resolved,
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
            concept: { type: "string", description: "입력에 있던 개념 이름 그대로" },
            weakPattern: { type: "string", description: "무너지는 지점 2~4문장" },
            rootCause: { type: "string", description: "왜 그렇게 골랐는지 3~5문장" },
            evidence: {
              type: "array",
              description: `입력에 있는 오답 문항별 근거(최대 ${MAX_EVIDENCE}개)`,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  question: { type: "string" },
                  // 응시 기록이 없어 무엇을 골랐는지 모르는 문항이 있다. 그때 지어내지
                  // 않도록 null 을 허용한다(스키마가 문자열만 받으면 모델이 채운다).
                  myChoice: { anyOf: [{ type: "string" }, { type: "null" }] },
                  insight: { type: "string" },
                },
                required: ["question", "myChoice", "insight"],
              },
            },
            steps: {
              type: "array",
              description: `오늘부터의 극복 계획(3~${MAX_STEPS}단계)`,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                  minutes: { type: "integer", description: "예상 소요 시간(분)" },
                },
                required: ["title", "detail", "minutes"],
              },
            },
            checkpoints: {
              type: "array",
              description: `시험장 체크리스트(3~${MAX_CHECKPOINTS}개)`,
              items: { type: "string" },
            },
            trap: { type: "string", description: "반복되는 함정 한 줄" },
            howToOvercome: { type: "string", description: "처방 한 줄 요약" },
          },
          required: [
            "concept",
            "weakPattern",
            "rootCause",
            "evidence",
            "steps",
            "checkpoints",
            "trap",
            "howToOvercome",
          ],
        },
      },
    },
    required: ["items"],
  };

  return {
    model: DIAGNOSIS_MODEL,
    // 개념 15개 × (원인 분석 + 문항별 근거 + 계획 + 체크리스트)면 예전 상한(16K)으로는
    // 잘린다. 잘린 JSON 은 파싱에서 조용히 실패해 극복법이 0개가 되고, 생성은 주기당
    // 1회라 그 주가 통째로 빈다(요금은 이미 나갔다). 상한은 지출 목표가 아니라 안전망이다.
    //
    // ⚠️ 이 값이 21,333(=128K/6)을 넘으면 SDK 가 **비스트리밍 요청을 아예 거부한다**
    // (client.calculateNonstreamingTimeout: 10분 넘을 요청은 스트리밍 필수). 배치 경로는
    // 비동기라 상관없지만, 즉시 경로(diagnosis-generate.ts)는 그래서 messages.stream 을
    // 쓴다 — 그쪽을 messages.create 로 되돌리면 이 상한에서 즉시 예외가 난다.
    max_tokens: 48000,
    // effort 는 그대로 비용이다(thinking 토큰이 출력 요금으로 붙는다). 여러 문항의 오답
    // 선지에서 공통 원인을 찾는 일이라 high 가 이상적이지만, 요금 대비 체감을 보고
    // medium 으로 운영한다 — 프롬프트와 스키마(원인·근거·계획·체크리스트)는 그대로라
    // 결과의 "모양"은 같고, 근거를 얼마나 파고드느냐가 달라진다.
    // 결과가 다시 일반론으로 흐르면 개념 수를 줄이기 전에 여기를 high 로 되돌릴 것.
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content:
          "다음은 한 수험생이 개념별로 실제 틀린 문항들입니다. 개념마다 이 사람이 무너지는 " +
          "지점과 그 원인, 문항별 근거, 극복 계획을 만들어 주세요. 입력 JSON:\n" +
          JSON.stringify(userPayload),
      },
    ],
  };
}

// 문자열 하나를 다듬어 돌려준다(공백뿐이면 null).
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// 모델이 준 배열을 상한까지 자르고, 빈 항목을 버린다. 상한은 프롬프트에도 적혀 있지만
// 화면 레이아웃이 모델의 성실함에 좌우되면 안 된다.
function list<T>(v: unknown, max: number, map: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : null;
}

function toEvidence(item: unknown): DiagnosisCoachingEvidence | null {
  const o = (item ?? {}) as Record<string, unknown>;
  const question = str(o.question);
  const insight = str(o.insight);
  if (!question || !insight) return null;
  return { question, myChoice: str(o.myChoice), insight };
}

function toStep(item: unknown): DiagnosisCoachingStep | null {
  const o = (item ?? {}) as Record<string, unknown>;
  const title = str(o.title);
  const detail = str(o.detail);
  if (!title || !detail) return null;
  // 소요 시간은 있으면 좋은 정보일 뿐이다 — 이상한 값이 오면 버리고 나머지를 살린다.
  const minutes =
    typeof o.minutes === "number" && Number.isFinite(o.minutes) && o.minutes > 0
      ? Math.round(o.minutes)
      : null;
  return { title, detail, minutes };
}

// 모델 응답(JSON 텍스트)을 화면이 쓰는 코칭 배열로 되돌린다. 즉시 경로는 방금 받은
// 응답을, 배치 경로는 몇 시간 뒤 수거한 결과를 같은 함수로 읽는다.
//
// targets 는 "그때 무엇을 물어봤는지"다 — 모델이 개념 이름을 지어냈거나 입력에 없던
// 개념을 끼워 넣으면 여기서 버린다. subjectSlug·conceptId 도 모델이 아니라 우리
// 데이터에서 붙인다(모델에게 id 를 짓게 하지 않는다).
//
// weakPattern/howToOvercome 이 비면 그 개념은 버리되, 새로 추가된 필드(원인·근거·계획)는
// 없어도 살린다. 응답 한 덩이가 조금 부실하다고 통째로 버리면 그 주기의 극복법이 통째로
// 사라지는데, 생성은 주 1회고 요금은 이미 나갔다.
export function parseCoachingItems(
  responseText: string,
  targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
  }[],
): DiagnosisConceptCoaching[] {
  if (!responseText.trim()) return [];
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  const targetByConcept = new Map(targets.map((t) => [t.concept, t]));
  const out: DiagnosisConceptCoaching[] = [];
  for (const raw of items) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const t = targetByConcept.get(typeof it.concept === "string" ? it.concept : "");
    if (!t) continue;
    const weakPattern = str(it.weakPattern);
    const howToOvercome = str(it.howToOvercome);
    if (!weakPattern || !howToOvercome) continue;
    out.push({
      concept: t.concept,
      conceptId: t.conceptId ?? null,
      subject: t.subject,
      subjectSlug: t.subjectSlug,
      weakPattern,
      howToOvercome,
      rootCause: str(it.rootCause),
      evidence: list(it.evidence, MAX_EVIDENCE, toEvidence),
      steps: list(it.steps, MAX_STEPS, toStep),
      checkpoints: list(it.checkpoints, MAX_CHECKPOINTS, (v) => str(v)),
      trap: str(it.trap),
    });
  }
  return out;
}
