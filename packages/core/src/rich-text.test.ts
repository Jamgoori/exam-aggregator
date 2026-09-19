import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstImageSrc,
  hasRichTextBody,
  parseRichText,
  RICH_TEXT_TAGS,
  richTextNodesToText,
  richTextToPlain,
  sanitizeRichText,
  type RichNode,
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

// ───────────────────────── parseRichText(앱 렌더러용 파서) ─────────────────────────

function el(nodes: RichNode[], i = 0) {
  const n = nodes[i];
  assert.ok(n && n.type === "element", `nodes[${i}] 가 요소가 아니다: ${JSON.stringify(n)}`);
  return n;
}

test("RICH_TEXT_TAGS 는 새니타이저 허용 목록 22종이다", () => {
  assert.deepEqual(
    [...RICH_TEXT_TAGS],
    ["p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "strike", "h2", "h3", "blockquote", "ul", "ol", "li", "pre", "code", "hr", "a", "img"],
  );
});

test("22태그 각각이 자기 이름의 요소 노드가 된다", () => {
  for (const tag of RICH_TEXT_TAGS) {
    const isVoid = tag === "br" || tag === "hr" || tag === "img";
    const html = isVoid ? `<${tag}>` : `<${tag}>글</${tag}>`;
    const nodes = parseRichText(html);
    assert.equal(nodes.length, 1, tag);
    const node = el(nodes);
    assert.equal(node.tag, tag);
    if (isVoid) assert.deepEqual(node.children, []);
    else assert.deepEqual(node.children, [{ type: "text", text: "글" }]);
  }
});

// 위 케이스는 원문을 바로 파스한다. 실제 입력은 언제나 새니타이저 **출력**이므로, 22태그 각각을
// 새니타이저에 먼저 통과시킨 뒤 파스해도 태그·속성·글자가 그대로인지 한 번 더 본다(img 는 허용
// 접두사 src 가 있어야 살아남고, a 는 target/rel 이 붙어 나온다).
test("22태그 — 새니타이저 출력을 파스하면 태그·속성·글자가 보존된다", () => {
  const IMG = `${ORIGINS[0]}u1/a.webp`;
  for (const tag of RICH_TEXT_TAGS) {
    if (tag === "br" || tag === "hr") {
      const p = el(parseRichText(sanitizeRichText(`<p>앞<${tag}>뒤</p>`, { imageOrigins: ORIGINS })));
      assert.equal(p.tag, "p", tag);
      assert.deepEqual(p.children[0], { type: "text", text: "앞" }, tag);
      assert.equal(el(p.children, 1).tag, tag);
      assert.deepEqual(el(p.children, 1).children, [], tag);
      assert.deepEqual(p.children[2], { type: "text", text: "뒤" }, tag);
      continue;
    }
    if (tag === "img") {
      const nodes = parseRichText(sanitizeRichText(`<img src="${IMG}" alt="설명 &quot;1&quot;">`, { imageOrigins: ORIGINS }));
      assert.equal(nodes.length, 1);
      assert.deepEqual(el(nodes), { type: "element", tag: "img", attrs: { src: IMG, alt: '설명 "1"' }, children: [] });
      continue;
    }
    if (tag === "a") {
      const nodes = parseRichText(sanitizeRichText('<a href="https://x.com/?a=1&amp;b=2">글 &amp; 글</a>', { imageOrigins: ORIGINS }));
      assert.equal(nodes.length, 1);
      const a = el(nodes);
      assert.deepEqual(a.attrs, { href: "https://x.com/?a=1&b=2", target: "_blank", rel: "noopener noreferrer nofollow" });
      assert.deepEqual(a.children, [{ type: "text", text: "글 & 글" }]);
      continue;
    }
    const nodes = parseRichText(sanitizeRichText(`<${tag} style="color: #ff0000">글 &lt; 글</${tag}>`, { imageOrigins: ORIGINS }));
    assert.equal(nodes.length, 1, tag);
    const node = el(nodes);
    assert.equal(node.tag, tag);
    assert.deepEqual(node.attrs, { style: "color: #ff0000" }, tag);
    assert.deepEqual(node.children, [{ type: "text", text: "글 < 글" }], tag);
  }
});

test("void 태그 뒤의 텍스트는 그 안으로 들어가지 않는다", () => {
  const nodes = parseRichText("<p>앞<br>뒤<img src=\"https://a/b.webp\">끝</p>");
  const p = el(nodes);
  assert.equal(p.children.length, 5);
  assert.deepEqual(p.children[0], { type: "text", text: "앞" });
  assert.equal(el(p.children, 1).tag, "br");
  assert.deepEqual(p.children[2], { type: "text", text: "뒤" });
  assert.equal(el(p.children, 3).tag, "img");
  assert.deepEqual(p.children[4], { type: "text", text: "끝" });
});

test("중첩 목록은 트리 그대로 나온다", () => {
  const nodes = parseRichText("<ol><li>하나<ul><li>하나-가</li><li>하나-나</li></ul></li><li>둘</li></ol>");
  const ol = el(nodes);
  assert.equal(ol.tag, "ol");
  assert.equal(ol.children.length, 2);
  const li1 = el(ol.children, 0);
  assert.deepEqual(li1.children[0], { type: "text", text: "하나" });
  const ul = el(li1.children, 1);
  assert.equal(ul.tag, "ul");
  assert.equal(ul.children.length, 2);
  assert.deepEqual(el(ul.children, 1).children, [{ type: "text", text: "하나-나" }]);
  assert.deepEqual(el(ol.children, 1).children, [{ type: "text", text: "둘" }]);
});

test("링크·이미지 속성은 허용 목록만 남고 엔티티가 풀린다", () => {
  const a = el(
    parseRichText(
      '<a href="https://x.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow" onclick="x" data-x="1">링크</a>',
    ),
  );
  assert.deepEqual(a.attrs, {
    href: "https://x.com/?a=1&b=2",
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  });
  const img = el(parseRichText('<img src="https://a/b.webp" alt="사진 &quot;1&quot;" width="10" style="color: red">'));
  assert.deepEqual(img.attrs, { src: "https://a/b.webp", alt: '사진 "1"', style: "color: red" });
  // style 은 모든 허용 태그에 붙을 수 있다(새니타이저가 그렇게 남긴다).
  const span = el(parseRichText('<span style="color: #ff0000; font-size: large" class="x">색</span>'));
  assert.deepEqual(span.attrs, { style: "color: #ff0000; font-size: large" });
});

test("모르는 태그는 껍데기만 사라지고 내용은 텍스트로 이어진다", () => {
  assert.deepEqual(parseRichText("<table><tr><td>칸</td></tr></table>글"), [{ type: "text", text: "칸글" }]);
  const nodes = parseRichText("<p><font color=\"red\">a</font>b</p>");
  assert.deepEqual(el(nodes).children, [{ type: "text", text: "ab" }]);
  // 내용까지 버리는 태그(script·style)는 새니타이저와 같게 텅 빈다.
  assert.deepEqual(parseRichText("<p>앞</p><script>alert(1)</script><style>p{}</style><p>뒤</p>").length, 2);
  assert.equal(richTextNodesToText(parseRichText("<style>p{color:red}</style>글")), "글");
});

test("잘린·깨진 입력에도 던지지 않는다", () => {
  const cases = [
    "",
    "<",
    "<p",
    "<p><strong>글",
    "글</div></p>",
    "<p><b>a</i>b</b>c</p>",
    "<a href=\"https://x.com",
    "&amp",
    "&#xZZ; &#99999999999; &foo; &",
    "<!-- 주석",
    "<![CDATA[ x",
    "<script>alert(1)",
    "<img src=\"x\" alt=\"",
  ];
  for (const html of cases) {
    assert.doesNotThrow(() => parseRichText(html), html);
  }
  // 닫히지 않은 태그는 트리에 그대로(끝에서 닫힌 것과 같다).
  const nodes = parseRichText("<p><strong>글");
  assert.deepEqual(el(el(nodes).children).children, [{ type: "text", text: "글" }]);
  // 짝 없는 닫는 태그는 무시된다.
  assert.deepEqual(parseRichText("글</div></p>"), [{ type: "text", text: "글" }]);
  // 어긋난 닫는 태그(</i> 가 <b> 를 닫지 않음)도 트리가 깨지지 않는다.
  const p = el(parseRichText("<p><b>a</i>b</b>c</p>"));
  assert.equal(el(p.children).tag, "b");
  assert.deepEqual(el(p.children).children, [{ type: "text", text: "ab" }]);
  assert.deepEqual(p.children[1], { type: "text", text: "c" });
});

test("텍스트 엔티티는 브라우저만큼 풀리고 모르는 것은 그대로 남는다", () => {
  const text = richTextNodesToText(parseRichText("a &lt; b &amp; c &gt; &quot;d&quot; &#39;e&#39; f&nbsp;g &#x1F600; &foo; &amp;lt;"));
  assert.equal(text, "a < b & c > \"d\" 'e' f g \u{1F600} &foo; &lt;");
  // 16진 아포스트로피(&#x27; — 일부 이스케이프 라이브러리가 내는 모양)·대소문자·세미콜론 없는 숫자 엔티티.
  // (세미콜론이 없으면 브라우저처럼 숫자를 끝까지 읽는다 — `&#x27b` 는 U+027B 다. 그래서 10진으로 본다.)
  assert.equal(richTextNodesToText(parseRichText("&#x27;a&#X27; &#39b &AMP; &Nbsp;")), "'a' 'b & \u00a0");
  assert.equal(richTextNodesToText(parseRichText("&#x27b")), "\u027b");
  // 범위 밖 코드포인트는 글자 그대로 남는다(던지지 않는다).
  assert.equal(richTextNodesToText(parseRichText("&#x110000; &#1114112;")), "&#x110000; &#1114112;");
});

test("30KB 본문도 노드 수가 태그 수와 같고 트리가 평평하다(선형 시간 구현 확인)", () => {
  // 실행 시간을 단언하지 않는다(CI 기계 편차). 구현이 out 배열 push 만 하는지는 주석과
  // 코드 리뷰로 못 박고, 여기서는 큰 입력이 통째로 처리되는지만 본다.
  const unit = "<p><strong>굵게</strong> 글 <a href=\"https://x.com\">링크</a></p>";
  const count = Math.ceil(30000 / unit.length);
  const html = unit.repeat(count);
  assert.ok(html.length >= 30000);
  const nodes = parseRichText(html);
  assert.equal(nodes.length, count);
  assert.equal(el(nodes, count - 1).tag, "p");
});

// 기존 새니타이저 픽스처: 새니타이저를 통과한 HTML 을 다시 파스했을 때 글자가 보존돼야 한다.
const ROUNDTRIP_FIXTURES = [
  '<p><strong>굵게</strong> <em>기울임</em> <span style="color: #ff0000; font-size: large">색</span></p>',
  '<p>앞</p><script>alert("xss")</script><p>뒤</p>',
  '<p onclick="steal()" onmouseover="x">글</p>',
  '<a href="javascript:alert(1)">눌러</a>',
  '<a href="https://example.com">링크</a>',
  `<img src="${ORIGINS[0]}a.webp" alt="사진">`,
  '<p style="color: red; position: fixed; background-image: url(javascript:1); text-align: center">글</p>',
  '<font size="5" color="#123456">글</font>',
  "<p><strong>글",
  "글</div></p>",
  "<table><tr><td>칸</td></tr></table>",
  "<p>a < b &amp; c</p>",
  "<p>a&nbsp;b</p><p>'따옴표' \"큰따옴표\" &#39;엔티티&#39;</p>",
  "<ul><li>하나</li><li>둘<ol><li>둘-1</li></ol></li></ul><hr><pre>코드\n  들여쓰기</pre><blockquote>인용</blockquote><h2>제목</h2><h3>소제목</h3>",
];

test("sanitizeRichText 출력을 parseRichText 로 되돌리면 글자가 보존된다(왕복)", () => {
  // richTextToPlain 은 블록 경계에 개행을 넣고 파서는 넣지 않으므로 공백을 전부 걷어내고 비교한다.
  const norm = (s: string) => s.replace(/\s+/g, "");
  for (const html of ROUNDTRIP_FIXTURES) {
    const sanitized = sanitizeRichText(html, { imageOrigins: ORIGINS });
    const text = richTextNodesToText(parseRichText(sanitized));
    assert.equal(norm(text), norm(richTextToPlain(sanitized)), html);
  }
  // 이스케이프된 꺾쇠·앰퍼샌드는 원문 글자로 돌아온다.
  assert.equal(richTextNodesToText(parseRichText(sanitizeRichText("<p>a < b &amp; c</p>"))), "a < b & c");
});
