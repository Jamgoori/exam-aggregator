import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeRichText,
  decomposeRichText,
  isRichTextLiteUrl,
  RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP,
  RICH_TEXT_LITE_UNSUPPORTED_STYLE,
  RICH_TEXT_LITE_UNSUPPORTED_TEXT,
} from "./rich-text-lite";
import { parseRichText, sanitizeRichText } from "./rich-text";

const ORIGIN = "https://cdn.example.com/storage/v1/object/public/board-images/";
const OPTS = { imageOrigins: [ORIGIN] };
const IMG = `${ORIGIN}u1/a.webp`;

function lite(result: ReturnType<typeof decomposeRichText>): string {
  assert.ok("lite" in result, `unsupported: ${"unsupported" in result ? result.unsupported.join(",") : ""}`);
  return result.lite;
}

function unsupported(result: ReturnType<typeof decomposeRichText>): string[] {
  assert.ok("unsupported" in result, `lite 로 되돌아옴: ${"lite" in result ? result.lite : ""}`);
  return result.unsupported;
}

// ── 마크업 명세(마커 ↔ HTML) ────────────────────────────────────────────────
test("compose — 마커 하나하나가 명세의 HTML 로 간다", () => {
  const cases: Array<[string, string]> = [
    ["글", "<p>글</p>"],
    ["", ""],
    ["\n", "<p><br></p><p><br></p>"],
    ["앞\n\n뒤", "<p>앞</p><p><br></p><p>뒤</p>"],
    ["**굵게**", "<p><strong>굵게</strong></p>"],
    ["*기울임*", "<p><em>기울임</em></p>"],
    ["__밑줄__", "<p><u>밑줄</u></p>"],
    ["~~취소~~", "<p><s>취소</s></p>"],
    ["- 하나\n- 둘", "<ul><li>하나</li><li>둘</li></ul>"],
    ["1. 하나\n2. 둘\n7. 셋", "<ol><li>하나</li><li>둘</li><li>셋</li></ol>"],
    ["> 인용\n> 둘째 줄", "<blockquote><p>인용</p><p>둘째 줄</p></blockquote>"],
    ["> ", "<blockquote><p><br></p></blockquote>"],
    [">", "<blockquote><p><br></p></blockquote>"],
    [
      "[글](https://example.com/a?b=1&c=2)",
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">글</a></p>',
    ],
    [`![설명](${IMG})`, `<img src="${IMG}" alt="설명">`],
    [`![](${IMG})`, `<img src="${IMG}">`],
    ["a < b & c > d", "<p>a &lt; b &amp; c &gt; d</p>"],
    ["**굵게 *기울임* 굵게**", "<p><strong>굵게 <em>기울임</em> 굵게</strong></p>"],
    ["- **굵은** 항목", "<ul><li><strong>굵은</strong> 항목</li></ul>"],
    ["- 목록\n글\n1. 번호", "<ul><li>목록</li></ul><p>글</p><ol><li>번호</li></ol>"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(composeRichText(input, OPTS), expected, JSON.stringify(input));
  }
});

test("compose — 짝이 없거나 공백에 닿은 마커·주소가 아닌 것은 글자 그대로", () => {
  assert.equal(composeRichText("2 * 3 * 4", OPTS), "<p>2 * 3 * 4</p>");
  assert.equal(composeRichText("x ** y **z", OPTS), "<p>x ** y **z</p>");
  assert.equal(composeRichText("**a *b", OPTS), "<p>**a *b</p>");
  assert.equal(composeRichText("****", OPTS), "<p>****</p>");
  assert.equal(composeRichText("[글](mailto:a@b.c)", OPTS), "<p>[글](mailto:a@b.c)</p>");
  assert.equal(composeRichText("[글](/papers/x)", OPTS), "<p>[글](/papers/x)</p>");
  assert.equal(composeRichText("[글](javascript:alert(1))", OPTS), "<p>[글](javascript:alert(1))</p>");
  // 한 줄 전체가 아니면 이미지가 아니다.
  assert.equal(composeRichText(`사진 ![a](${IMG})`, OPTS), `<p>사진 ![a](${IMG})</p>`);
  // 허용 접두사 밖 이미지는 요소가 되지 못한다(조용히 사라지지 않고 글자로 남는다).
  assert.equal(composeRichText("![a](https://evil.example/x.png)", OPTS), "<p>![a](https://evil.example/x.png)</p>");
  assert.equal(composeRichText(`![a](${IMG})`, {}), `<p>![a](${IMG})</p>`);
  // 경로 탈출·쿼리가 든 주소도 새니타이저 판정을 그대로 따른다.
  assert.equal(composeRichText(`![a](${ORIGIN}../x.webp)`, OPTS), `<p>![a](${ORIGIN}../x.webp)</p>`);
  assert.equal(composeRichText(`![a](${ORIGIN}a.webp?x=1)`, OPTS), `<p>![a](${ORIGIN}a.webp?x=1)</p>`);
});

test("isRichTextLiteUrl — http(s) 이고 공백·따옴표·꺾쇠·괄호·제어문자가 없어야 한다", () => {
  assert.equal(isRichTextLiteUrl("https://example.com/a?b=1&c=2#x"), true);
  assert.equal(isRichTextLiteUrl("HTTP://EXAMPLE.COM"), true);
  assert.equal(isRichTextLiteUrl("mailto:a@b.c"), false);
  assert.equal(isRichTextLiteUrl("/papers/x"), false);
  assert.equal(isRichTextLiteUrl("https://e.com/a b"), false);
  assert.equal(isRichTextLiteUrl('https://e.com/"x'), false);
  assert.equal(isRichTextLiteUrl("https://e.com/(x)"), false);
  assert.equal(isRichTextLiteUrl("https://e.com/\u0001x"), false);
});

// ── 마커 문자 정책(이스케이프 없음 — 머리말 한계) ───────────────────────────────
// "**" 를 글자로 쓰고 싶을 때: 짝이 없거나 공백에 닿은 마커는 글자 그대로 남고, 짝이 맞으면 서식이
// 된다. 역슬래시는 이스케이프가 **아니다**(글자일 뿐이라 `\*a\*` 는 그대로 기울임이 된다). 어느 쪽이든
// 왕복은 그대로다.
test("마커를 글자로 — 짝 없는 마커는 글자, 역슬래시는 이스케이프가 아니며, 왕복이 그대로다", () => {
  const cases: Array<[string, string]> = [
    ["**", "<p>**</p>"],
    ["a**b", "<p>a**b</p>"],
    ["**a**b**", "<p><strong>a</strong>b**</p>"],
    ["\\*a\\*", "<p>\\<em>a\\</em></p>"],
    ["***a***", "<p><strong>*a</strong>*</p>"],
    ["__ __", "<p>__ __</p>"],
  ];
  for (const [input, html] of cases) {
    assert.equal(composeRichText(input, OPTS), html, input);
    assert.equal(sanitizeRichText(html, OPTS), html, input);
    assert.equal(lite(decomposeRichText(html, OPTS)), input, input);
  }
});

// ── 주소의 괄호·설명의 대괄호 ────────────────────────────────────────────────
test("링크 주소의 ')'·이미지 설명의 ']' 는 요소가 되지 않고 글자로 남으며 왕복이 깨지지 않는다", () => {
  // 위키 주소처럼 ")" 가 든 주소 — 링크가 되지 못하고(머리말 한계) 글자 그대로. 왕복도 그대로.
  const wiki = "[서울](https://ko.wikipedia.org/wiki/서울_(도시))";
  assert.equal(composeRichText(wiki, OPTS), `<p>${wiki}</p>`);
  assert.equal(lite(decomposeRichText(composeRichText(wiki, OPTS), OPTS)), wiki);
  // 첫 ")" 에서 주소가 끝나고 나머지는 글자다.
  const tail = "[a](https://e.com/x)y)";
  assert.equal(
    composeRichText(tail, OPTS),
    '<p><a href="https://e.com/x" target="_blank" rel="noopener noreferrer nofollow">a</a>y)</p>',
  );
  assert.equal(lite(decomposeRichText(composeRichText(tail, OPTS), OPTS)), tail);
  // 설명에 "]" — 이미지 줄이 아니라 글자.
  const badAlt = `![a]b](${IMG})`;
  assert.equal(composeRichText(badAlt, OPTS), `<p>${badAlt}</p>`);
  assert.equal(lite(decomposeRichText(composeRichText(badAlt, OPTS), OPTS)), badAlt);
  // 설명의 괄호는 된다.
  const parenAlt = `![a(b)](${IMG})`;
  assert.equal(composeRichText(parenAlt, OPTS), `<img src="${IMG}" alt="a(b)">`);
  assert.equal(lite(decomposeRichText(composeRichText(parenAlt, OPTS), OPTS)), parenAlt);
  // 웹에서 저장된 alt 에 "]" 가 있으면 lite 로 적을 수 없어 unsupported.
  assert.deepEqual(unsupported(decomposeRichText(sanitizeRichText(`<img src="${IMG}" alt="a]b">`, OPTS), OPTS)), ["img"]);
  // 링크 글자에 "]" 가 있어도 마찬가지.
  assert.deepEqual(
    unsupported(decomposeRichText(sanitizeRichText('<p><a href="https://e.com">a]b</a></p>', OPTS), OPTS)),
    ["a"],
  );
});

// ── 보증 (1): compose 결과는 새니타이저를 다시 통과해도 같은 문자열 ─────────────
const LITE_SAMPLES = [
  "글",
  "",
  "\n",
  "앞\n\n뒤\n",
  "**굵게** *기울임* __밑줄__ ~~취소~~",
  "**굵게 *기울임* 굵게**",
  "__밑줄 ~~취소~~ 밑줄__",
  "- 하나\n- **둘**\n- 셋\n\n1. 가\n2. 나",
  "> 인용\n> \n> *둘째*",
  `[글](https://example.com/a?b=1&c=2)`,
  `[**굵은 링크**](http://example.com)`,
  `![설명 &"<>](${IMG})`,
  `![](${IMG})`,
  `앞\n![사진](${IMG})\n뒤`,
  "a < b & c > d &amp; &lt; &quot; &#39; &nbsp;",
  "  앞 공백  \n뒤",
  "2 * 3 * 4 ** x ** y",
  "[글](mailto:a@b.c) [글](/x) ![a](https://evil.example/x.png)",
  "가".repeat(3000) + "\n" + "- 나".repeat(50),
];

test("compose 결과는 sanitizeRichText 를 다시 통과해도 같은 문자열이다", () => {
  for (const sample of LITE_SAMPLES) {
    const html = composeRichText(sample, OPTS);
    assert.equal(sanitizeRichText(html, OPTS), html, JSON.stringify(sample));
  }
});

// ── 보증 (3): compose → decompose 가 원문을 돌려준다 ───────────────────────────
test("compose → decompose 왕복은 lite 원문과 같다", () => {
  for (const sample of LITE_SAMPLES) {
    const html = composeRichText(sample, OPTS);
    assert.equal(lite(decomposeRichText(html, OPTS)), sample, JSON.stringify(sample));
  }
});

test("왕복에서 정규화되는 것 — 개행 종류·번호 목록의 번호", () => {
  assert.equal(lite(decomposeRichText(composeRichText("가\r\n나\r다", OPTS), OPTS)), "가\n나\n다");
  assert.equal(lite(decomposeRichText(composeRichText("3. 가\n9. 나", OPTS), OPTS)), "1. 가\n2. 나");
});

// ── 보증 (2): decompose 가 받아주는 웹 변형 ────────────────────────────────────
test("decompose — compose 부분집합과 같은 DOM 을 이루는 웹 변형은 되돌린다", () => {
  const cases: Array<[string, string]> = [
    ["<p><b>굵게</b> <i>기울임</i> <strike>취소</strike></p>", "**굵게** *기울임* ~~취소~~"],
    ['<p><a href="https://example.com">링크</a></p>', "[링크](https://example.com)"],
    ["<p>a&nbsp;b &amp; c</p>", "a b & c"],
    ["<p><strong> 공백 </strong>뒤</p>", " **공백** 뒤"],
    ["<p><strong></strong>글</p>", "글"],
    ["<p></p><p>글</p>", "\n글"],
    ["<blockquote>인용</blockquote>", "> 인용"],
    ["<ul><li><p>항목</p></li></ul>", "- 항목"],
    // 공백·&nbsp;·<br> 만 든 문단은 빈 줄이다(웹 에디터가 빈 줄에 &nbsp; 를 남긴다) — 잠기지 않는다.
    ["<p>&nbsp;</p><p>글</p>", "\n글"],
    ["<p> </p><p>글</p>", "\n글"],
    ["<p> <br> </p><p>글</p>", "\n글"],
    ["<p>글</p><p>&nbsp;</p>", "글\n"],
    ["<ul><li><p>&nbsp;</p></li><li>둘</li></ul>", "- \n- 둘"],
    [`<p><img src="${IMG}" alt=""></p>`, `![](${IMG})`],
    ["<p>앞</p>\n<ul>\n<li>하나</li>\n</ul>\n", "앞\n- 하나"],
  ];
  for (const [html, expected] of cases) {
    const sanitized = sanitizeRichText(html, OPTS);
    assert.equal(lite(decomposeRichText(sanitized, OPTS)), expected, html);
  }
});

// ── unsupported ───────────────────────────────────────────────────────────────
test("decompose — 부분집합 밖 태그는 이름을 돌려준다", () => {
  const cases: Array<[string, string[]]> = [
    ["<h2>제목</h2>", ["h2"]],
    ["<h3>소제목</h3>", ["h3"]],
    ["<div>글</div>", ["div"]],
    ['<p><span style="color: #ff0000">색</span></p>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "span"]],
    ["<p><span>글</span></p>", ["span"]],
    ["<pre>코드</pre>", ["pre"]],
    ["<p><code>x</code></p>", ["code"]],
    ["<hr>", ["hr"]],
    ["<p>줄<br>바꿈</p>", ["br"]],
    ["<br>", ["br"]],
    ["<ul><li>둘<ol><li>둘-1</li></ol></li></ul>", ["ol"]],
    ['<p style="text-align: center">글</p>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE]],
    ['<p><a href="mailto:a@b.c">메일</a></p>', ["a"]],
    ['<p><a href="/papers/x">내부</a></p>', ["a"]],
    ["글", [RICH_TEXT_LITE_UNSUPPORTED_TEXT]],
    ["<strong>루트 인라인</strong>", ["strong"]],
    // 마커 문자와 충돌해 다시 조합하면 다른 트리가 되는 본문은 마지막 관문에서 잠긴다.
    ["<p><strong>a**b</strong></p>", [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP]],
    ["<p>[글](https://example.com)</p>", [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP]],
    ["<p>- 목록처럼</p>", [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP]],
  ];
  for (const [html, expected] of cases) {
    const sanitized = sanitizeRichText(html, OPTS);
    assert.deepEqual(unsupported(decomposeRichText(sanitized, OPTS)).sort(), [...expected].sort(), html);
  }
});

// 웹 새니타이저 픽스처(rich-text.test.ts ROUNDTRIP_FIXTURES)와 같은 묶음 — 부분집합 밖은 unsupported,
// 안은 되돌아온다.
test("웹 새니타이저 픽스처 — 부분집합 밖 HTML 은 unsupported, 안은 되돌린다", () => {
  const fixtures: Array<[string, "lite" | "unsupported"]> = [
    ['<p><strong>굵게</strong> <em>기울임</em> <span style="color: #ff0000; font-size: large">색</span></p>', "unsupported"],
    ['<p>앞</p><script>alert("xss")</script><p>뒤</p>', "lite"],
    ['<p onclick="steal()" onmouseover="x">글</p>', "lite"],
    ['<a href="javascript:alert(1)">눌러</a>', "unsupported"],
    ['<a href="https://example.com">링크</a>', "unsupported"],
    [`<img src="${ORIGIN}a.webp" alt="사진">`, "lite"],
    ['<p style="color: red; position: fixed; background-image: url(javascript:1); text-align: center">글</p>', "unsupported"],
    ['<font size="5" color="#123456">글</font>', "unsupported"],
    ["<p><strong>글", "lite"],
    ["글</div></p>", "unsupported"],
    ["<table><tr><td>칸</td></tr></table>", "unsupported"],
    ["<p>a < b &amp; c</p>", "lite"],
    ["<p>a&nbsp;b</p><p>'따옴표' \"큰따옴표\" &#39;엔티티&#39;</p>", "lite"],
    ["<ul><li>하나</li><li>둘<ol><li>둘-1</li></ol></li></ul><hr><pre>코드\n  들여쓰기</pre><blockquote>인용</blockquote><h2>제목</h2><h3>소제목</h3>", "unsupported"],
  ];
  for (const [html, kind] of fixtures) {
    const sanitized = sanitizeRichText(html, OPTS);
    const result = decomposeRichText(sanitized, OPTS);
    assert.equal(kind in result, true, html);
    if ("lite" in result) {
      // 되돌린 것을 다시 조합하면 같은 글자다.
      const again = composeRichText(result.lite, OPTS);
      const text = (h: string) => JSON.stringify(parseRichText(h)).replace(/\s+/g, "");
      assert.equal(text(again), text(sanitized), html);
    }
  }
});

test("decompose 는 어떤 입력에도 던지지 않는다", () => {
  for (const html of ["", "<", "<p", "<p><strong>", "</p></strong>", "<img", "<ul><li>", "&#xZZ;", "<a href=>x</a>"]) {
    assert.doesNotThrow(() => decomposeRichText(html, OPTS), html);
    assert.doesNotThrow(() => composeRichText(html, OPTS), html);
  }
});
