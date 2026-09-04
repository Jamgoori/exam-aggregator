// 게시판 본문(HTML) 새니타이저 — 허용목록 방식.
//
// 자유게시판은 글꼴·색·정렬·이미지가 들어가는 서식 있는 본문을 받는다. 그 본문은
// 화면에서 dangerouslySetInnerHTML 로 그려지므로, **서버가 저장 직전에 반드시 이
// 함수를 통과시킨 결과만** 저장해야 한다. 클라이언트(에디터)에서도 같은 함수를
// 부르지만 그건 미리보기 편의일 뿐이고, 신뢰 경계는 서버 액션 한 곳이다.
//
// 외부 라이브러리(DOMPurify 등)를 쓰지 않는 이유: 이 패키지는 웹·모바일이 함께
// 쓰는 플랫폼 비의존 코어라 DOM 이 없는 곳에서도 돌아야 하고, 새니타이즈는 저장
// 경로(서버)에서 도는 작업이라 브라우저 DOM 을 전제할 수 없다. 그래서 태그·속성·
// 스타일을 전부 허용목록으로 훑는 작은 파서를 직접 둔다.
//
// 안전성의 근거는 "무엇을 지우는가"가 아니라 "무엇만 남기는가"다:
//   · 허용 태그 목록에 없는 태그는 통째로 버린다(내용은 텍스트로 살린다).
//   · script/style/iframe 처럼 내용 자체가 위험한 태그는 내용까지 버린다.
//   · 속성은 태그별 허용목록에만 있는 것을 남기고, 값도 각각 다시 검사한다
//     (on* 핸들러·javascript: URL 은 목록에 없으므로 애초에 도달하지 않는다).
//   · style 은 속성 이름과 값을 둘 다 허용목록으로 검사한다(url()·expression() 은
//     값 검사에서 떨어진다).
//   · 태그 균형을 스택으로 맞춰, 닫히지 않은 태그가 페이지 레이아웃을 삼키지 못하게 한다.

export const RICH_TEXT_HTML_MAX = 30000;

// 본문에 그대로 남길 태그. 값은 그 태그에서 허용하는 속성 목록이다.
const ALLOWED_TAGS: Record<string, readonly string[]> = {
  p: [],
  br: [],
  div: [],
  span: [],
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  strike: [],
  h2: [],
  h3: [],
  blockquote: [],
  ul: [],
  ol: [],
  li: [],
  pre: [],
  code: [],
  hr: [],
  a: ["href", "target", "rel"],
  img: ["src", "alt"],
};

// 닫는 태그가 없는 태그들. 스택에 쌓지 않는다.
const VOID_TAGS = new Set(["br", "hr", "img"]);

// 태그를 버리는 것으로 끝나지 않고 **안쪽 내용까지** 버려야 하는 태그.
// (<script>alert(1)</script> 의 alert(1) 이 텍스트로 남으면 안 될 이유는 없지만,
//  <style> 안의 CSS 나 <svg> 안의 마크업이 텍스트로 튀어나오면 화면이 깨진다.)
const DROP_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "textarea",
  "title",
  "head",
  "form",
  "select",
  "option",
]);

// style 속성에서 허용하는 CSS 속성과, 그 값의 판정기.
const STYLE_RULES: Record<string, (value: string) => boolean> = {
  color: isColor,
  "background-color": isColor,
  "font-size": isFontSize,
  "font-weight": (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v),
  "font-style": (v) => /^(normal|italic|oblique)$/.test(v),
  "text-align": (v) => /^(left|center|right|justify)$/.test(v),
  "text-decoration": isTextDecoration,
  "text-decoration-line": isTextDecoration,
};

function isColor(value: string): boolean {
  return (
    /^#[0-9a-f]{3}$/i.test(value) ||
    /^#[0-9a-f]{6}$/i.test(value) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(value) ||
    /^[a-z]{3,20}$/i.test(value)
  );
}

function isTextDecoration(value: string): boolean {
  return value
    .split(/\s+/)
    .every((part) => /^(none|underline|line-through|overline)$/.test(part));
}

// 글자 크기는 "본문이 화면을 잡아먹지 않는" 범위로 값 자체를 제한한다. 키워드
// (x-large 등)는 브라우저가 execCommand('fontSize') 로 만들어내는 값이라 같이 받는다.
function isFontSize(value: string): boolean {
  if (/^(x-small|small|medium|large|x-large|xx-large|smaller|larger)$/.test(value)) return true;
  const m = /^(\d{1,3}(?:\.\d+)?)(px|pt|em|rem|%)$/.exec(value);
  if (!m) return false;
  const n = Number(m[1]);
  switch (m[2]) {
    case "px":
      return n >= 8 && n <= 48;
    case "pt":
      return n >= 6 && n <= 36;
    case "em":
    case "rem":
      return n >= 0.5 && n <= 3;
    default:
      return n >= 50 && n <= 300;
  }
}

