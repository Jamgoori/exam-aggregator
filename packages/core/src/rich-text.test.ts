import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstImageSrc,
  hasRichTextBody,
  richTextToPlain,
  sanitizeRichText,
} from "./rich-text";

const ORIGINS = ["https://cdn.example.com/storage/v1/object/public/board-images/"];

test("허용 태그와 서식은 그대로 남는다", () => {
  const html =
    '<p><strong>굵게</strong> <em>기울임</em> <span style="color: #ff0000; font-size: large">색</span></p>';
  assert.equal(sanitizeRichText(html), html);
});

test("script 는 태그도 내용도 남지 않는다", () => {
  const out = sanitizeRichText('<p>앞</p><script>alert("xss")</script><p>뒤</p>');
  assert.equal(out, "<p>앞</p><p>뒤</p>");
  assert.ok(!out.includes("alert"));
});

test("이벤트 핸들러 속성은 통째로 사라진다", () => {
  const out = sanitizeRichText('<p onclick="steal()" onmouseover="x">글</p>');
  assert.equal(out, "<p>글</p>");
});

test("javascript: 링크는 href 없이 남는다", () => {
  const out = sanitizeRichText('<a href="javascript:alert(1)">눌러</a>');
  assert.equal(out, "<a>눌러</a>");
});

test("엔티티·개행으로 감춘 javascript: 도 막힌다", () => {
  assert.equal(sanitizeRichText('<a href="java&#115;cript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeRichText('<a href="java\nscript:alert(1)">x</a>'), "<a>x</a>");
});

test("외부 링크에는 target·rel 이 강제로 붙는다", () => {
  const out = sanitizeRichText('<a href="https://example.com">링크</a>');
  assert.equal(
    out,
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">링크</a>',
  );
});

test("사이트 안쪽 경로는 새 탭으로 열지 않는다", () => {
  assert.equal(sanitizeRichText('<a href="/papers/1">문제지</a>'), '<a href="/papers/1">문제지</a>');
  // 프로토콜 상대 주소(//evil.com)는 외부라서 내부 경로로 통과시키면 안 된다.
  assert.equal(sanitizeRichText('<a href="//evil.com">x</a>'), "<a>x</a>");
});

test("이미지는 허용한 출처만 남는다", () => {
  const ok = `<img src="${ORIGINS[0]}a.webp" alt="사진">`;
  assert.equal(sanitizeRichText(ok, { imageOrigins: ORIGINS }), ok);
  // 출처 밖 이미지는 태그째로 사라진다(추적 픽셀 방지).
  assert.equal(
    sanitizeRichText('<img src="https://evil.com/pixel.gif">', { imageOrigins: ORIGINS }),
    "",
  );
  // 옵션을 안 주면 이미지를 전부 버린다.
  assert.equal(sanitizeRichText(`<img src="${ORIGINS[0]}a.webp">`), "");
});

test("이미지 주소의 경로 탈출·쿼리는 막힌다", () => {
  const base = ORIGINS[0];
  // ../ 는 접두사 검사를 통과하지만 브라우저가 접어 올려 같은 호스트의 다른 주소가 된다.
  assert.equal(sanitizeRichText(`<img src="${base}../../secret">`, { imageOrigins: ORIGINS }), "");
  assert.equal(sanitizeRichText(`<img src="${base}a/%2e%2e/b.webp">`, { imageOrigins: ORIGINS }), "");
  assert.equal(sanitizeRichText(`<img src="${base}a.webp?x=1">`, { imageOrigins: ORIGINS }), "");
  assert.equal(sanitizeRichText(`<img src="${base}a.webp#f">`, { imageOrigins: ORIGINS }), "");
  assert.equal(sanitizeRichText(`<img src="${base}">`, { imageOrigins: ORIGINS }), "");
  // 정상 경로는 그대로.
  assert.equal(
    sanitizeRichText(`<img src="${base}u1/a.webp">`, { imageOrigins: ORIGINS }),
    `<img src="${base}u1/a.webp">`,
  );
});

test("속성값 안의 따옴표는 속성 경계를 깨지 못한다", () => {
  const out = sanitizeRichText(`<a href='https://x.com/"onclick="alert(1)'>x</a>`);
  // 하나의 href 값으로 남고(엔티티), onclick 속성은 생기지 않는다.
  assert.ok(out.startsWith('<a href="https://x.com/&quot;onclick=&quot;alert(1)"'));
  assert.ok(!/ onclick=/.test(out));
});

test("style 은 허용 속성·값만 남는다", () => {
  const out = sanitizeRichText(
    '<p style="color: red; position: fixed; background-image: url(javascript:1); text-align: center">글</p>',
  );
  assert.equal(out, '<p style="color: red; text-align: center">글</p>');
});

test("글자 크기는 범위 밖이면 버린다", () => {
  assert.equal(sanitizeRichText('<span style="font-size: 20px">글</span>'), '<span style="font-size: 20px">글</span>');
  assert.equal(sanitizeRichText('<span style="font-size: 400px">글</span>'), "<span>글</span>");
});

test("font 태그는 span 스타일로 옮겨진다", () => {
  assert.equal(
    sanitizeRichText('<font size="5" color="#123456">글</font>'),
    '<span style="color: #123456; font-size: x-large">글</span>',
  );
});

test("닫히지 않은 태그는 끝에서 닫히고, 짝 없는 닫는 태그는 무시된다", () => {
  assert.equal(sanitizeRichText("<p><strong>글"), "<p><strong>글</strong></p>");
  assert.equal(sanitizeRichText("글</div></p>"), "글");
});

test("허용 목록 밖 태그는 내용만 살린다", () => {
  assert.equal(sanitizeRichText("<table><tr><td>칸</td></tr></table>"), "칸");
});

test("본문 텍스트의 꺾쇠는 이스케이프되고 엔티티는 이중 인코딩되지 않는다", () => {
  assert.equal(sanitizeRichText("<p>a < b &amp; c</p>"), "<p>a &lt; b &amp; c</p>");
});

test("richTextToPlain 은 서식을 걷어낸다", () => {
  assert.equal(richTextToPlain("<p>첫줄</p><p>둘째줄</p>"), "첫줄\n둘째줄");
  assert.equal(richTextToPlain("<p>a&nbsp;b</p>"), "a b");
});

test("firstImageSrc·hasRichTextBody", () => {
  assert.equal(firstImageSrc('<p>글</p><img src="https://a/b.webp">'), "https://a/b.webp");
  assert.equal(firstImageSrc("<p>글</p>"), null);
  assert.equal(hasRichTextBody("<p><br></p>"), false);
  assert.equal(hasRichTextBody('<p></p><img src="https://a/b.webp">'), true);
  assert.equal(hasRichTextBody("<p>글</p>"), true);
});
