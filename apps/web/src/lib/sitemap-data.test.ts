import { test } from "node:test";
import assert from "node:assert/strict";
import {
  laterOf,
  paperFileName,
  renderSitemapIndex,
  renderUrlset,
  slugFromPaperFileName,
  PAPER_LASTMOD_FLOOR,
} from "@/lib/sitemap-data";

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
    { url: "https://gongmoa.kr/sitemaps/hubs.xml", lastModified: "2026-09-01T15:54:52.075Z" },
    { url: "https://gongmoa.kr/sitemaps/papers-x.xml" },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?><sitemapindex /);
  assert.match(xml, /<loc>https:\/\/gongmoa\.kr\/sitemaps\/hubs\.xml<\/loc>/);
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 2);
});

test("파일 이름 ↔ 시험 슬러그가 왕복한다 (한글 슬러그 포함)", () => {
  for (const slug of ["국가직-9급", "경찰", "법원직-9급"]) {
    assert.equal(slugFromPaperFileName(paperFileName(slug)), slug);
  }
  // 형식이 아니면 null — /sitemaps/[file] 이 404 로 떨어뜨리는 근거다.
  assert.equal(slugFromPaperFileName("hubs.xml"), null);
  assert.equal(slugFromPaperFileName("papers-국가직-9급"), null);
});
