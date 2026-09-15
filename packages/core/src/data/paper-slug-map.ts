import { getPaperSlug, isPaperUuid, normalizePaperSlugParam } from "../paper-slug";

// slug → 문제지 id 역색인 — 웹 lib/paper-slug-map.ts resolvePaperId 와 같은 규칙(설계서 §5).
//
// slug 는 제목에서 계산되는 값이라(paper-slug.ts) 거꾸로 되돌릴 수 없다. 그래서 전 문제지의
// (id, title, round, track) 로 표를 한 번 만들어 두고 찾는다. 웹은 'use cache' 로 서버에서,
// 앱은 카탈로그 쿼리(data/papers.ts fetchCatalog 의 slugMap)로 퍼시스트해 둔다.
//
// 표는 **중복 통합 전** 전체 행으로 만든다 — 비대표 문제지의 주소도 열려야 한다(웹과 동일).

export type PaperSlugSource = { id: string; title: string; round: number; track: string | null };

export function buildPaperSlugMap(rows: PaperSlugSource[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) map[getPaperSlug(row.title, row.round, row.track)] = row.id;
  return map;
}

/**
 * 주소 조각(slug 또는 옛 UUID)을 문제지 id 로 바꾼다. 없으면 null.
 *
 * UUID 로 들어오면 표를 뒤질 필요 없이 그대로 쓴다. 주소 조각은 진입점에 따라 퍼센트
 * 인코딩된 채로 오기도 하므로(normalizePaperSlugParam) 먼저 되돌린다.
 */
export function resolvePaperId(param: string, slugMap: Record<string, string>): string | null {
  const slug = normalizePaperSlugParam(param);
  if (isPaperUuid(slug)) return slug;
  return slugMap[slug] ?? null;
}
