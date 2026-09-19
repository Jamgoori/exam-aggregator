import {
  HUBS_FILE,
  getSitemapData,
  laterOf,
  renderSitemapIndex,
  sitemapFileUrl,
  SITEMAP_HEADERS,
} from "@/lib/sitemap-data";

// /sitemap.xml 은 인덱스다 — 허브 한 장 + 시험별 문제지 파일 목록.
// 서치콘솔·서치어드바이저에는 이 주소 하나를 제출하면 되고, 하위 파일은 인덱스를 따라
// 알아서 읽는다.
//
// 하위 파일은 **루트**에 놓인다(/sitemap-hubs.xml, /sitemap-papers-*.xml). 한때
// /sitemaps/ 밑에 두었다가 사이트맵 경로 규약에 걸려 담긴 주소가 한 건도 인정되지
// 않았다 — 이유는 lib/sitemap-data.ts 의 HUBS_FILE 주석에 적어 두었다.
export async function GET() {
  const data = await getSitemapData();
  const files = [
    { url: sitemapFileUrl(HUBS_FILE), lastModified: data.newest },
    ...data.paperFiles.map((f) => ({
      url: sitemapFileUrl(f.file),
      // 파일 안에서 가장 늦은 lastmod. 인덱스만 보고도 어느 시험에 새 문제지가
      // 올라왔는지 알 수 있게. 비교는 반드시 laterOf(시각 비교)로 — 문자열 비교를 쓰면
      // 형식이 섞인 값에서 더 이른 시각이 이긴다(laterOf 주석의 실측 사례).
      lastModified: f.entries.reduce<string | undefined>(
        (max, e) => laterOf(max, e.lastModified),
        undefined,
      ),
    })),
  ];
  return new Response(renderSitemapIndex(files), { headers: SITEMAP_HEADERS });
}