// <font size="1..7"> 을 span 의 font-size 로 옮길 때 쓰는 표. 브라우저가
// styleWithCSS 를 무시하고 <font> 를 만들어내는 경우(사파리 일부 버전)를 위한 보정이라,
// 값은 브라우저 기본 크기 표와 같게 잡았다.
const FONT_SIZE_ATTR: Record<string, string> = {
  "1": "x-small",
  "2": "small",
  "3": "medium",
  "4": "large",
  "5": "x-large",
  "6": "xx-large",
  "7": "xx-large",
};

export type SanitizeRichTextOptions = {
  // 이미지 src 로 허용할 주소 접두사(스토리지 공개 URL 등). 비어 있으면 이미지를
  // 전부 버린다 — 임의의 외부 주소를 그대로 남기면 본문이 추적 픽셀 자리가 된다.
  imageOrigins?: readonly string[];
};

// 텍스트 노드로 나갈 문자열. 이미 엔티티인 것(&amp; &#39; …)은 그대로 두고,
// 나머지 &·<·> 만 다시 엔티티로 만든다(이중 이스케이프 방지).
function escapeText(text: string): string {
  return text
    .replace(/&(?!#?[a-zA-Z0-9]{1,8};)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    let value = m[2] ?? "";
    if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1);
    attrs.set(name, decodeEntities(value.trim()));
  }
  return attrs;
}

// 속성값 판정 전에 최소한의 엔티티만 되돌린다 — `java&#115;cript:` 같은 우회가
// URL 검사(startsWith("javascript:"))를 그냥 통과하는 것을 막기 위한 것이다.
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => safeFromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => safeFromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function safeFromCharCode(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

// 링크 주소. http(s)·mailto·사이트 내부 경로만 남긴다.
function safeHref(raw: string): string | null {
  const url = stripControlChars(raw).toLowerCase();
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
    return stripControlChars(raw);
  }
  // 내부 경로(/papers/...). "//evil.com" 은 프로토콜 상대 주소라 외부로 나간다.
  if (url.startsWith("/") && !url.startsWith("//")) return stripControlChars(raw);
  return null;
}

// 공백·제어문자를 털어낸 주소. "java\nscript:" 처럼 중간에 개행을 끼워 검사만
// 빠져나가는 고전적인 우회를 막는다.
function stripControlChars(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return String(raw).replace(/[\u0000-\u0020\u007f]/g, "");
}

function safeImageSrc(raw: string, origins: readonly string[]): string | null {
  const url = stripControlChars(raw);
  if (!url) return null;
  if (!origins.some((origin) => origin && url.startsWith(origin))) return null;
  // 따옴표·꺾쇠가 섞인 주소는 속성 경계를 노린 것이라 통째로 버린다.
  return /["'<>]/.test(url) ? null : url;
}

function sanitizeStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of raw.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const name = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().replace(/!important/gi, "").trim();
    if (!value) continue;
    // url(...)·expression(...) 은 값 판정기에서도 떨어지지만, 한 겹 더 명시적으로 막는다.
    if (/[(){}]/.test(value) && !/^rgba?\(/i.test(value)) continue;
    const rule = STYLE_RULES[name];
    if (rule && rule(value)) out.push(`${name}: ${value}`);
  }
  return out.join("; ");
}

