import {
  HUBS_FILE,
  getSitemapData,
  renderUrlset,
  SITEMAP_HEADERS,
} from "@/lib/sitemap-data";

// 하위 사이트맵의 실제 처리기. **공개 주소는 루트**다 —
//   /sitemap-hubs.xml                    홈·목록·과목·시험 허브
//   /sitemap-papers-<시험>.xml            그 시험의 문제지 전체
// 목록은 /sitemap.xml(인덱스)이 만든다.
//
// 라우트 파일이 여기(/sitemaps/[file]) 있는 것은 Next 의 제약 때문이다. App Router 의
// 경로 조각은 통째로 정적이거나 통째로 동적이어야 해서 `sitemap-[file].xml` 같은 폴더를
// 만들 수 없다. 그래서 next.config.ts 의 rewrite 가 루트 주소를 이 라우트로 넘긴다
// (rewrite 는 내부 전달이라 크롤러가 보는 주소는 루트 그대로다).
//
// **파일을 /sitemaps/ 밑의 주소로 내보내지 말 것.** 사이트맵은 자기가 놓인 경로 아래의
// 주소만 담을 수 있는데 여기 담기는 것은 / · /papers/ · /subjects/ · /exams/ 뿐이다
// (2026-09-06 ~ 09-18 사이 실제로 그렇게 나갔고 색인 발견이 끊겼다 —
// lib/sitemap-data.ts 의 HUBS_FILE 주석).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file: raw } = await params;
  // 주소 조각은 진입점에 따라 퍼센트 인코딩된 채로 오기도 한다(paper-slug-map.ts 의
  // normalizePaperSlugParam 과 같은 사정). 이름은 이제 ASCII 지만, 인코딩된 채로 온
  // 요청도 같은 파일로 받아 준다.
  let file = raw;
  try {
    file = decodeURIComponent(raw);
  } catch {
    // 깨진 인코딩이면 아래 조회에서 404 로 떨어진다.
  }

  const data = await getSitemapData();

  if (file === HUBS_FILE) {
    return new Response(renderUrlset(data.hubs), { headers: SITEMAP_HEADERS });
  }

  // 이름에서 슬러그를 되짚지 않고 **만들어 둔 이름과 맞춰 본다**. 로마자 표기는
  // 되돌릴 수 없고(음운 변화를 반영하지 않는다), 겹친 이름에 붙는 번호까지 고려하면
  // 정답을 아는 쪽은 목록을 만든 getSitemapData 뿐이다.
  const paperFile = data.paperFiles.find((f) => f.file === file);
  if (!paperFile) return new Response("Not Found", { status: 404 });

  return new Response(renderUrlset(paperFile.entries), { headers: SITEMAP_HEADERS });
}
