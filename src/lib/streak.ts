// 연속 학습일(스트릭): CBT를 푼 날짜를 하루 단위로 모아, 오늘(또는 아직 안 풀었다면
// 어제)부터 거슬러 올라가며 끊기지 않고 이어진 날 수를 센다.
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

const STREAK_TIERS = [
  { min: 30, label: "다이아", className: "bg-cyan-100 text-cyan-700" },
  { min: 14, label: "골드", className: "bg-amber-100 text-amber-700" },
  { min: 7, label: "실버", className: "bg-zinc-200 text-zinc-700" },
  { min: 3, label: "브론즈", className: "bg-orange-100 text-orange-700" },
  { min: 1, label: "새싹", className: "bg-green-100 text-green-700" },
] as const;

export function streakTier(days: number) {
  return STREAK_TIERS.find((t) => days >= t.min) ?? null;
}
