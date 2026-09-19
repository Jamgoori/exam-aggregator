import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeRichText,
  decomposeRichText,
  isRichTextLiteUrl,
  normalizeRichTextTree,
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
    ['<p><span style="color: #ff0000">색</span></p>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "span"]],
    ["<p><span>글</span></p>", ["span"]],
    ["<pre>코드</pre>", ["pre"]],
    ["<p><code>x</code></p>", ["code"]],
    ["<hr>", ["hr"]],
    ["<ul><li>줄<br>바꿈</li></ul>", ["br"]],
    ["<p><strong>줄<br>바꿈</strong></p>", ["br"]],
    ["<ul><li>둘<ol><li>둘-1</li></ol></li></ul>", ["ol"]],
    ['<p style="text-align: center">글</p>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE]],
    ['<p><a href="mailto:a@b.c">메일</a></p>', ["a"]],
    ['<p><a href="/papers/x">내부</a></p>', ["a"]],
    ["<ul>글<li>항목</li></ul>", [RICH_TEXT_LITE_UNSUPPORTED_TEXT]],
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
    ['<a href="https://example.com">링크</a>', "lite"],
    [`<img src="${ORIGIN}a.webp" alt="사진">`, "lite"],
    ['<p style="color: red; position: fixed; background-image: url(javascript:1); text-align: center">글</p>', "unsupported"],
    ['<font size="5" color="#123456">글</font>', "unsupported"],
    ["<p><strong>글", "lite"],
    ["글</div></p>", "lite"],
    ["<table><tr><td>칸</td></tr></table>", "lite"],
    ["<p>a < b &amp; c</p>", "lite"],
    ["<p>a&nbsp;b</p><p>'따옴표' \"큰따옴표\" &#39;엔티티&#39;</p>", "lite"],
    ["<ul><li>하나</li><li>둘<ol><li>둘-1</li></ol></li></ul><hr><pre>코드\n  들여쓰기</pre><blockquote>인용</blockquote><h2>제목</h2><h3>소제목</h3>", "unsupported"],
  ];
  for (const [html, kind] of fixtures) {
    const sanitized = sanitizeRichText(html, OPTS);
    const result = decomposeRichText(sanitized, OPTS);
    assert.equal(kind in result, true, html);
    if ("lite" in result) {
      // 되돌린 것을 다시 조합하면 정규화된 원본과 같은 트리다(루트 인라인은 문단으로 감싸인다).
      const again = composeRichText(result.lite, OPTS);
      const text = (h: string) => JSON.stringify(normalizeRichTextTree(parseRichText(h))).replace(/\s+/g, "");
      assert.equal(text(again), text(sanitized), html);
    }
  }
});

