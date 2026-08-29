// 연속 학습일(스트릭): CBT를 푼 날짜를 하루 단위로 모아, 오늘(또는 아직 안 풀었다면
// 어제)부터 거슬러 올라가며 끊기지 않고 이어진 날 수를 센다.
// (등급 streakTier 의 색 표기는 플랫폼마다 달라 — 웹 Tailwind 클래스 / 앱 hex —
//  각 앱에 남긴다. 여기는 순수 계산만.)
//
// 하루의 경계는 KST 00:00 이다(attendance.ts 의 kstDayIndex — 출석·AI 진단 일 1회·
// 무료 해설 일일 한도와 같은 경계).
//
// 예전에는 날짜 키를 `new Date(iso).toLocaleDateString("ko-KR")` 로 만들었는데, 그건
// 실행 환경의 시간대를 따른다. 웹 마이페이지는 서버 컴포넌트라 Vercel(UTC)에서 돌고
// 앱은 기기(KST)에서 도므로, 같은 응시 기록에 대해 두 화면이 서로 다른 스트릭을 냈다
// — KST 00:00~09:00 에 푼 응시가 서버에서는 전날로 잡히기 때문이다. 이 파일만 KST 를
// 안 붙이고 있었다(다른 하루 경계는 전부 timeZone: "Asia/Seoul" 을 넘긴다).
//
// 키를 정수로 바꾼 건 그 김에 따라온 것이다. 문자열 키는 만들 때마다 Intl 포맷이
// 도는데, 마이페이지는 응시 전량을 넘긴다(조회에 limit 이 없다).
// 실측: 응시 1,000행 2.07ms → 0.28ms.
import { kstDayIndex } from "./attendance";

export function computeStreakDays(attemptCreatedAts: string[]): number {
  const days = new Set<number>();
  for (const iso of attemptCreatedAts) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) days.add(kstDayIndex(new Date(t)));
  }
  if (days.size === 0) return 0;

  // 오늘 아직 안 풀었으면 어제부터 센다 — 오늘치를 아직 안 했다고 어제까지의 연속이
  // 끊긴 것으로 보이면 안 된다.
  let cursor = kstDayIndex(new Date());
  if (!days.has(cursor)) cursor -= 1;

  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor -= 1;
  }
  return streak;
}
