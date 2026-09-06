import {
  HUBS_FILE,
  getSitemapData,
  paperFileName,
  renderSitemapIndex,
  sitemapFileUrl,
  SITEMAP_HEADERS,
} from "@/lib/sitemap-data";

// /sitemap.xml 은 이제 인덱스다 — 허브 한 장 + 시험별 문제지 파일 목록.
// robots.txt 와 서치콘솔·서치어드바이저에는 이 주소 하나만 제출하면 되고, 하위 파일은
// 인덱스를 따라 알아서 읽는다. 예전 단일 사이트맵(app/sitemap.ts)은 이 파일과
// app/sitemaps/[file]/route.ts 로 나뉘었다(이유는 lib/sitemap-data.ts 머리 주석).
export async function GET() {
  const data = await getSitemapData();
  const files = [
    { url: sitemapFileUrl(HUBS_FILE), lastModified: data.newest },
    ...data.paperFiles.map((f) => ({
      url: sitemapFileUrl(paperFileName(f.slug)),
      // 파일 안에서 가장 늦은 lastmod. 인덱스만 보고도 어느 시험에 새 문제지가
      // 올라왔는지 알 수 있게.
      lastModified: f.entries.reduce<string | undefined>(
        (max, e) => (e.lastModified && (!max || e.lastModified > max) ? e.lastModified : max),
        undefined,
      ),
    })),
  ];
  return new Response(renderSitemapIndex(files), { headers: SITEMAP_HEADERS });
}
