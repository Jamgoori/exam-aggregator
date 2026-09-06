import {
  HUBS_FILE,
  getSitemapData,
  renderUrlset,
  slugFromPaperFileName,
  SITEMAP_HEADERS,
} from "@/lib/sitemap-data";

// /sitemaps/hubs.xml — 홈·목록·과목·시험 허브.
// /sitemaps/papers-<시험 슬러그>.xml — 그 시험의 문제지 전체.
// 목록은 /sitemap.xml(인덱스)이 만든다.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file: raw } = await params;
  // 주소 조각은 진입점에 따라 퍼센트 인코딩된 채로 오기도 한다(paper-slug-map.ts 의
  // normalizePaperSlugParam 과 같은 사정). 파일 이름에 한글 슬러그가 들어가므로 먼저 되돌린다.
  let file = raw;
  try {
    file = decodeURIComponent(raw);
  } catch {
    // 깨진 인코딩이면 아래 형식 검사에서 404 로 떨어진다.
  }

  const data = await getSitemapData();

  if (file === HUBS_FILE) {
    return new Response(renderUrlset(data.hubs), { headers: SITEMAP_HEADERS });
  }

  const slug = slugFromPaperFileName(file);
  const paperFile = slug ? data.paperFiles.find((f) => f.slug === slug) : undefined;
  if (!paperFile) return new Response("Not Found", { status: 404 });

  return new Response(renderUrlset(paperFile.entries), { headers: SITEMAP_HEADERS });
}
