// 앱 글쓰기용 가벼운 마크업("lite") ↔ 게시판 HTML 변환(순수).
//
// 웹 글쓰기는 contenteditable 리치 에디터(components/rich-text-editor.tsx)지만 RN 에는 그것이
// 없고, WebView·리치 에디터 라이브러리는 새 네이티브 의존이라 OTA 를 깬다(설계서 §12-8 과 같은
// 판단 — 새 의존은 APK 재빌드를 강제한다). 그래서 앱 에디터는 **다중행 TextInput 하나 + 마크다운
// 부분집합**으로 가고(설계서 #31 축소판: 굵게/기울임/밑줄/취소선/목록/인용/링크/이미지), 이 파일이
// 그 마크업과 저장 HTML 사이를 오간다. 서버(board-write EF · 웹 서버 액션)는 여기서 나온 HTML 을
// 다른 입력과 똑같이 sanitizeRichText → validateBoardPostInput 으로 다시 검사한다 — 이 파일은
// 신뢰 경계가 아니라 편의다.
//
// ── 마크업(마커 ↔ HTML) ────────────────────────────────────────────────────────
//   줄 단위(블록)                         인라인
//   빈 줄            → <p><br></p>          **글**  → <strong>글</strong>
//   그 외 줄         → <p>…</p>             *글*    → <em>글</em>
//   "- 글"  연속     → <ul><li>…</li></ul>   __글__  → <u>글</u>
//   "1. 글" 연속     → <ol><li>…</li></ol>   ~~글~~  → <s>글</s>
//   "> 글"  연속     → <blockquote><p>…</p>…</blockquote>
//   "![설명](https://…)" 한 줄 전체 → <img src alt>   [글](https://…) → <a href target rel>글</a>
//   HTML 특수문자(& < >)는 이스케이프. 링크·이미지 주소는 http(s) 만, 공백·따옴표·꺾쇠·괄호 없음.
//
// ── 보증 ─────────────────────────────────────────────────────────────────────
//   (1) composeRichText 의 결과는 sanitizeRichText(같은 imageOrigins)를 다시 통과해도 **같은
//       문자열**이다. 링크·이미지 요소는 새니타이저에 한 번 통과시켜 살아남는 것만 요소로 내보내고
//       (아니면 글자 그대로), 텍스트 이스케이프는 새니타이저가 다시 손대지 않는 모양(&amp; &lt; &gt;)이다.
//   (2) decomposeRichText 가 { lite } 를 돌려주면 composeRichText(lite) 는 원본과 **같은 DOM 트리**
//       다(엔티티 표기·b/strong 같은 별칭·a 의 target/rel 은 정규화해 비교). 되돌린 뒤 다시 조합해
//       트리를 대조하는 것이 마지막 관문이라, 마커 문자와 충돌하는 본문("a**b" 를 굵게 한 것 등)은
//       여기서 걸려 unsupported 로 떨어진다 — 조용히 서식을 잃는 일은 없다.
//   (3) 왕복 compose→decompose 는 lite 원문을 그대로 돌려준다. 정규화되는 것은 `\r\n`→`\n`,
//       번호 목록의 번호(1부터 다시 셈), 서식 요소 안팎의 공백(`** 글**` 은 마커 밖으로 나온다) 뿐이다.
//       (웹 글을 되돌릴 때는 &nbsp; 같은 엔티티가 글자로 풀리고 b/i/strike 가 strong/em/s 로 저장된다.
//       공백·&nbsp;·<br> 만 든 문단(<p>&nbsp;</p> — 웹 에디터가 빈 줄에 자주 남긴다)은 빈 줄로 본다.)
//
// ── 한계(문서화) ─────────────────────────────────────────────────────────────
//   · 마커를 글자로 쓸 방법(이스케이프)이 없다. 짝이 맞지 않는 마커는 글자 그대로 남는다.
//   · 같은 마커의 중첩("**a **b** c**")은 안 된다(첫 닫힘에서 끝난다). 다른 마커 중첩은 된다.
//   · 마커 안쪽은 공백으로 시작·끝나면 안 된다(`2 * 3 * 4` 가 기울임이 되지 않게).
//   · 줄 머리 "- ", "1. ", "> " 는 항상 블록이다(그 글자로 시작하는 문단은 쓸 수 없다).
//   · 주소에 괄호·공백이 든 링크는 쓸 수 없다(위키 주소 등).
//   · 웹 에디터만 만들 수 있는 것(h2·h3·div·span·pre·code·hr·br 단독·중첩 목록·style·mailto·내부
//     경로 링크)은 되돌리지 않고 unsupported 로 이름을 돌려준다.