// ── 웹 에디터 출력 정규화(브라우저별 실제 출력) ────────────────────────────────
// 웹 에디터(contenteditable)는 defaultParagraphSeparator 없이 오래 돌아 브라우저마다 다른 모양을 저장했다.
// 정규화가 그 모양을 compose 의 모양으로 접어 되돌리고, 되돌린 lite 를 다시 조합한 것이 정규화된 원본과
// 같은 트리인지(#roundtrip 관문)까지 여기서 본다.
test("웹 에디터 출력 — Chrome·Firefox·Safari 의 문단 모양을 되돌린다", () => {
  const cases: Array<[string, string]> = [
    // Chrome: 첫 줄은 루트 텍스트, 문단은 div, 빈 줄은 <div><br></div>.
    ["첫줄<div>둘째</div><div><br></div><div>셋째</div>", "첫줄\n둘째\n\n셋째"],
    // Chrome styleWithCSS 굵게·기울임·밑줄·취소선(새니타이저가 세미콜론을 정리한다).
    ['<span style="font-weight: bold;">굵게</span>', "**굵게**"],
    ['<div><span style="font-weight: 700">굵게</span> 글</div>', "**굵게** 글"],
    ['<div><span style="font-style: italic;">기울임</span></div>', "*기울임*"],
    ['<div><span style="text-decoration: underline;">밑줄</span></div>', "__밑줄__"],
    ['<div><span style="text-decoration-line: line-through;">취소</span></div>', "~~취소~~"],
    ['<div><span style="text-decoration: underline line-through;">둘</span></div>', "__~~둘~~__"],
    ['<div><span style="font-weight: bold; text-decoration: underline;">굵은 밑줄</span></div>', "**__굵은 밑줄__**"],
    // Chrome 이 굵게를 끊고 새 문단을 만들 때 남기는 빈 서식 요소 — 빈 줄이다.
    ["<div><b>a</b></div><div><b><br></b></div><div>b</div>", "**a**\n\nb"],
    // Firefox 옛 br 모드: 줄이 <br> 로만 나뉜다.
    ["첫줄<br>둘째", "첫줄\n둘째"],
    ["첫줄<br><br>셋째", "첫줄\n\n셋째"],
    // Safari: 첫 줄부터 div, 굵게는 <b>.
    ["<div>첫줄</div><div>둘째</div>", "첫줄\n둘째"],
    ["<div><b>굵게</b></div>", "**굵게**"],
    ["<b>굵게</b>", "**굵게**"],
    // 이미지 삽입 뒤 에디터가 붙이는 문단.
    [`<img src="${IMG}"><p><br></p>`, `![](${IMG})\n`],
    [`첫줄<img src="${IMG}"><p><br></p><p>뒤</p>`, `첫줄\n![](${IMG})\n\n뒤`],
    [`<div><img src="${IMG}"></div>`, `![](${IMG})`],
    // 새 웹 에디터(defaultParagraphSeparator=p, styleWithCSS=false 굵게)가 내는 모양.
    ["<p>첫줄</p><p>둘째</p><p><br></p><p><b>굵게</b> <i>기울임</i> <u>밑줄</u> <strike>취소</strike></p>", "첫줄\n둘째\n\n**굵게** *기울임* __밑줄__ ~~취소~~"],
    // 문단 안의 <br> — p 여백이 0 이라 문단을 나눈 것과 화면이 같다. 블록 끝 br 하나는 줄이 아니다.
    ["<p>줄<br>바꿈</p>", "줄\n바꿈"],
    ["<p>줄<br></p><p>뒤</p>", "줄\n뒤"],
    ["<p>줄<br><br></p><p>뒤</p>", "줄\n\n뒤"],
    ["<p><br>앞에 빈 줄</p>", "\n앞에 빈 줄"],
    ["<blockquote>인용<br>둘째</blockquote>", "> 인용\n> 둘째"],
    ["<blockquote><p>인용</p>덧붙임</blockquote>", "> 인용\n> 덧붙임"],
    // 루트에 놓인 br 은 블록 사이의 빈 줄이다.
    ["<p>a</p><br><p>b</p>", "a\n\nb"],
    // 블록 사이의 공백만 든 루트 텍스트는 문단이 아니다.
    ["<div>a</div>\n  \n<div>b</div>", "a\nb"],
    // Chrome 의 빈 목록 항목.
    ["<ul><li>하나</li><li><br></li></ul>", "- 하나\n- "],
    // Chrome 은 div 문단 안에서 목록·인용을 만들면 그 div 를 벗기지 않고 <div><ul>…</ul></div> 로 저장한다 —
    // div 에는 CSS 규칙이 없어 벗겨도 화면이 같으므로 껍데기만 벗긴다(안의 인라인 연속은 문단으로).
    ["<div><ul><li>하나</li><li>둘</li></ul></div>", "- 하나\n- 둘"],
    ["첫줄<div><ol><li>가</li></ol></div><div>뒤</div>", "첫줄\n1. 가\n뒤"],
    ["<div>앞<ul><li>항목</li></ul>뒤</div>", "앞\n- 항목\n뒤"],
    ["<div><blockquote>인용</blockquote></div>", "> 인용"],
    ["<blockquote><div>인용</div><div>둘째</div></blockquote>", "> 인용\n> 둘째"],
    ["<div><div>중첩</div></div>", "중첩"],
    ["<div><p>문단</p><div>둘째</div></div>", "문단\n둘째"],
    ["<ul><li><div>항목</div></li></ul>", "- 항목"],
  ];
  for (const [html, expected] of cases) {
    const sanitized = sanitizeRichText(html, OPTS);
    const result = decomposeRichText(sanitized, OPTS);
    assert.equal(lite(result), expected, html);
    // 앱에서 저장하면 이 모양이 된다 — 정규화된 원본과 같은 트리(compose 결과는 새니타이저 고정점).
    const again = composeRichText(expected, OPTS);
    assert.equal(sanitizeRichText(again, OPTS), again, html);
  }
});

