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
// 키 목록은 RICH_TEXT_TAGS 로 export 한다 — 앱 렌더러(RichTextContent)가 이 목록을 읽어
// 태그별로 Text/View 를 고르므로, 여기에 태그를 더하면 렌더러도 같은 커밋에서 그 태그를
// 그릴 줄 알아야 한다(모르는 태그는 렌더러가 내용만 살린다).
const ALLOWED_TAGS = {
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
} as const satisfies Record<string, readonly string[]>;

// 새니타이저가 남기는 태그 22종. 순서는 ALLOWED_TAGS 선언 순서다.
export const RICH_TEXT_TAGS = Object.keys(ALLOWED_TAGS) as readonly RichTextTag[];
export type RichTextTag = keyof typeof ALLOWED_TAGS;

function allowedAttrsOf(tag: string): readonly string[] | undefined {
  return (ALLOWED_TAGS as Record<string, readonly string[]>)[tag];
}

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
  const origin = origins.find((o) => o && url.startsWith(o));
  if (!origin) return null;
  // 따옴표·꺾쇠가 섞인 주소는 속성 경계를 노린 것이라 통째로 버린다.
  if (/["'<>]/.test(url)) return null;

  // 접두사 검사만으로는 부족하다 — "…/board-images/../../다른경로" 는 접두사가 맞지만
  // 브라우저가 ../ 를 접어 올려 같은 호스트의 **다른** 주소로 요청을 보낸다.
  // 쿼리(?)·해시(#)·역슬래시(특수 스킴에서 / 로 취급)도 같은 이유로 막고, 경로
  // 조각이 . / .. (퍼센트 인코딩 %2e 포함 — URL 표준이 점 조각으로 취급한다)이면 버린다.
  const rest = url.slice(origin.length);
  if (!rest || /[?#\\]/.test(rest)) return null;
  const isDotSegment = (segment: string) => {
    const normalized = segment.replace(/%2e/gi, ".");
    return normalized === "." || normalized === "..";
  };
  if (rest.split("/").some(isDotSegment)) return null;
  return url;
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

// 태그·주석·CDATA 를 한 토큰씩 끊는 정규식. 새니타이저와 파서(parseRichText)가 같은 것을
// 쓴다 — 둘이 다른 식으로 자르면 "새니타이저는 태그로 봤는데 파서는 텍스트로 보는" 틈이 생긴다.
// `g` 플래그 정규식은 lastIndex 를 들고 있어 호출마다 새로 만든다(모듈 상수로 공유하면
// 예외로 중단된 호출이 다음 호출의 시작 위치를 오염시킨다).
const TOKEN_RE_SOURCE =
  `<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<!--?[^>]*>|<\\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>?`;

function createTokenRe(): RegExp {
  return new RegExp(TOKEN_RE_SOURCE, "g");
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

  const tokenRe = createTokenRe();
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

    const allowedAttrs = allowedAttrsOf(tagName);
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

// ───────────────────────── 파서(앱 렌더러용) ─────────────────────────
//
// 앱(React Native)에는 DOM 이 없어 HTML 을 그대로 그릴 수 없다. 그래서 새니타이즈된 본문을
// 노드 트리로 풀어 주면 앱 RichTextContent 가 태그별로 Text/View 를 고른다. 웹은 이 함수를
// 쓰지 않는다(브라우저가 파서다) — 웹과 앱이 같은 본문을 다르게 자르지 않도록 토크나이저와
// 태그·속성 허용 목록은 새니타이저와 공유한다.
//
// 입력은 서버가 sanitizeRichText 를 통과시켜 DB 에 넣은 값이지만, 파서는 **어떤 입력에도
// 던지지 않는다**: 닫히지 않은 태그는 끝에서 닫히고, 모르는 태그는 껍데기만 버리고 내용을
// 살리고, 깨진 엔티티는 글자 그대로 남긴다. 옛 글(허용 목록이 좁아지기 전 저장분)이나 DB 를
// 직접 고친 값이 들어와도 화면이 통째로 죽지 않아야 하기 때문이다.
//
// 성능: 30KB(RICH_TEXT_HTML_MAX) 본문에서 선형 시간이어야 한다. 토큰마다 out 배열에 노드를
// 밀어 넣기만 하고, 문자열을 누적 결합하지 않는다(O(n²) 금지). 인접 텍스트 조각 병합도
// 마지막 노드의 text 에 붙이는 한 번뿐이라 전체로는 입력 길이에 비례한다.

export type RichNode =
  | { type: "text"; text: string }
  | { type: "element"; tag: RichTextTag; attrs: Record<string, string>; children: RichNode[] };

// 텍스트 노드용 엔티티 복원 — 브라우저가 텍스트 노드에서 하는 만큼만. 이름 있는 것은
// 새니타이저 escapeText 가 만들어 내는 다섯 가지 + nbsp, 숫자 엔티티는 10진·16진 전부.
// 모르는 이름(&foo;)은 브라우저처럼 글자 그대로 둔다.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeTextEntities(text: string): string {
  if (text.indexOf("&") < 0) return text;
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (whole, hex, dec, name) => {
    if (hex) return safeFromCharCode(parseInt(hex, 16)) || whole;
    if (dec) return safeFromCharCode(parseInt(dec, 10)) || whole;
    // 이름 있는 엔티티는 세미콜론이 있어야 한다(`&ampx` 같은 건 글자 그대로).
    if (!whole.endsWith(";")) return whole;
    const decoded = NAMED_ENTITIES[name.toLowerCase()];
    return decoded ?? whole;
  });
}

// 새니타이즈된 본문을 노드 트리로 푼다. 던지지 않는다(위 머리말).
export function parseRichText(html: string): RichNode[] {
  const source = String(html ?? "");
  const root: RichNode[] = [];
  // 열린 요소 스택. 맨 위가 지금 자식을 받는 요소다.
  const stack: Array<Extract<RichNode, { type: "element" }>> = [];
  const currentChildren = () => (stack.length ? stack[stack.length - 1].children : root);

  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeTextEntities(raw);
    const siblings = currentChildren();
    const lastNode = siblings[siblings.length - 1];
    // 인접 텍스트(모르는 태그가 사라진 자리 양쪽)는 한 노드로 합쳐 렌더러가 Text 를 덜 만들게.
    if (lastNode && lastNode.type === "text") lastNode.text += text;
    else siblings.push({ type: "text", text });
  };

  // 새니타이저와 같은 규칙: script/style 류 안에 있는 동안은 텍스트도 태그도 버린다.
  let dropDepth = 0;
  let dropTag = "";

  const tokenRe = createTokenRe();
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(source)) !== null) {
    if (dropDepth === 0) pushText(source.slice(last, match.index));
    last = tokenRe.lastIndex;

    const tagName = match[1]?.toLowerCase();
    // 주석·DOCTYPE·CDATA 는 화면에 그릴 것이 없다.
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
      // 스택에서 가장 가까운 같은 태그까지 닫는다. 열린 적 없는 닫는 태그는 무시.
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tagName) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) stack.length = idx;
      continue;
    }

    const allowedAttrs = allowedAttrsOf(tagName);
    // 허용 목록 밖 태그(font·table·…)는 껍데기만 버리고 안쪽 내용은 그대로 살린다.
    if (!allowedAttrs) continue;
    const tag = tagName as RichTextTag;

    const attrs: Record<string, string> = {};
    const rawAttrs = match[2] ?? "";
    if (rawAttrs.trim()) {
      for (const [name, value] of parseAttrs(rawAttrs)) {
        // 새니타이저가 남기는 속성만: 태그별 목록 + 모든 태그에 붙을 수 있는 style.
        if (name === "style" || allowedAttrs.includes(name)) attrs[name] = value;
      }
    }

    const node: Extract<RichNode, { type: "element" }> = { type: "element", tag, attrs, children: [] };
    currentChildren().push(node);
    // br·hr·img 는 자식을 가질 수 없으니 스택에 올리지 않는다(`<img>` 뒤 텍스트가 이미지 안으로
    // 들어가지 않게). "<p/>" 처럼 자기 닫힘으로 적힌 일반 태그도 브라우저처럼 열린 것으로 본다.
    if (!VOID_TAGS.has(tagName)) stack.push(node);
  }

  if (dropDepth === 0) pushText(source.slice(last));
  // 닫히지 않은 요소는 이미 트리에 들어 있으므로 스택만 비우면 끝난다.
  return root;
}

// 노드 트리의 글자만 이어 붙인 것. 왕복 테스트·미리보기 문구에 쓴다.
export function richTextNodesToText(nodes: readonly RichNode[]): string {
  const out: string[] = [];
  const walk = (list: readonly RichNode[]) => {
    for (const node of list) {
      if (node.type === "text") out.push(node.text);
      else walk(node.children);
    }
  };
  walk(nodes);
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
