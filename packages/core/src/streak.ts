// 연속 학습일(스트릭): CBT를 푼 날짜를 하루 단위로 모아, 오늘(또는 아직 안 풀었다면
// 어제)부터 거슬러 올라가며 끊기지 않고 이어진 날 수를 센다.
// (등급 streakTier 의 색 표기는 플랫폼마다 달라 — 웹 Tailwind 클래스 / 앱 hex —
//  각 앱에 남긴다. 여기는 순수 계산만.)
export function computeStreakDays(attemptCreatedAts: string[]): number {
  const days = new Set(
    attemptCreatedAts.map((iso) => new Date(iso).toLocaleDateString("ko-KR")),
  );

  const oneDay = 24 * 60 * 60 * 1000;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(cursor.toLocaleDateString("ko-KR"))) {
    cursor = new Date(cursor.getTime() - oneDay);
  }

  let streak = 0;
  while (days.has(cursor.toLocaleDateString("ko-KR"))) {
    streak++;
    cursor = new Date(cursor.getTime() - oneDay);
  }
  return streak;
}