import { parseRichText, sanitizeRichText, type RichNode, type RichTextTag } from "./rich-text";

export type RichTextLiteOptions = {
  // 이미지 src 로 허용할 주소 접두사(board-image.ts#boardImageOrigin). sanitizeRichText 와 같은 뜻.
  // 비어 있으면 이미지는 요소가 되지 못하고 글자로 남는다.
  imageOrigins?: readonly string[];
};

// 인라인 마커. 에디터 툴바가 선택 영역을 감쌀 때 이 값을 쓴다(값을 두 곳에 적지 않게).
export const RICH_TEXT_LITE_MARKS = {
  bold: "**",
  italic: "*",
  underline: "__",
  strike: "~~",
} as const;
export type RichTextLiteMark = keyof typeof RICH_TEXT_LITE_MARKS;

// 줄 머리 접두. 툴바의 목록·인용 토글이 쓴다. 번호 목록은 "1. " 모양이면 어떤 숫자든 받는다.
export const RICH_TEXT_LITE_PREFIX = {
  bullet: "- ",
  ordered: "1. ",
  quote: "> ",
} as const;
export type RichTextLinePrefix = keyof typeof RICH_TEXT_LITE_PREFIX;

const ORDERED_RE = /^\d+\. /;
const QUOTE_RE = /^>( |$)/;
// 한 줄 전체가 이미지일 때만 이미지다(글 사이에 낀 `![..](..)` 는 글자 그대로).
const IMAGE_LINE_RE = /^!\[([^\][]*)\]\(([^\s()]+)\)$/;
const LINK_RE = /^\[([^\][]+)\]\(([^\s()]+)\)/;
const IMAGE_INLINE_RE = /^!\[([^\][]*)\]\(([^\s()]+)\)/;

