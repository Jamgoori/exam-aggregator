import { test } from "node:test";
import assert from "node:assert/strict";
import {
  laterOf,
  paperFileName,
  renderSitemapIndex,
  renderUrlset,
  romanizeSlug,
  sitemapFileUrl,
  HUBS_FILE,
  PAPER_LASTMOD_FLOOR,
} from "@/lib/sitemap-data";
import { SITE_URL } from "@/lib/site-url";

// 2026-09-06 실측 사고: 사이트맵 인덱스의 문제지 파일 lastmod 가 전부 하한값(당시
// 2026-09-02T00:00:00+09:00 = 09-01T15:00Z)으로 나갔다. 실제 최신 업로드는 15:54Z 라 더
// 늦은데도, "가장 늦은 값" 계산을 문자열 비교로 해서 `+09:00` 로 적힌 하한이 날짜
// 문자만으로 이겼다. 크롤러는 인덱스의 lastmod 로 하위 파일 재수집 여부를 정하므로,
// 이 값이 실제보다 이르면 새 문제지가 늦게 잡힌다. 규칙을 못 박는다.
//
// 아래 값들은 하한을 09-09 로 올린 뒤에도 같은 함정을 재현하도록 고른 것이다 —
// 업로드가 하한보다 실제로는 늦으면서 문자열로는 작아야 전제가 성립한다.
test("laterOf 는 표기 형식이 달라도 실제로 늦은 쪽을 고른다", () => {
  const upload = "2026-09-08T15:54:52.075486+00:00"; // Postgres 원본
  const floor = PAPER_LASTMOD_FLOOR; // "2026-09-09T00:00:00+09:00" = 09-08T15:00Z

  // 사전순으로는 floor 가 크지만(0-9 > 0-8), 시각은 upload 가 54분 늦다.
  assert.ok(floor > upload, "이 테스트의 전제: 문자열 비교로는 하한이 이긴다");
  assert.equal(laterOf(upload, floor), upload);
  assert.equal(laterOf(floor, upload), upload);
});

test("laterOf 는 한쪽이 없으면 있는 쪽을, 둘 다 없으면 undefined 를 준다", () => {
  assert.equal(laterOf(undefined, "2026-01-01T00:00:00Z"), "2026-01-01T00:00:00Z");
  assert.equal(laterOf("2026-01-01T00:00:00Z", undefined), "2026-01-01T00:00:00Z");
  assert.equal(laterOf(undefined, undefined), undefined);
});

test("문제지 lastmod 는 하한보다 이른 업로드를 하한으로 끌어올린다", () => {
  // 하한을 둔 이유는 문제지 전체가 크롤러에게 제대로 된 <head> 를 주기 시작한 날을
  // 알리는 신호다(sitemap-data.ts 의 PAPER_LASTMOD_FLOOR 주석).
  const old = "2024-03-01T00:00:00+00:00";
  assert.equal(laterOf(old, PAPER_LASTMOD_FLOOR), PAPER_LASTMOD_FLOOR);
});

test("lastmod 는 형식이 섞여 들어와도 ISO(Z)로 통일해 출력한다", () => {
  const xml = renderUrlset([
    { url: "https://gongmoa.kr/a", lastModified: "2026-09-01T15:54:52.075486+00:00" },
    { url: "https://gongmoa.kr/b", lastModified: "2026-09-02T00:00:00+09:00" },
  ]);
  assert.match(xml, /<lastmod>2026-09-01T15:54:52\.075Z<\/lastmod>/);
  assert.match(xml, /<lastmod>2026-09-01T15:00:00\.000Z<\/lastmod>/);
});

test("lastmod 가 없거나 깨진 값이면 태그 자체를 빼고 나머지는 그대로 낸다", () => {
  const xml = renderUrlset([
    { url: "https://gongmoa.kr/membership", changeFrequency: "monthly", priority: 0.6 },
    { url: "https://gongmoa.kr/broken", lastModified: "언제인지-모름" },
  ]);
  assert.equal(xml.includes("<lastmod>"), false);
  assert.match(xml, /<loc>https:\/\/gongmoa\.kr\/membership<\/loc>/);
  assert.match(xml, /<changefreq>monthly<\/changefreq>/);
  assert.match(xml, /<priority>0\.6<\/priority>/);
});

test("XML 특수문자는 이스케이프한다", () => {
  const xml = renderUrlset([{ url: "https://gongmoa.kr/a?x=1&y=2" }]);
  assert.match(xml, /<loc>https:\/\/gongmoa\.kr\/a\?x=1&amp;y=2<\/loc>/);
  assert.equal(xml.includes("x=1&y=2"), false);
});