// 서식 있는 본문을 허용목록으로 통과시킨다. 저장 전 서버에서 반드시 호출한다.
export function sanitizeRichText(
  html: string,
  options: SanitizeRichTextOptions = {},
): string {
  const source = String(html ?? "");
  const imageOrigins = options.imageOrigins ?? [];
  const out: string[] = [];
  const stack: string[] = [];

  // 내용까지 버려야 하는 태그(script 등) 안에 있는 동안 켜지는 표시. 중첩을 세어
  // 안쪽에서 같은 태그가 또 열려도 균형이 맞게 한다.
  let dropDepth = 0;
  let dropTag = "";

  const tokenRe = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<!--?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>?/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(source)) !== null) {
    const text = source.slice(last, match.index);
    if (text && dropDepth === 0) out.push(escapeText(text));
    last = tokenRe.lastIndex;

    const tagName = match[1]?.toLowerCase();
    // 주석·DOCTYPE 등 태그가 아닌 토큰은 통째로 버린다.
    if (!tagName) continue;

    const isClosing = match[0].startsWith("</");

    if (dropDepth > 0) {
      if (tagName === dropTag) dropDepth += isClosing ? -1 : 1;
      continue;
    }

    if (DROP_CONTENT_TAGS.has(tagName)) {
      if (!isClosing && !match[0].endsWith("/>")) {
        dropDepth = 1;
        dropTag = tagName;
      }
      continue;
    }

    if (isClosing) {
      const idx = stack.lastIndexOf(tagName);
      // 열린 적 없는 닫는 태그는 무시한다(그대로 내보내면 바깥 태그가 닫힌다).
      if (idx < 0) continue;
      for (let i = stack.length - 1; i >= idx; i--) out.push(`</${stack[i]}>`);
      stack.length = idx;
      continue;
    }

    const attrs = parseAttrs(match[2] ?? "");

    // <font> 는 태그로는 남기지 않고 span 의 style 로 옮긴다 — 브라우저가
    // execCommand 로 만들어내는 잔재라 버리면 사용자가 고른 크기·색이 사라진다.
    if (tagName === "font") {
      const styles: string[] = [];
      const color = attrs.get("color");
      if (color && isColor(color)) styles.push(`color: ${color}`);
      const size = attrs.get("size");
      if (size && FONT_SIZE_ATTR[size]) styles.push(`font-size: ${FONT_SIZE_ATTR[size]}`);
      const inline = attrs.get("style");
      if (inline) {
        const cleaned = sanitizeStyle(inline);
        if (cleaned) styles.push(cleaned);
      }
      stack.push("span");
      out.push(styles.length ? `<span style="${escapeAttr(styles.join("; "))}">` : "<span>");
      continue;
    }

    const allowedAttrs = ALLOWED_TAGS[tagName];
    // 허용 목록에 없는 태그: 태그만 버리고 안쪽 내용은 그대로 살린다.
    if (!allowedAttrs) continue;

    const parts: string[] = [];

    if (tagName === "a") {
      const href = attrs.get("href");
      const safe = href ? safeHref(href) : null;
      if (safe) parts.push(`href="${escapeAttr(safe)}"`);
      // 외부로 나가는 링크는 새 탭 + noopener 로 고정한다(원문에 뭐가 적혀 있든).
      if (safe && !safe.startsWith("/")) {
        parts.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
      }
    } else if (tagName === "img") {
      const src = attrs.get("src");
      const safe = src ? safeImageSrc(src, imageOrigins) : null;
      // 주소가 허용 범위 밖이면 이미지 자체를 버린다.
      if (!safe) continue;
      parts.push(`src="${escapeAttr(safe)}"`);
      const alt = attrs.get("alt");
      if (alt) parts.push(`alt="${escapeAttr(alt.slice(0, 100))}"`);
    }

    const style = attrs.get("style");
    if (style) {
      const cleaned = sanitizeStyle(style);
      if (cleaned) parts.push(`style="${escapeAttr(cleaned)}"`);
    }

    const open = parts.length ? `<${tagName} ${parts.join(" ")}>` : `<${tagName}>`;
    if (VOID_TAGS.has(tagName)) {
      out.push(open);
    } else {
      stack.push(tagName);
      out.push(open);
    }
  }

  const tail = source.slice(last);
  if (tail && dropDepth === 0) out.push(escapeText(tail));

  // 닫히지 않은 채 끝난 태그를 여기서 전부 닫는다.
  for (let i = stack.length - 1; i >= 0; i--) out.push(`</${stack[i]}>`);

  return out.join("");
}

// 서식을 걷어낸 평문. 목록의 미리보기·검색·비속어 검사에 쓴다(비속어를 HTML 그대로
// 검사하면 태그 사이에 글자를 끼워 넣는 것만으로 그냥 빠져나간다).
export function richTextToPlain(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h2|h3|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 목록 카드에 쓸 썸네일 = 본문의 첫 이미지. 없으면 null.
export function firstImageSrc(html: string): string | null {
  const m = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(String(html ?? ""));
  return m ? m[1] : null;
}

// 본문에 실제로 볼 것이 있는가. 빈 <p><br></p> 만 남은 본문은 "내용 없음"이다.
export function hasRichTextBody(html: string): boolean {
  return richTextToPlain(html).length > 0 || /<img\b/i.test(String(html ?? ""));
}
