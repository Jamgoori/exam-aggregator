// 과목 배지 색을 slug 로 안정적으로 고르기 위한 해시 — 웹·모바일 공유.
//
// 팔레트 자체(Tailwind 클래스 / hex)는 플랫폼마다 다르므로 각 앱에 두고, 여기서는
// "몇 번째 색을 쓸지"만 정한다. 같은 과목이 웹과 앱에서 같은 자리의 색을 갖게 된다.

// 각 앱 팔레트는 정확히 이 길이여야 한다.
export const SUBJECT_PALETTE_SIZE = 8;

export function subjectColorIndex(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) % SUBJECT_PALETTE_SIZE;
  }
  return hash;
}
