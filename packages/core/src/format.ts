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

// ── 시각 표시(한국 시간) ─────────────────────────────────────────────────────
// 서버(Vercel)는 UTC 로 돈다. 서버 컴포넌트에서 시각을 timeZone 없이 포맷하면
// 화면에 9시간 어긋난 시각이 그려진다("방금 쓴 글이 어제 저녁"으로 보인다).
// 이 사이트가 다루는 시각은 전부 한국 기준이므로 언제나 KST 를 명시한다.
//
// 화면 문자열을 만드는 쪽은 각자 toLocaleString 의 options 에 timeZone 을 넣고,
// "같은 날인가" 같은 판단은 아래 kstDayKey 로 비교한다(문자열 비교라 안전하다).
export const KST_TIME_ZONE = "Asia/Seoul";

// 한국 시간 기준 달력 날짜 키("2026-09-05"). 날짜가 같은지 비교할 때 쓴다 —
// Date 의 getFullYear/getMonth/getDate 는 실행 환경의 시간대를 따르므로 서버에서
// 부르면 UTC 기준이 되어 자정 근처에서 하루가 어긋난다.
export function kstDayKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  // en-CA 로케일이 YYYY-MM-DD 를 준다(정렬·비교가 그대로 되는 유일한 표준 표기).
  return d.toLocaleDateString("en-CA", { timeZone: KST_TIME_ZONE });
}

// id 목록을 size 개씩 자른다. "id 목록을 청크로 잘라 여러 번 왕복"하는 조회가 웹·Edge
// 양쪽에 수십 곳이라(각자 같은 함수를 한 벌씩 들고 있었다) 여기 하나로 모은다.
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
