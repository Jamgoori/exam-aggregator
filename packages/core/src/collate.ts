// 한국어 정렬 비교자 — 웹·모바일 공유.
//
// 목록 정렬을 `a.localeCompare(b, "ko")` 로 하면 비교 한 번마다 로케일 협상이 붙는다.
// 정렬은 비교를 n log n 번 하므로 그 비용이 정렬 자체보다 커진다
// (실측: 과목 40개 정렬 46.8µs → 17.5µs, 비교 단건 0.27µs → 0.12µs).
//
// 속도보다 중요한 건 기준이 한 곳에 모인다는 점이다. 지금은 같은 종류의 목록을
// 화면마다 다른 인자로 정렬한다 — `localeCompare(b, "ko")` 인 곳과 인자 없이
// `localeCompare(b)` 인 곳이 섞여 있어서, 후자는 런타임 기본 로케일(서버는 보통
// en-US)을 따라 한글 정렬 순서가 화면마다 달라질 수 있다. 비교자를 하나로 두면
// 웹·앱·서버가 언제나 같은 순서를 낸다.
const koCollator = new Intl.Collator("ko");

/** 한글 이름 정렬용 비교자. 배열 정렬에는 `list.sort(compareKo)` 로 그대로 넘길 수 있다. */
export const compareKo: (a: string, b: string) => number = koCollator.compare;

// ISO 8601 타임스탬프 정렬.
//
// created_at 류는 로케일 비교(localeCompare)를 쓸 이유가 없다. 형식이 고정된
// 문자열이라 코드유닛 비교가 같은 순서를 내면서 더 싸다(600개 정렬 27.7µs → 15.9µs).
// Date 로 파싱해 getTime() 을 비교하는 것보다도 싸다 — 비교 횟수만큼 파싱이 반복되지
// 않기 때문이다.
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
