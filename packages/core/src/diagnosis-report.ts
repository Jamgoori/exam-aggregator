// AI 약점 진단 리포트의 모양과 개념 선택 정규화 — 웹·앱·Edge 가 같은 스키마를 본다.
//
// 원본은 웹 `apps/web/src/lib/ai-diagnosis.ts` 의 타입 뭉치였다. 거기 두면 `server-only`
// 파일이라 앱이 못 읽고(설계서 §6.8 `edge/contracts.ts` 행 — "앱 lib 지역 타입뿐"),
// 결국 앱이 리포트를 그리려고 같은 모양을 한 벌 더 적게 된다. 리포트는 `ai_diagnoses.report`
// 한 컬럼에 들어 있는 JSON 이고 앱은 그 행을 RLS 로 직접 읽으므로(§6.7 #21), 스키마가
// 갈리는 순간 화면이 조용히 빈 카드를 그린다.
//
// 값을 만드는 쪽은 웹 생성기(`lib/diagnosis-generate.ts` + Vercel 크론 `/api/cron/diagnosis`)
// 하나뿐이다 — Edge 도 앱도 리포트를 **쓰지 않는다**. 여기 있는 것은 타입과, 그 타입을
// 만들기 전에 클라이언트 입력을 자르는 순수 규칙뿐이다.
//
// ⚠ 리포트 본문은 디스크에 남기지 않는다(앱 AGENTS.md 금지선 — 메모리 쿼리캐시만).

import { COACH_MAX_TOTAL } from "./data/home";

// 화면이 안정적으로 그리도록 구조화한 리포트. 생성기는 이 스키마에 맞춰 저장한다.
// 자유 서술 마크다운이 아니라 필드로 받아, UI가 취약 개념→모아보기 딥링크 등으로
// 이어줄 수 있게 한다. 모든 배열/필드는 있는 것만 그린다.
export type DiagnosisWeakConcept = {
  concept: string;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number | null;
  resolvedCount: number | null;
  // 출제 빈도(1~3점). 전체 기출에서 이 개념이 얼마나 자주 나오는지를 생성기가 코퍼스
  // 빈도로 3분위 눌러 넣는다. "가성비 우선순위"(자주 나오는데 약한 것 먼저)의 근거.
  // 없으면 화면이 빈도 뱃지를 숨긴다.
  frequency?: number | null;
  // 내 정답률(%). 생성기가 계산해 줄 수 있으면 채운다. 없으면 화면이 극복 진행도
  // (resolvedCount/wrongCount)로 대체 표시하므로 지어내지 말 것.
  accuracyPct?: number | null;
};

export type DiagnosisSubjectTrend = {
  subject: string;
  // "up" | "down" | "flat" — 최근 응시 추세.
  trend: "up" | "down" | "flat";
  note: string;
  // 최근 회차 정오율(%) 배열, 오래된→최신. 스파크라인용. 없으면 화면은 추세 화살표만 그린다.
  scores?: number[] | null;
};

// 히어로(오늘의 1분 미션): 한 줄 요약과 시작 버튼 목적지. "지금 당장 뭘 하면 되는지".
export type DiagnosisMission = {
  // 예: "컴퓨터일반 '서브넷 마스크 계산'만 잡으면 예상 점수 +5점". 데이터 근거 한 줄.
  headline: string;
  // 미션 시작 버튼이 섞어풀기를 만들 과목 slug. 없으면 버튼은 오답노트 허브로 보낸다.
  subjectSlug?: string | null;
  // 미션이 겨냥하는 개념명(강조 표시용). 선택.
  concept?: string | null;
};

// AI 오답 패턴(자주 낚이는 선지 유형)을 문장형으로 짚어주는 인사이트. 선택.
export type DiagnosisInsight = {
  subject?: string | null;
  // 예: "정보보호론에서 'MAC과 DAC의 차이'를 묻는 함정 선지에 오답률이 높아요". 한 문장.
  text: string;
  // 오답률(%). 강조 뱃지용. 없으면 숨김.
  wrongRatePct?: number | null;
};

// 내가 실제로 틀린 문항 하나에 대한 진단. "당신은 이 문제에서 3번을 골랐고, 그 선택은
// ~을 ~로 착각했을 때 나온다" — 극복법이 일반론이 아니라 **내 이야기**로 읽히게 하는
// 부분이다. 문항 자체(발문·정답)는 우리 데이터에서 왔고, insight 만 AI가 쓴다.
export type DiagnosisCoachingEvidence = {
  // 어떤 문제였는지 한 줄 요약.
  question: string;
  // 내가 고른 선지가 무엇이었고 그게 어떤 판단이었는지. CBT 응시 기록이 없는 문항
  // (섞어풀기만 푼 경우)은 무엇을 골랐는지 알 수 없어 null.
  myChoice?: string | null;
  // 그 선택이 드러내는 착각·구멍.
  insight: string;
};

