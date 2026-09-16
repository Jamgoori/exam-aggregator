import type { ReviewSessionDetail } from "../../queries/review";

// 채점 결과 화면의 "다음 복습 예약" 섹션(웹 review-schedule-section.tsx + ForecastStrip).
//
// ⚠ Phase 3 자리(설계서 §12 Phase 3 · §6.7 #12). 지금은 **아무것도 그리지 않는다.**
//
// 이 섹션이 필요로 하는 값(문항별 dueInDays·예보)은 웹에서 서버 액션 getReviewSchedule →
// lib/review-queue.ts#getSessionSchedule 이 만든다. 앱 쪽 통로인 EF `review-due`
// (`{action:"schedule", sessionId}`)는 아직 없다 — 없는 EF 를 부르면 계약 타입(EdgeContracts)에
// 이름이 없어 typecheck 부터 막힌다. SRS 는 앱이 계산하지 않으므로(AGENTS.md 금지선: `srs_*` 는
// 앱이 계산·기록하지 않는다) 클라이언트에서 임시로 만들 수도 없다.
//
// Phase 3 에서 할 일(그때 이 파일만 채우면 결과 화면은 그대로 붙는다):
//   1. EF `review-due` 를 만들고 edge/contracts.ts 에 `{action:"schedule"}` 요청·응답 추가
//   2. queries/review.ts 에 useReviewSchedule(sessionId) — premium=false 면 섹션 없음(무료는
//      스케줄 자체가 없다), 실패해도 결과 화면은 멀쩡해야 하므로 오류를 그리지 않는다
//   3. 여기서 blue 카드(`rounded-2xl border-blue-200 bg-blue-50/70`) + `CalendarClock 16`
//      "다음 복습 예약" + 안내 한 줄 + ForecastStrip + 문항별 `오늘 다시`/`내일`/`N일 뒤` 목록
export function ReviewScheduleSection(_props: { view: ReviewSessionDetail }) {
  // TODO(Phase 3): EF review-due {action:"schedule"} 연결 후 웹 1:1 로 채운다.
  return null;
}
