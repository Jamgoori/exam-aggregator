import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeEditorText, wrapRootInlineRuns, type EditorRootNode } from "./rich-text-editor";

// 브라우저별 실제 출력을 루트 자식 목록으로 적은 픽스처. tag 가 null 이면 텍스트 노드.
const t = (html: string): EditorRootNode => ({ tag: null, html });
const el = (tag: string, html: string): EditorRootNode => ({ tag, html });

test("Chrome — 첫 줄 루트 텍스트 + p 문단(defaultParagraphSeparator=p)은 첫 줄만 감싼다", () => {
  assert.equal(
    wrapRootInlineRuns([t("첫줄"), el("p", "<p>둘째</p>"), el("p", "<p><br></p>"), el("p", "<p>셋째</p>")]),
    "<p>첫줄</p><p>둘째</p><p><br></p><p>셋째</p>",
  );
  // 지원하지 않는 브라우저(div 문단)도 첫 줄만 감싸고 div 는 그대로 — core 정규화가 div 를 받아준다.
  assert.equal(wrapRootInlineRuns([t("첫줄"), el("div", "<div>둘째</div>")]), "<p>첫줄</p><div>둘째</div>");
});

test("첫 줄의 서식 요소·링크도 한 문단으로 감싼다", () => {
  assert.equal(
    wrapRootInlineRuns([el("b", "<b>굵게</b>"), t(" 글 "), el("a", '<a href="https://e.com">링크</a>')]),
    '<p><b>굵게</b> 글 <a href="https://e.com">링크</a></p>',
  );
});

test("Firefox 옛 br 모드 — 루트 br 은 문단 경계, 블록 끝 br 하나는 줄이 아니다", () => {
  assert.equal(wrapRootInlineRuns([t("첫줄"), el("br", "<br>"), t("둘째")]), "<p>첫줄</p><p>둘째</p>");
  assert.equal(wrapRootInlineRuns([t("첫줄"), el("br", "<br>"), el("br", "<br>"), t("셋째")]), "<p>첫줄</p><p><br></p><p>셋째</p>");
  assert.equal(wrapRootInlineRuns([t("첫줄"), el("br", "<br>")]), "<p>첫줄</p>");
  // Chrome 이 내용을 전부 지운 뒤 남기는 <br> 하나 — 빈 줄 하나(core 정규화와 같은 판단). 서버 검증은
  // hasRichTextBody 로 빈 본문을 거른다.
  assert.equal(wrapRootInlineRuns([el("br", "<br>")]), "<p><br></p>");
});

test("Safari — 첫 줄부터 div 면 감쌀 것이 없다", () => {
  assert.equal(wrapRootInlineRuns([el("div", "<div>첫줄</div>"), el("div", "<div>둘째</div>")]), "<div>첫줄</div><div>둘째</div>");
});

test("이미지·구분선 뒤에 에디터가 붙인 문단은 그대로, 앞의 루트 텍스트만 감싼다", () => {
  assert.equal(
    wrapRootInlineRuns([t("사진"), el("img", '<img src="https://e.com/a.webp" alt="">'), el("p", "<p><br></p>")]),
    '<p>사진</p><img src="https://e.com/a.webp" alt=""><p><br></p>',
  );
  assert.equal(wrapRootInlineRuns([el("hr", "<hr>"), el("p", "<p><br></p>")]), "<hr><p><br></p>");
});

test("블록 사이의 공백만 든 텍스트는 버리고, 비어 있으면 빈 문자열", () => {
  assert.equal(wrapRootInlineRuns([el("p", "<p>a</p>"), t("\n  "), el("ul", "<ul><li>b</li></ul>"), t(" ")]), "<p>a</p><ul><li>b</li></ul>");
  assert.equal(wrapRootInlineRuns([t("&nbsp;")]), "");
  assert.equal(wrapRootInlineRuns([]), "");
  // 빈 서식 요소는 그대로 둔다(새니타이저·core 가 버린다) — 여기서 판단하지 않는다.
  assert.equal(wrapRootInlineRuns([el("b", "<b></b>")]), "<p><b></b></p>");
});

test("escapeEditorText — innerHTML 의 텍스트 직렬화와 같은 네 글자만", () => {
  assert.equal(escapeEditorText('a < b & c > d "q"  x'), "a &lt; b &amp; c &gt; d \"q\" &nbsp;x");
});
