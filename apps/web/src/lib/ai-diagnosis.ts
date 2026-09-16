import "server-only";
import { DIAGNOSIS_LOCKED_HINT, fetchDiagnosisEligibility } from "@gongmoa/core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// AI 약점 진단(주 1회)의 자격 판정·이번 주기 진단 조회 — **웹 어댑터**.
//
// 규칙 본문은 전부 packages/core 로 옮겼다(설계서 §6.7 #21, §6.8):
//   · 요청 행 생성·주기 조회 → `rules/diagnosis-request.ts`(Edge `diagnosis-request` 와 공유)
//   · 리포트 스키마·개념 선택 정규화 → `diagnosis-report.ts`(앱이 report 를 그릴 때 쓴다)
//   · 주기 상수·경계 계산·자격 문턱 → `data/home.ts`·`diagnosis-progress.ts`
// 여기 남은 것은 세션 클라이언트를 넘기는 일과, 기존 import 경로를 지키는 re-export 뿐이다.
//
// 실제 리포트 "생성"은 이 파일도 Edge 도 하지 않는다 — 사용자가 요청하면 report 가 null 인
// 행만 만들고, Vercel 크론 `/api/cron/diagnosis`(시간당, Message Batches)가 나중에 채운다.

// 콜드 스타트 문턱(누적 오답 15개 또는 응시 3회)·주기(7일)·분석 창(7일)·주기 경계 계산은
// core 가 정본이다. 배치 scripts/next-diagnosis.mjs 는 plain node 라 같은 값을 복제해 두었다 —
// 바꿀 때 함께 고칠 것.
export {
  DIAGNOSIS_MIN_WRONG,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_WINDOW_DAYS,
  currentCycleStartDate,
  kstToday,
  nextDiagnosisDate,
} from "@gongmoa/core";

// 리포트 스키마. 생성기(lib/diagnosis-generate.ts)는 이 모양으로 저장하고, 화면은 있는
// 필드만 그린다. 정본은 core — 앱도 `ai_diagnoses.report` 를 RLS 로 읽어 같은 타입으로 그린다.
export type {
  AiDiagnosisReport,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisMission,
  DiagnosisInsight,
  DiagnosisCoachingEvidence,
  DiagnosisCoachingStep,
  DiagnosisConceptCoaching,
  DiagnosisConceptSelection,
} from "@gongmoa/core";

// 클라이언트가 보낸 개념 선택 정리(중복 제거 + 상한). 웹 서버 액션과 Edge 가 같은 함수를 쓴다.
export { normalizeConceptSelection } from "@gongmoa/core";

// 이번 주기 진단 조회·요청 행 생성. `requestDiagnosisForUser` 는 프리미엄 판정 결과를
// 인자로 받으므로 서버 액션(app/mypage/actions.ts)이 직접 부른다 — 여기서 한 겹 더 감싸면
// 게이트가 어느 파일에 있는지가 흐려진다.
export {
  getWeeklyDiagnosis,
  getLatestReadyDiagnosis,
  type WeeklyDiagnosis,
} from "@gongmoa/core/server";

export type DiagnosisEligibility = {
  eligible: boolean;
  wrongCount: number;
  attemptCount: number;
  // 자격 미달일 때 "무엇을 더 하면 되는지" 한 줄.
  hint: string | null;
};

// 자격 판정(응시 수 + 한 번이라도 틀린 문항 수). 판정·문구는 core 한 곳이고, 여기서는
// 화면이 쓰는 hint 를 붙여 준다 — "오답을 더 쌓으라"는 표현은 수험생에게 부담을 주므로
// 노력(더 풀기) 기준으로 안내한다(core DIAGNOSIS_LOCKED_HINT).
export async function getDiagnosisEligibility(
  supabase: Supabase,
  userId: string,
): Promise<DiagnosisEligibility> {
  const counts = await fetchDiagnosisEligibility(supabase, userId);
  return { ...counts, hint: counts.eligible ? null : DIAGNOSIS_LOCKED_HINT };
}
