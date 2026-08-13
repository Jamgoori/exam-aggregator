import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getPaperSlug, isPaperUuid, normalizePaperSlugParam } from "@gongmoa/core";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllPages } from "@/lib/fetch-paged";

// slug 는 제목에서 계산되는 값이라(packages/core/src/paper-slug.ts) 거꾸로 되돌릴 수
// 없다 — "2021-국회직-8급-국어"에서 원래 제목의 공백 위치를 알아낼 방법이 없기
// 때문이다. 그래서 전 문제지의 slug→id 표를 한 번 만들어 캐시해두고 찾는다.
//
// 표에 담는 건 id/title/round 뿐이라 3,800행이어도 작다. 새 업로드가 곧바로
// 반영되도록 홈 데이터와 같은 태그를 달아 revalidateTag("home-data")에 묻어간다.
async function getSlugMap(): Promise<Record<string, string>> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const rows = await fetchAllPages<{ id: string; title: string; round: number; track: string | null }>(
    (from, to) =>
      supabase
        .from("exam_papers")
        .select("id, title, round, track")
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: { id: string; title: string; round: number; track: string | null }[] | null;
        error: { message: string } | null;
      }>,
    "문제지 주소 표",
  );

  // Map 이 아니라 평범한 객체로 돌려준다 — 'use cache' 는 반환값을 직렬화해서
  // 보관하는데 Map 은 그 과정을 그냥 통과하지 못한다.
  const map: Record<string, string> = {};
  for (const row of rows) map[getPaperSlug(row.title, row.round, row.track)] = row.id;
  return map;
}

/**
 * 주소 조각(slug 또는 옛 UUID)을 문제지 id 로 바꾼다. 없으면 null.
 *
 * UUID 로 들어오면 표를 뒤질 필요 없이 그대로 쓴다 — 옛 주소로 들어온 요청이라
 * 어차피 호출한 쪽에서 새 주소로 301 을 보낼 것이다.
 */
export async function resolvePaperId(param: string): Promise<string | null> {
  // 주소 조각은 진입점에 따라 퍼센트 인코딩된 채로 오기도 한다
  // (normalizePaperSlugParam 주석에 실측 사례). 표의 열쇠는 한글이므로 먼저 되돌린다.
  const slug = normalizePaperSlugParam(param);
  if (isPaperUuid(slug)) return slug;
  const map = await getSlugMap();
  return map[slug] ?? null;
}
