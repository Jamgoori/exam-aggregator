export function formatFileSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(n: number) {
  return n.toLocaleString("ko-KR");
}

export function isRecent(isoDate: string, withinDays: number) {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  return new Date(isoDate).getTime() > cutoff;
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${seconds}초`;
}