test("인덱스는 sitemapindex 로, 하위 파일 주소를 담는다", () => {
  const xml = renderSitemapIndex([
    { url: "https://gongmoa.kr/sitemap-hubs.xml", lastModified: "2026-09-01T15:54:52.075Z" },
    { url: "https://gongmoa.kr/sitemap-papers-x.xml" },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?><sitemapindex /);
  assert.match(xml, /<loc>https:\/\/gongmoa\.kr\/sitemap-hubs\.xml<\/loc>/);
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 2);
});

// 2026-09-06 ~ 09-18 사고: 하위 사이트맵을 /sitemaps/ 밑에 두었더니 사이트맵 경로
// 규약("파일이 놓인 경로가 담을 수 있는 주소 범위를 정한다")에 걸려, 담긴 주소가 한
// 건도 인정되지 않았다. 구글은 이 제한을 서치콘솔 직접 제출에만 면제한다 —
// robots.txt 에 적는 것으로는 안 풀린다. 그래서 파일은 루트에 둔다. 이 규칙이 깨지면
// 사이트 유입이 통째로 멈추므로 주소 모양 자체를 못 박는다.
test("사이트맵 파일 주소는 루트에 놓인다 — 디렉터리 밑으로 내려가면 안 된다", () => {
  for (const file of [HUBS_FILE, "sitemap-papers-gukgajik-9geup.xml"]) {
    const url = sitemapFileUrl(file);
    assert.equal(url, `${SITE_URL}/${file}`);
    // 호스트 바로 뒤에 파일 이름이 와야 한다(슬래시가 하나뿐).
    assert.equal(new URL(url).pathname.split("/").length, 2);
  }
});

test("파일 이름은 한글을 ASCII 로 옮긴다 — 퍼센트 인코딩이 남지 않는다", () => {
  assert.equal(paperFileName("국가직-9급"), "sitemap-papers-gukgajik-9geup.xml");
  assert.equal(paperFileName("경찰"), "sitemap-papers-gyeongchal.xml");
  assert.equal(paperFileName("한능검-심화"), "sitemap-papers-hanneunggeom-simhwa.xml");
  for (const slug of ["국가직-9급", "경찰", "지역인재-9급", "계리직"]) {
    const file = paperFileName(slug);
    assert.match(file, /^sitemap-papers-[a-z0-9-]+\.xml$/);
    // 인코딩이 필요 없다는 것이 요점이다 — 주소에 그대로 실린다.
    assert.equal(encodeURIComponent(file), file);
  }
});

// 실제 운영 중인 시험 22개. 로마자 표기는 음운 변화를 반영하지 않으므로 서로 다른
// 시험이 같은 파일 이름으로 떨어질 여지가 이론상 남아 있다. 겹치면 한 파일이 다른
// 파일을 가려 그 시험의 문제지가 통째로 사이트맵에서 사라진다(조용히 사라지는 것이
// 여기서 가장 비싼 사고다). getSitemapData 가 번호를 붙여 가르지만, 애초에 안 겹치는
// 편이 낫다 — 새 시험을 넣었을 때 여기서 먼저 걸리게 둔다.
test("운영 중인 시험 슬러그는 파일 이름이 서로 겹치지 않는다", () => {
  const slugs = [
    "경력경쟁-9급", "국가직-7급", "국가직-9급", "국가직-5급", "지방직-9급",
    "지방직-7급", "경찰", "소방", "해경", "국회직-9급", "국회직-8급",
    "국회직-5급", "법원직-9급", "법원직-5급", "기상직-9급", "기상직-7급",
    "지역인재-9급", "계리직", "군무원-7급", "군무원-9급", "한능검-심화",
  ];
  const files = slugs.map(paperFileName);
  assert.equal(new Set(files).size, slugs.length);
  // 허브 파일과도 겹치면 안 된다.
  assert.equal(files.includes(HUBS_FILE), false);
});

test("표에 없는 글자뿐인 슬러그도 빈 이름이 되지 않는다", () => {
  // "sitemap-papers-.xml" 이 되면 그런 슬러그끼리 서로 구분되지 않는다.
  const a = romanizeSlug("!!!");
  const b = romanizeSlug("???");
  assert.match(a, /^exam-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  // 같은 입력은 언제나 같은 이름 — 주소가 흔들리면 크롤러가 매번 새 파일로 본다.
  assert.equal(romanizeSlug("!!!"), a);
});
