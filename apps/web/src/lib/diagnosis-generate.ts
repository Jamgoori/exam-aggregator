import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIAGNOSIS_MODEL, parseCoachingItems } from "@/lib/diagnosis-coach";
import {
  planCoaching as planCoachingRule,
  saveDiagnosisReport as saveDiagnosisReportRule,
} from "@gongmoa/core/server";
import type { DiagnosisConceptSelection, DiagnosisConceptCoaching } from "@/lib/ai-diagnosis";
import type { AiDiagnosisReport } from "@/lib/ai-diagnosis";

// AI 약점 진단 생성기의 **웹 어댑터**.
//
// 리포트의 무AI 부분(요약·개념 목록·과목 추세)·코칭 대상 선정·오답 표본 읽기·요청 본문
// 만들기(=`planCoaching`)와 저장(`saveDiagnosisReport`)은 전부 core 로 갔다
// (`packages/core/src/rules/diagnosis-generate.ts`, 설계서 §6.8). 제출 경로가 셋이 된 지금
// (웹 서버 액션·웹 크론·Edge `diagnosis-request`) 준비 단계가 웹에만 있으면 Edge 는 사본을
// 갖게 되고, 사본이 어긋난 것은 요금이 나간 뒤에야 안다.
//
// 여기 남은 것은 **즉시 생성**(Messages API, 개념마다 1콜을 동시에)뿐이다 —
// `ANTHROPIC_DIAGNOSIS_SYNC=1` 일 때만 쓰는 탈출구로, 운영 중 결과를 바로 확인해야 할 때
// 쓴다. 기본 경로는 배치(core `rules/diagnosis-batch.ts`, Message Batches API)다: 주 1회짜리
// 기능이라 몇 분 늦게 와도 되고 **요금이 절반**이다. 동기 호출로 기본 경로를 바꾸지 말 것.

// 코칭 대상 개념 선정(pickCoachTargets)은 core diagnosis-targets.ts 가 정본이다 —
// 웹 생성기(여기)·웹 진단 페이지의 "추천" 체크·Edge `diagnosis-aggregate` 의 선택창이
// 같은 개념을 골라야 하기 때문이다(한 벌 더 쓰면 같은 계정이 웹과 앱에서 다른 추천을
// 받는다). 기존 import 경로는 그대로 살린다.
export { pickCoachTargets } from "@gongmoa/core";
export type { CoachingPlan, CoachingRequest } from "@gongmoa/core/server";

// 두 경로(즉시·배치)가 공유하는 준비 단계. core 규칙에 admin 클라이언트와 모델만 넘긴다.
export async function planCoaching(
  userId: string,
  excludedSubjectSlugs: Set<string> = new Set(),
  selectedConcepts: DiagnosisConceptSelection[] | null = null,
) {
  return planCoachingRule(createAdminClient(), userId, excludedSubjectSlugs, selectedConcepts, {
    model: DIAGNOSIS_MODEL,
  });
}

// 준비된 리포트 뼈대에 코칭을 얹어 ai_diagnoses.report 에 저장한다(이미 채워져 있으면
// 덮지 않는다 — core 규칙의 `report is null` 조건).
export async function saveDiagnosisReport(
  diagnosisId: string,
  skeleton: Omit<AiDiagnosisReport, "conceptCoaching">,
  conceptCoaching: DiagnosisConceptCoaching[],
): Promise<{ error?: string }> {
  return saveDiagnosisReportRule(
    createAdminClient(),
    diagnosisId,
    skeleton,
    conceptCoaching,
    DIAGNOSIS_MODEL,
  );
}

// 즉시 생성(Messages API, 개념마다 1콜을 동시에). ANTHROPIC_DIAGNOSIS_SYNC=1 일 때만
// 호출부가 이 경로를 탄다 — 평소에는 배치가 **절반 요금**으로 만든다. 성공하면 "ready",
// 만들지 못하면(키 미설정·API 실패) report 는 비운 채 "pending"을 돌려준다(배치가 나중에
// 채운다).
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
  // 같은 코드가 감당하므로(core diagnosis-coach.ts 의 max_tokens 주석 참고) stream 을 유지한다.
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