test("웹 에디터 출력 — 여전히 잠기는 것(웹 전용 도구·색·크기·정렬·중첩)", () => {
  const cases: Array<[string, string[]]> = [
    // 구분선은 웹 전용 도구라 잠기는 것이 맞다(에디터가 뒤에 붙인 문단은 되돌아온다).
    ["<hr><p><br></p>", ["hr"]],
    ["<h2>제목</h2><div>본문</div>", ["h2"]],
    ["<pre>코드</pre>", ["pre"]],
    ["<div><code>x</code></div>", ["code"]],
    // 색·크기·정렬이 섞인 span 은 접지 않는다 — 굵게만 살리고 색을 잃는 저장이 되면 안 된다.
    ['<div><span style="font-weight: bold; color: #dc2626">굵은 빨강</span></div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "span"]],
    ['<div><span style="font-size: x-large">크게</span></div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "span"]],
    ['<div><span style="font-weight: normal">보통</span></div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "span"]],
    ['<div style="text-align: center">가운데</div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE]],
    ['<div style="text-align: center">가운데<br>둘째</div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE]],
    ["<div><span>맨 span</span></div>", ["span"]],
    ["<ul><li>둘<ol><li>둘-1</li></ol></li></ul>", ["ol"]],
    ["<ul><li><p style=\"text-align: right\">오른쪽</p></li></ul>", [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "p"]],
    // 블록을 품은 div 는 벗기지만 style(정렬)이 있으면 남긴다 — 정렬을 조용히 잃는 저장이 되면 안 된다.
    ['<div style="text-align: center"><ul><li>가운데 목록</li></ul></div>', [RICH_TEXT_LITE_UNSUPPORTED_STYLE, "div"]],
    // div 를 벗겨도 안에 있는 것이 부분집합 밖이면 그 이름으로 잠긴다.
    ["<div><ul><li>둘<ol><li>둘-1</li></ol></li></ul></div>", ["ol"]],
    ["<div><h2>제목</h2></div>", ["h2"]],
    ["<div><hr></div>", ["hr"]],
    // 굵게와 기울임을 같은 글자에 — 마커가 "***" 로 붙어 다시 조합하면 다른 트리(머리말 한계).
    ['<div><span style="font-weight: bold; font-style: italic">둘 다</span></div>', [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP]],
    // 홀로 놓인 br 은 빈 줄 하나인데 lite "" 는 빈 본문이라 되돌아오지 못한다(저장될 수 없는 본문).
    ["<br>", [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP]],
  ];
  for (const [html, expected] of cases) {
    const sanitized = sanitizeRichText(html, OPTS);
    assert.deepEqual(unsupported(decomposeRichText(sanitized, OPTS)).sort(), [...expected].sort(), html);
  }
});

test("정규화는 compose 의 출력에서 멱등이다 — 앱 글은 접을 것이 없다", () => {
  for (const sample of LITE_SAMPLES) {
    const html = composeRichText(sample, OPTS);
    const once = normalizeRichTextTree(parseRichText(html));
    const twice = normalizeRichTextTree(once);
    assert.deepEqual(twice, once, JSON.stringify(sample));
    assert.deepEqual(once, parseRichText(html), JSON.stringify(sample));
  }
});

test("decompose 는 어떤 입력에도 던지지 않는다", () => {
  for (const html of ["", "<", "<p", "<p><strong>", "</p></strong>", "<img", "<ul><li>", "&#xZZ;", "<a href=>x</a>"]) {
    assert.doesNotThrow(() => decomposeRichText(html, OPTS), html);
    assert.doesNotThrow(() => composeRichText(html, OPTS), html);
  }
});

// 새니타이저 상한(RICH_TEXT_HTML_MAX 30,000자)까지 찬 글 — 앱 글과 Chrome 모양 웹 글 둘 다 잠기지 않고
// 되돌아온다. 시간은 여기서 재지 않는다(CI 편차) — 2026-09-19 측정: 30KB decompose ≈ 55ms, 60KB 63ms,
// 120KB 103ms, 240KB 215ms(선형). indexOf 로 짝을 찾는 composeInline 도 짝 없는 마커가 많은 글에서 되돌아
// 오는 마커가 바로 옆에 있어 제곱이 되지 않는다.
test("30KB 입력 — 앱 글과 Chrome 모양 웹 글이 잠기지 않고 되돌아온다", () => {
  const unit = "가나다 **굵게** *기울임* __밑줄__ ~~취소~~ [링크](https://example.com/a?b=1) 글자 ";
  const liteLines: string[] = [];
  let size = 0;
  while (size < 30_000) {
    const line = unit.repeat(3);
    liteLines.push(line, "- 항목 **굵은**", "1. 번호", "> 인용 *기울임*", "");
    size += line.length + 40;
  }
  const liteText = liteLines.join("\n");
  const html = composeRichText(liteText, OPTS);
  assert.equal(sanitizeRichText(html, OPTS), html);
  assert.equal(lite(decomposeRichText(html, OPTS)), liteText);

  let chrome = "첫줄";
  while (chrome.length < 30_000) {
    chrome += '<div><span style="font-weight: bold;">굵게</span> 글자<br>줄바꿈</div><div><br></div><div><ul><li>항목</li></ul></div>';
  }
  const sanitized = sanitizeRichText(chrome, OPTS);
  const result = decomposeRichText(sanitized, OPTS);
  const text = lite(result);
  assert.ok(text.startsWith("첫줄\n**굵게** 글자\n줄바꿈\n\n- 항목\n"), text.slice(0, 40));
  assert.equal(sanitizeRichText(composeRichText(text, OPTS), OPTS), composeRichText(text, OPTS));
});