// 링크·이미지 주소. http(s) 이고 공백·제어문자·따옴표·꺾쇠·괄호가 없어야 한다 — 새니타이저의
// stripControlChars 가 지우는 글자가 들어 있으면 "조합한 것과 새니타이즈한 것이 다른" 문자열이 된다.
// eslint-disable-next-line no-control-regex
const LITE_URL_RE = /^https?:\/\/[^\s"'<>()\u0000-\u0020\u007f]+$/i;

export function isRichTextLiteUrl(url: string): boolean {
  return LITE_URL_RE.test(String(url ?? ""));
}

// 텍스트 이스케이프. 새니타이저의 escapeText 는 이미 엔티티 모양인 &(예: &amp;)를 건너뛰지만 여기서는
// **모든** & 를 &amp; 로 바꾼다 — 사용자가 "&amp;" 라고 친 글자는 화면에도 "&amp;" 로 보여야 하고
// (파서가 되돌리면 그대로 나온다), &amp;amp; 는 새니타이저가 다시 손대지 않는 모양이라 (1)도 성립한다.
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

// 요소 하나를 새니타이저에 통과시켜 그대로 살아남는지 본다. 링크는 safeHref, 이미지는
// safeImageSrc(접두사·경로 조각·쿼리 검사)의 판정을 여기서 되풀이하지 않고 **그 함수에 묻는다** —
// 규칙이 한 곳에 있어야 새니타이저가 바뀌어도 이 파일이 낡지 않는다.
function survivesSanitizer(html: string, options: RichTextLiteOptions): boolean {
  return sanitizeRichText(html, { imageOrigins: options.imageOrigins ?? [] }) === html;
}

const MARK_TAGS: ReadonlyArray<readonly [marker: string, tag: string]> = [
  ["**", "strong"],
  ["__", "u"],
  ["~~", "s"],
  ["*", "em"],
];

// 마커 안쪽으로 허용하는 내용: 비어 있지 않고 공백으로 시작·끝나지 않는다.
function isMarkContent(content: string): boolean {
  return content.length > 0 && !/^\s/.test(content) && !/\s$/.test(content);
}

// 한 줄(블록 안 내용)의 인라인 마크업 → HTML.
function composeInline(text: string, options: RichTextLiteOptions): string {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(escapeText(buf));
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // 글 사이에 낀 이미지 표기 `![..](..)` 는 링크로 오해하지 않고 통째로 글자다(한 줄 전체일 때만
    // 이미지 — composeRichText). "!" 를 떼고 링크로 만들면 사용자가 뜻하지 않은 것이 된다.
    if (ch === "!" && text[i + 1] === "[") {
      const m = IMAGE_INLINE_RE.exec(text.slice(i));
      if (m) {
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }

    if (ch === "[") {
      const m = LINK_RE.exec(text.slice(i));
      if (m && isRichTextLiteUrl(m[2])) {
        // 새니타이저는 외부 링크에 target/rel 을 **붙인다**(rich-text.ts). 같은 모양으로 내보내야
        // 다시 통과시켜도 같은 문자열이다.
        const inner = composeInline(m[1], options);
        const html = `<a href="${escapeAttr(m[2])}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
        if (survivesSanitizer(html, options)) {
          flush();
          out.push(html);
          i += m[0].length;
          continue;
        }
      }
    }

    let matched = false;
    for (const [marker, tag] of MARK_TAGS) {
      if (!text.startsWith(marker, i)) continue;
      const close = text.indexOf(marker, i + marker.length);
      if (close < 0) continue;
      const content = text.slice(i + marker.length, close);
      if (!isMarkContent(content)) continue;
      flush();
      out.push(`<${tag}>${composeInline(content, options)}</${tag}>`);
      i = close + marker.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buf += ch;
    i += 1;
  }
  flush();
  return out.join("");
}

function composeParagraph(line: string, options: RichTextLiteOptions): string {
  return line === "" ? "<p><br></p>" : `<p>${composeInline(line, options)}</p>`;
}

// 이미지 한 줄. 새니타이저가 살리지 못하는 주소(허용 접두사 밖 등)면 글자 그대로 문단이 된다 —
// 조용히 사라지는 것보다 사용자가 친 그대로 보이는 쪽이 낫다.
function composeImageLine(alt: string, src: string, options: RichTextLiteOptions): string | null {
  if (!isRichTextLiteUrl(src)) return null;
  const altAttr = alt ? ` alt="${escapeAttr(alt.slice(0, 100))}"` : "";
  const html = `<img src="${escapeAttr(src)}"${altAttr}>`;
  return survivesSanitizer(html, options) ? html : null;
}

// lite 마크업 → 게시판 HTML. 던지지 않는다.
export function composeRichText(lite: string, options: RichTextLiteOptions = {}): string {
  const lines = String(lite ?? "").replace(/\r\n?/g, "\n").split("\n");
  // 빈 입력은 빈 본문이다(문단 하나가 아니라) — validateBoardPostInput 이 "내용을 입력해주세요" 를 낸다.
  if (lines.length === 1 && lines[0] === "") return "";

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith(RICH_TEXT_LITE_PREFIX.bullet)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith(RICH_TEXT_LITE_PREFIX.bullet)) {
        items.push(`<li>${composeInline(lines[i].slice(2), options)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(`<li>${composeInline(lines[i].replace(ORDERED_RE, ""), options)}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        items.push(composeParagraph(lines[i].replace(QUOTE_RE, ""), options));
        i += 1;
      }
      out.push(`<blockquote>${items.join("")}</blockquote>`);
      continue;
    }

    const image = IMAGE_LINE_RE.exec(line);
    if (image) {
      const html = composeImageLine(image[1], image[2], options);
      if (html) {
        out.push(html);
        i += 1;
        continue;
      }
    }

    out.push(composeParagraph(line, options));
    i += 1;
  }
  return out.join("");
}

// ───────────────────────── HTML → lite ─────────────────────────

export type DecomposeRichTextResult = { lite: string } | { unsupported: string[] };

type ElementNode = Extract<RichNode, { type: "element" }>;

// unsupported 에 태그 이름 대신 들어가는 세 가지.
//   style      — style 속성이 있는 요소(색·크기·정렬은 lite 에 없다)
//   #text      — 블록 밖(루트·목록 사이)에 놓인 글자
//   #roundtrip — 되돌린 lite 를 다시 조합했을 때 같은 트리가 나오지 않음(마커 문자 충돌 등)
export const RICH_TEXT_LITE_UNSUPPORTED_STYLE = "style";
export const RICH_TEXT_LITE_UNSUPPORTED_TEXT = "#text";
export const RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP = "#roundtrip";

class Unsupported {
  readonly names = new Set<string>();
  add(name: string) {
    this.names.add(name);
  }
  get empty() {
    return this.names.size === 0;
  }
}

const TAG_ALIAS: Partial<Record<RichTextTag, RichTextTag>> = { b: "strong", i: "em", strike: "s" };
const INLINE_MARK_BY_TAG: Partial<Record<RichTextTag, string>> = {
  strong: RICH_TEXT_LITE_MARKS.bold,
  em: RICH_TEXT_LITE_MARKS.italic,
  u: RICH_TEXT_LITE_MARKS.underline,
  s: RICH_TEXT_LITE_MARKS.strike,
};

function canonTag(tag: RichTextTag): RichTextTag {
  return TAG_ALIAS[tag] ?? tag;
}

function isWhitespaceText(node: RichNode): boolean {
  return node.type === "text" && node.text.trim() === "";
}

function isBr(node: RichNode): node is ElementNode {
  return node.type === "element" && node.tag === "br";
}

// 요소가 lite 로 갈 수 있는지 먼저 본다 — style 은 어떤 태그에서도 안 된다.
function checkAttrs(node: ElementNode, bad: Unsupported) {
  if (node.attrs.style !== undefined) bad.add(RICH_TEXT_LITE_UNSUPPORTED_STYLE);
}

function decomposeInline(nodes: readonly RichNode[], bad: Unsupported): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.text;
      continue;
    }
    checkAttrs(node, bad);
    const tag = canonTag(node.tag);
    const mark = INLINE_MARK_BY_TAG[tag];
    if (mark) {
      const inner = decomposeInline(node.children, bad);
      // 비어 있는 서식(<strong></strong>)은 화면에 아무것도 아니다 — 버린다(정규화에서도 버린다).
      if (inner === "") continue;
      // 마커 안쪽은 공백으로 시작·끝날 수 없으니 공백을 밖으로 낸다(정규화에서 같은 이동을 한다).
      const lead = /^\s*/.exec(inner)?.[0] ?? "";
      const trail = /\s*$/.exec(inner)?.[0] ?? "";
      const core = inner.slice(lead.length, inner.length - trail.length);
      out += core === "" ? inner : `${lead}${mark}${core}${mark}${trail}`;
      continue;
    }
    if (tag === "a") {
      const href = node.attrs.href ?? "";
      const inner = decomposeInline(node.children, bad);
      if (!isRichTextLiteUrl(href) || inner === "" || /[\][]/.test(inner)) {
        bad.add("a");
        continue;
      }
      out += `[${inner}](${href})`;
      continue;
    }
    // br·img·span·code 처럼 인라인 자리에서 lite 가 표현하지 못하는 것.
    bad.add(tag);
  }
  return out;
}

// 블록(p·li·blockquote 의 줄) 내용. 블록 안에 블록이 또 있으면 그 태그를 unsupported 로.
function decomposeLineContent(nodes: readonly RichNode[], bad: Unsupported): string {
  for (const node of nodes) {
    if (node.type === "element" && BLOCK_TAGS.has(canonTag(node.tag))) bad.add(canonTag(node.tag));
  }
  return decomposeInline(nodes, bad);
}

const BLOCK_TAGS = new Set<RichTextTag>(["p", "div", "h2", "h3", "blockquote", "ul", "ol", "li", "pre", "hr", "img"]);

function onlyChildren(node: ElementNode): RichNode[] {
  return node.children.filter((c) => !isWhitespaceText(c));
}

function decomposeParagraph(node: ElementNode, bad: Unsupported): string {
  checkAttrs(node, bad);
  const kids = onlyChildren(node);
  if (kids.length === 0) return "";
  if (kids.length === 1 && isBr(kids[0])) return "";
  if (kids.length === 1 && kids[0].type === "element" && kids[0].tag === "img") {
    return decomposeImage(kids[0], bad);
  }
  return decomposeLineContent(node.children, bad);
}

function decomposeImage(node: ElementNode, bad: Unsupported): string {
  checkAttrs(node, bad);
  const src = node.attrs.src ?? "";
  const alt = node.attrs.alt ?? "";
  if (!isRichTextLiteUrl(src) || /[\][]/.test(alt)) {
    bad.add("img");
    return "";
  }
  return `![${alt}](${src})`;
}

function decomposeListItem(node: ElementNode, bad: Unsupported): string {
  checkAttrs(node, bad);
  const kids = onlyChildren(node);
  // <li><p>글</p></li> 은 <li>글</li> 과 같게 본다(정규화에서 p 를 벗긴다).
  if (kids.length === 1 && kids[0].type === "element" && kids[0].tag === "p") {
    return decomposeParagraph(kids[0], bad);
  }
  return decomposeLineContent(node.children, bad);
}

function decomposeBlock(node: ElementNode, bad: Unsupported, lines: string[]) {
  const tag = canonTag(node.tag);
  switch (tag) {
    case "p":
      lines.push(decomposeParagraph(node, bad));
      return;
    case "img":
      lines.push(decomposeImage(node, bad));
      return;
    case "ul":
    case "ol": {
      checkAttrs(node, bad);
      let n = 0;
      for (const child of node.children) {
        if (isWhitespaceText(child)) continue;
        if (child.type !== "element" || child.tag !== "li") {
          bad.add(child.type === "element" ? canonTag(child.tag) : RICH_TEXT_LITE_UNSUPPORTED_TEXT);
          continue;
        }
        n += 1;
        const prefix = tag === "ul" ? RICH_TEXT_LITE_PREFIX.bullet : `${n}. `;
        lines.push(prefix + decomposeListItem(child, bad));
      }
      return;
    }
    case "blockquote": {
      checkAttrs(node, bad);
      const kids = onlyChildren(node);
      const allParagraphs = kids.length > 0 && kids.every((k) => k.type === "element" && k.tag === "p");
      if (allParagraphs) {
        for (const k of kids) lines.push(RICH_TEXT_LITE_PREFIX.quote + decomposeParagraph(k as ElementNode, bad));
        return;
      }
      // 웹 에디터의 formatBlock 은 <blockquote>글</blockquote> 처럼 p 없이 만든다 — 한 줄로 본다.
      lines.push(RICH_TEXT_LITE_PREFIX.quote + decomposeLineContent(node.children, bad));
      return;
    }
    default:
      // h2·h3·div·pre·hr·li(홀로) 와 루트에 놓인 인라인 요소.
      bad.add(tag);
  }
}

// 게시판 HTML → lite. compose 가 만드는 부분집합(과 그것과 같은 DOM 을 이루는 변형)만 되돌린다.
export function decomposeRichText(html: string, options: RichTextLiteOptions = {}): DecomposeRichTextResult {
  const nodes = parseRichText(String(html ?? ""));
  const bad = new Unsupported();
  const lines: string[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      if (!isWhitespaceText(node)) bad.add(RICH_TEXT_LITE_UNSUPPORTED_TEXT);
      continue;
    }
    decomposeBlock(node, bad, lines);
  }
  if (!bad.empty) return { unsupported: [...bad.names] };

  const lite = lines.join("\n");
  // 마지막 관문: 되돌린 것을 다시 조합해 같은 트리가 나오는지. 여기서 틀어지면 저장 시 서식이
  // 바뀌는 글이므로 잠근다(머리말 (2)).
  if (canonicalHtml(composeRichText(lite, options)) !== canonicalHtml(html)) {
    return { unsupported: [RICH_TEXT_LITE_UNSUPPORTED_ROUNDTRIP] };
  }
  return { lite };
}

// ───────────────────────── 트리 정규화(대조용) ─────────────────────────
//
// decompose 가 같게 보는 변형을 한 모양으로 접어 문자열로 만든다. 여기서 접는 것은 전부
// decompose 도 같게 되돌리는 것들이다(별칭 태그, 블록 사이 공백, li>p, blockquote 의 p 없는 내용,
// p>img, 빈 p, 공백·&nbsp;·br 만 든 p, 빈 서식 요소, 서식 안팎 공백, a 의 target/rel).
//
// **decomposeParagraph 가 "빈 줄"로 보는 것과 여기서 <p><br></p> 로 접는 것은 같은 집합이어야 한다.**
// 한쪽만 넓히면 멀쩡한 글이 #roundtrip 으로 잠기거나(정규화가 좁을 때), 서식이 조용히 바뀐 글이
// 통과한다(정규화가 넓을 때).

function canonicalHtml(html: string): string {
  return serialize(canonBlocks(parseRichText(html)));
}

function canonBlocks(nodes: readonly RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (!isWhitespaceText(node)) out.push(node);
      continue;
    }
    const tag = canonTag(node.tag);
    if (tag === "p") {
      const kids = onlyChildren(node);
      if (kids.length === 1 && kids[0].type === "element" && kids[0].tag === "img") {
        out.push(canonElement(kids[0], []));
        continue;
      }
      const body = canonParagraphBody(node);
      out.push(canonElement(node, body ?? [{ type: "element", tag: "br", attrs: {}, children: [] }]));
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items: RichNode[] = [];
      for (const child of node.children) {
        if (isWhitespaceText(child)) continue;
        if (child.type === "element" && child.tag === "li") {
          const kids = onlyChildren(child);
          // li>p 는 p 를 벗긴 것과 같다(decomposeListItem). 그 p 가 빈 줄이면 compose 는 <li></li> 를 만든다.
          const body =
            kids.length === 1 && kids[0].type === "element" && kids[0].tag === "p"
              ? (canonParagraphBody(kids[0]) ?? [])
              : canonInline(child.children);
          items.push(canonElement(child, body));
        } else {
          items.push(child);
        }
      }
      out.push(canonElement(node, items));
      continue;
    }
    if (tag === "blockquote") {
      const kids = onlyChildren(node);
      const allParagraphs = kids.length > 0 && kids.every((k) => k.type === "element" && k.tag === "p");
      const body = allParagraphs
        ? canonBlocks(kids)
        : [{ type: "element", tag: "p", attrs: {}, children: canonInline(node.children) } satisfies RichNode];
      out.push(canonElement(node, body));
      continue;
    }
    out.push(canonElement(node, canonBlocks(node.children)));
  }
  return out;
}

// 문단의 인라인 내용. decomposeParagraph 가 빈 줄로 되돌리는 문단(자식 없음 · <br> 하나 · 공백·&nbsp; 만)
// 이면 null 을 돌려준다 — 부르는 쪽이 그 자리에 맞는 "빈 줄" 모양(p 는 <br>, li 는 없음)을 넣는다.
function canonParagraphBody(node: ElementNode): RichNode[] | null {
  const kids = onlyChildren(node);
  if (kids.length === 0) return null;
  if (kids.length === 1 && isBr(kids[0])) return null;
  return canonInline(node.children);
}

function canonInline(nodes: readonly RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  for (const node of nodes) {
    if (node.type === "text") {
      pushText(node.text);
      continue;
    }
    const tag = canonTag(node.tag);
    if (INLINE_MARK_BY_TAG[tag]) {
      const kids = canonInline(node.children);
      if (kids.length === 0) continue;
      // 서식 요소 앞뒤 공백을 밖으로(decomposeInline 과 같은 이동).
      const first = kids[0];
      if (first.type === "text") {
        const lead = /^\s*/.exec(first.text)?.[0] ?? "";
        if (lead) {
          pushText(lead);
          first.text = first.text.slice(lead.length);
        }
      }
      const lastKid = kids[kids.length - 1];
      let trail = "";
      if (lastKid.type === "text") {
        trail = /\s*$/.exec(lastKid.text)?.[0] ?? "";
        if (trail) lastKid.text = lastKid.text.slice(0, lastKid.text.length - trail.length);
      }
      const body = kids.filter((k) => !(k.type === "text" && k.text === ""));
      if (body.length > 0) out.push(canonElement(node, body));
      pushText(trail);
      continue;
    }
    out.push(canonElement(node, canonInline(node.children)));
  }
  return out;
}

function canonElement(node: ElementNode, children: RichNode[]): ElementNode {
  const tag = canonTag(node.tag);
  const attrs: Record<string, string> = {};
  if (tag === "a" && node.attrs.href !== undefined) attrs.href = node.attrs.href;
  if (tag === "img") {
    if (node.attrs.src !== undefined) attrs.src = node.attrs.src;
    if (node.attrs.alt) attrs.alt = node.attrs.alt;
  }
  if (node.attrs.style !== undefined) attrs.style = node.attrs.style;
  return { type: "element", tag, attrs, children };
}

function serialize(nodes: readonly RichNode[]): string {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(escapeText(node.text));
      continue;
    }
    const attrs = Object.keys(node.attrs)
      .sort()
      .map((k) => ` ${k}="${escapeAttr(node.attrs[k])}"`)
      .join("");
    if (node.tag === "br" || node.tag === "hr" || node.tag === "img") {
      out.push(`<${node.tag}${attrs}>`);
      continue;
    }
    out.push(`<${node.tag}${attrs}>`, serialize(node.children), `</${node.tag}>`);
  }
  return out.join("");
}
