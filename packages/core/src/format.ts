export function formatFileSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(n: number) {
  return n.toLocaleString("ko-KR");
}

export function formatDuration(totalSeconds: number) {
  // 방어적으로 음수/소수를 보정한다(모바일 구현과 통합). 웹 호출부는 모두
  // 비음수 정수(duration_seconds, elapsedSeconds)라 기존 출력과 완전히 동일하다.
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}분 ${seconds}초`;
}