// 극복 계획의 한 단계. 순서가 곧 실행 순서다.
export type DiagnosisCoachingStep = {
  title: string;
  detail: string;
  // 예상 소요(분). "오늘 25분"처럼 실행 단위를 잡아 준다. 없으면 화면이 숨긴다.
  minutes?: number | null;
};

// 개념별 "맞춤 극복법"(AI). 진단받기 시점에 고른 개념들을 한 번에 생성해 report에
// 캐시한다(주 1회 재사용). 표시 방식은 화면 자유 — 데이터만 담아둔다.
//
// weakPattern/howToOvercome 두 문장만 있던 시절엔 "개념별 풀이법 사전"과 다를 게 없었다
// (누구에게나 같은 말이라 굳이 AI일 이유가 없다). 아래 필드들은 **이 사람이 실제로 고른
// 오답**에서 출발해 원인→근거→계획→체크리스트로 이어지는 분량 있는 진단을 담는다.
// 전부 선택 필드다 — 구버전 리포트(두 문장짜리)도 그대로 그려져야 한다.
export type DiagnosisConceptCoaching = {
  concept: string;
  // 정본 개념 id(있으면). 같은 개념 기출 뽑기가 이 축을 쓴다.
  conceptId?: string | null;
  subject?: string | null;
  subjectSlug?: string | null;
  // 이 개념에서 무너지는 지점(2~4문장, 고른 오답에서 드러난 공통점).
  weakPattern: string;
  // 처방 한 줄 요약. 아래 steps 가 그 실행 계획이다.
  howToOvercome: string;
  // 왜 그렇게 골랐는지 — 오개념의 뿌리를 짚는 원인 분석(3~5문장).
  rootCause?: string | null;
  // 내 오답 문항별 근거.
  evidence?: DiagnosisCoachingEvidence[] | null;
  // 오늘부터의 실행 계획.
  steps?: DiagnosisCoachingStep[] | null;
  // 같은 유형을 다시 만났을 때 순서대로 확인할 것들.
  checkpoints?: string[] | null;
  // 이 개념 문항에서 반복되는 함정 한 줄.
  trap?: string | null;
};

// 사용자가 이번 진단에서 고른 개념. 화면의 체크박스가 그대로 이 배열이 된다.
// conceptId 는 정본 개념 id(없는 개념이면 null이고 표기로만 식별한다) —
// conceptSelectionKey 와 짝이다.
export type DiagnosisConceptSelection = {
  conceptId: string | null;
  concept: string;
};

export type AiDiagnosisReport = {
  summary: string;
  weakConcepts: DiagnosisWeakConcept[];
  subjectTrends: DiagnosisSubjectTrend[];
  // 아래 필드들은 리뉴얼된 대시보드용(선택). 구버전 리포트엔 없을 수 있어 화면이
  // 있으면 그리고 없으면 대체/숨김 처리한다.
  mission?: DiagnosisMission | null;
  insights?: DiagnosisInsight[] | null;
  // 개념별 맞춤 극복법(AI, 진단받기 때 생성·캐시).
  conceptCoaching?: DiagnosisConceptCoaching[] | null;
};

// 개념 선택 키. 같은 표기(keyword_title)라도 과목이 다르면 다른 개념이므로, 정본
// 개념 id 가 있으면 그것을 쓰고 없을 때만 표기로 떨어진다 — 집계(rules/diagnosis-aggregate
// 의 개념 키)와 **같은 규칙**이어야 화면에서 고른 개념과 프롬프트가 맞물린다.
export function conceptSelectionKey(c: { conceptId: string | null; concept: string }): string {
  return c.conceptId ?? `kw:${c.concept.trim()}`;
}

// 클라이언트가 보낸 개념 선택을 믿을 수 있는 모양으로 정리한다: 문자열만 남기고,
// 같은 개념 중복을 없애고, 전체 상한(COACH_MAX_TOTAL)까지 자른다.
//
// 화면(체크박스)이 이미 상한에서 막지만 여기서 다시 자르는 이유는 요금이다 — 개념
// 하나가 곧 프롬프트 한 덩이라, 화면을 우회해 200개를 실어 보내는 요청이 그대로
// 청구서가 되면 안 된다. 웹 서버 액션과 Edge `diagnosis-request` 가 같은 함수를 부른다.
export function normalizeConceptSelection(
  input: DiagnosisConceptSelection[] | null | undefined,
): DiagnosisConceptSelection[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: DiagnosisConceptSelection[] = [];
  for (const raw of input) {
    const concept = typeof raw?.concept === "string" ? raw.concept.trim() : "";
    if (!concept) continue;
    const conceptId = typeof raw?.conceptId === "string" && raw.conceptId ? raw.conceptId : null;
    const key = conceptId ?? `kw:${concept}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ conceptId, concept });
    if (out.length >= COACH_MAX_TOTAL) break;
  }
  return out;
}
