import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAttendanceSummary, type AttendanceSummary } from "@gongmoa/core";
import { recordAttendance as recordAttendanceRule } from "@gongmoa/core/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 출석 보상의 웹 서버측 경로. 규칙(단계·최소 문항 수·날짜 키)의 정본은
// packages/core/attendance.ts 이고, DB 를 두드리는 본문은 packages/core/src/rules/
// attendance-record.ts 에 있다 — Edge Function(cbt-submit·review-submit)도 번들
// (_shared/core.mjs)로 같은 함수를 부르므로 웹에서 푼 날과 앱에서 푼 날의 출석 기준이
// 갈릴 수 없다. 여기는 service_role 클라이언트를 만들어 넘기는 일만 한다.
//
// 쓰기는 전부 service_role 로 한다. attendance_days·attendance_grants 는 select-own 만
// 열려 있고 쓰기 정책이 없다 — 클라이언트가 직접 올릴 수 있으면 문제를 안 풀고도
// 출석이 되고, 그대로 멤버십 기간으로 환전된다.

// 채점 결과를 그날 출석 누계에 반영하고, 새로 열린 단계가 있으면 멤버십 기간을 준다.
//
// 채점의 부가 처리다 — 실패해도 채점을 되돌리지 않는다(호출부가 try/catch 로 삼킨다).
// 출석이 하루 밀리는 것보다 채점 결과가 사라지는 쪽이 비교할 수 없이 나쁘다.
export async function recordAttendance(
  userId: string,
  questionCount: number,
): Promise<void> {
  // 닫혀 있거나(전면 무료 이벤트) 셀 문항이 없으면 규칙 쪽이 바로 돌아온다 — 그 검사
  // 전에 admin 클라이언트를 만드는 비용은 무시할 만하다.
  await recordAttendanceRule(createAdminClient(), userId, questionCount);
}

// 마이페이지 출석 카드가 쓰는 조회. 조회 본문은 core data/attendance.ts#fetchAttendanceSummary
// 로 옮겼다(앱 출석 탭과 같은 조회 — 설계서 §6.2 출석 행 "웹·앱 중복 통합"). 본인 행만 읽으므로
// 사용자 세션 클라이언트로 충분하다(select-own 정책). 이 이름은 기존 import 경로용.
export type { AttendanceSummary };

export async function getAttendanceSummary(
  supabase: Supabase,
  userId: string,
): Promise<AttendanceSummary> {
  return fetchAttendanceSummary(supabase, userId);
}
