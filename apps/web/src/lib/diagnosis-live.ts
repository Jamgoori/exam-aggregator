import "server-only";
import { cacheLife } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDiagnosisAggregate as getDiagnosisAggregateRule,
  type DiagnosisAggregate,
} from "@gongmoa/core/server";

// AI 약점 진단의 "결정적(무AI) 데이터층" — **웹 어댑터**(캐시 계층).
//
// 집계 본체(과목별 개념 오답 분포)는 packages/core/src/rules/diagnosis-aggregate.ts 로
// 옮겼다(설계서 §6.7 #21·§6.8) — 웹 진단 페이지와 Edge `diagnosis-aggregate` 가 같은 함수를
// 부른다. 집계가 두 벌이면 같은 계정의 막대그래프가 웹과 앱에서 다른 높이로 그려진다.
// 이 파일에 남은 것은 웹에만 있는 캐시 계층(`'use cache'`)뿐이다 — 규칙에 캐시를 넣지
// 않는다(§6.2: 런타임마다 캐시가 달라 규칙이 그걸 알면 안 된다). Edge 에는 이 계층이 없다.
// 오답 문항 표본(`getWrongQuestionSamples`)도 core 로 갔다 — 파일 끝 주석 참고.
//
// 집계는 service_role 만 읽는 테이블을 훑으므로 admin 클라이언트로 돈다. 호출부는 반드시
// 본인(userId) 확인을 끝낸 뒤에만 부를 것.

export type {
  ConceptStat,
  SubjectStat,
  SubjectConceptGroup,
  DiagnosisWindow,
  DiagnosisAggregate,
} from "@gongmoa/core/server";

export async function getDiagnosisAggregate(
  userId: string,
  opts: { days?: number | null; widen?: boolean; subjectSlug?: string | null } = {},
): Promise<DiagnosisAggregate> {
  // 캐시 키가 눈에 보이도록 옵션을 여기서 원시값으로 펴서 넘긴다. 기본값이 호출부마다
  // 다르게 생략되면(`{days:7}` vs `{days:7, widen:undefined}`) 같은 질문이 다른 키가 돼
  // 캐시가 놀게 된다.
  return aggregateCached(
    userId,
    opts.days === undefined ? 7 : opts.days,
    // widen=false 면 창을 절대 넓히지 않는다. AI 분석 경로가 이걸 쓴다 — 창이 곧
    // 프롬프트 크기이자 요금이라, 빈 주에 조용히 90일치를 긁어 오면 안 된다.
    opts.widen !== false,
    opts.subjectSlug ?? null,
  );
}

// 집계 + 캐시. 진단 화면에서 가장 느린 구간이 여기다(계정 전체 응시 이력 → 기간
// 안의 응답 → 문항·해설·개념 → 개념별 기출 수). 페이지를 다시 열거나 기간 칩을 오갈
// 때마다 같은 계산을 처음부터 다시 하고 있었다.
//
// **userId 가 첫 번째 인자인 것이 이 캐시의 안전장치다** — 캐시 키는 인자에서 나오므로,
// 사용자 구분이 인자에 없으면 남의 오답 집계가 다른 사람에게 나간다. 인자를 줄이거나
// 사용자 정보를 함수 밖(전역·요청 컨텍스트)에서 읽도록 바꾸지 말 것.
//
// 30초로 짧게 잡는다. 문제를 풀고 바로 진단으로 넘어오는 흐름이 흔해서, 방금 푼 것이
// 한참 안 보이면 고장으로 읽힌다.
async function aggregateCached(
  userId: string,
  requested: number | null,
  widenAllowed: boolean,
  subjectFilter: string | null,
): Promise<DiagnosisAggregate> {
  "use cache";
  cacheLife({ revalidate: 30, expire: 300 });

  return getDiagnosisAggregateRule(createAdminClient(), userId, {
    days: requested,
    widen: widenAllowed,
    subjectSlug: subjectFilter,
  });
}

// ── 오답 문항 표본은 core 로 옮겼다 ─────────────────────────────────────────
//
// `getWrongQuestionSamples`(모델 프롬프트에 넣을 오답 문항 표본)는
// `packages/core/src/rules/diagnosis-samples.ts` 로 갔다(설계서 §6.8). 웹에만 있으면 Edge
// `diagnosis-request` 가 프롬프트 입력을 만들지 못해 배치를 제출할 수 없고, 사본을 만들면
// 표본 수·자르는 길이가 갈라져 같은 사용자가 경로에 따라 다른 요금·다른 품질의 진단을
// 받는다. 부르는 쪽도 core 로 함께 갔다(`rules/diagnosis-generate.ts#planCoaching`) —
// 그 결과(발문·정답·선지 해설)는 응답으로 나가지 않고 요청 본문을 만드는 데만 쓰인다.
