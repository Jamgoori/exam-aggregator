import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  collectDiagnosisBatches as collectDiagnosisBatchesRule,
  createAnthropicBatchTransport,
  getPendingDiagnosisBatch as getPendingDiagnosisBatchRule,
  submitPendingDiagnoses as submitPendingDiagnosesRule,
  type AnthropicBatchTransport,
  type CollectResult,
  type SubmitResult,
} from "@gongmoa/core/server";
import { DIAGNOSIS_MODEL } from "@/lib/diagnosis-coach";

// 맞춤 극복법 배치(제출·수거)의 **웹 어댑터**.
//
// 규칙 본문은 전부 core 로 갔다(`packages/core/src/rules/diagnosis-batch.ts`). 이유는
// 제출·수거 경로가 셋이 됐기 때문이다: 웹 서버 액션, 웹 크론(안전망), 그리고 Edge
// `diagnosis-request`/`diagnosis-collect`(앱이 요청한 그 자리에서 제출하고, 기다리는 동안
// 직접 수거한다). 배치 요금은 토큰 단위라 요청 1건짜리 배치도 단가가 같아서, 사용자마다
// 따로 내도 손해가 없다.
//
// 여기 남은 것은 (1) admin 클라이언트와 (2) **웹 쪽 키·모델 환경변수**를 규칙에 넘기는
// 일뿐이다. 키는 이 파일 밖으로 나가지 않는다 — 응답·로그·오류 문구에 절대 싣지 말 것.
//
// 웹 화면은 `collectDiagnosisBatches({ userId })` + `getPendingDiagnosisBatch` 두 조각으로
// 수거한다(page.tsx). core 의 `collectDiagnosisForUser`(그 둘을 한 번에 하고 status 를
// 돌려주는 함수)는 **Edge `diagnosis-collect` 전용**이다 — 앱은 수거 결과를 `{status}`
// 하나로 받아야 폴링을 멈출 수 있고, 웹은 같은 값을 서버 렌더에서 이미 들고 있다.
export type { SubmitResult, CollectResult };

// 이 기능 전용 키(즉시 생성과 같은 변수). 레포에 ANTHROPIC_API_KEY 를 읽는 곳이 따로
// 있어서(scripts/extract-answer-keys.mjs — 정답 추출 배치) 같은 이름을 쓰면 그쪽 실API
// 요금까지 이 키로 나간다. 그래서 웹은 별도 변수명으로 읽는다.
//
// ⚠ **Edge secret `ANTHROPIC_API_KEY` 와 같은 워크스페이스의 키여야 한다.** 이름은 다르지만
// 두 경로는 같은 `ai_diagnosis_batches` 를 보고 **서로가 낸 배치까지 수거한다** — 배치는
// 워크스페이스 단위로만 보이므로 워크스페이스가 갈리면 상대의 배치 조회가 404 가 되고,
// 404 는 "영영 없다"로 읽혀 **이미 요금을 낸 배치가 실패로 닫힌다**.
//
// 키가 없으면 transport 가 null 이고, 규칙은 제출·수거를 **하지 않는다**(오류가 아니다).
// 진단은 pending 으로 남아 화면의 데이터층만 보인다.
function transport(): AnthropicBatchTransport | null {
  const apiKey = process.env.ANTHROPIC_DIAGNOSIS_API_KEY;
  return apiKey ? createAnthropicBatchTransport({ apiKey }) : null;
}

function deps() {
  return { transport: transport(), model: DIAGNOSIS_MODEL };
}

// report 가 비어 있는 진단 요청을 모아 배치 1건으로 제출한다.
//
// userId 를 주면 그 사람 것만 낸다("진단 받기" 버튼이 누른 즉시 부르는 경로 — 크론을
// 기다리면 최대 한 시간이 빈다). 주지 않으면 대기 중인 요청 전체를 훑는다(크론).
export async function submitPendingDiagnoses(
  opts: { userId?: string; limit?: number } = {},
): Promise<SubmitResult> {
  return submitPendingDiagnosesRule(createAdminClient(), opts, deps());
}

// 끝난 배치의 결과를 읽어 report 를 채운다. userId 를 주면 그 사람의 진행 중 배치만 본다.
export async function collectDiagnosisBatches(
  opts: { userId?: string } = {},
): Promise<CollectResult> {
  return collectDiagnosisBatchesRule(createAdminClient(), opts, deps());
}

// 이 사용자의 극복법이 지금 배치에서 만들어지는 중인지. 화면이 "생성 중"과 "실패해서
// 다시 눌러야 함"을 구분해 말해 주려면 필요하다. conceptCount 는 로딩 카드가 "고른 8개
// 개념을 분석하는 중"이라고 말해 주기 위한 값 — 몇 개를 기다리는지 모르면 대기가 더 길게
// 느껴진다.
//
// 조회 본문은 core rules/diagnosis-aggregate.ts 에 있다 — `ai_diagnosis_batches` 는 RLS
// 정책이 하나도 없어(service_role 전용) 앱이 직접 못 읽으므로, Edge `diagnosis-aggregate`
// 가 같은 판정을 실어 보내야 앱 선택창도 생성 중에는 닫힌다. 여기는 admin 클라이언트를
// 넘기는 어댑터다.
export async function getPendingDiagnosisBatch(
  userId: string,
): Promise<{ requestedAt: string; conceptCount: number } | null> {
  return getPendingDiagnosisBatchRule(createAdminClient(), userId);
}
