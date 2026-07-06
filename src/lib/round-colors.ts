// 회독을 거듭할수록 색이 바뀌어서 "레벨업"하는 느낌을 주기 위한 구간별 배지 색상.
export function roundBadgeColor(round: number): string {
  if (round >= 10) return "bg-amber-100 text-amber-700";
  if (round >= 6) return "bg-purple-100 text-purple-700";
  if (round >= 4) return "bg-emerald-100 text-emerald-700";
  if (round >= 2) return "bg-blue-100 text-blue-700";
  return "bg-zinc-100 text-zinc-600";
}
