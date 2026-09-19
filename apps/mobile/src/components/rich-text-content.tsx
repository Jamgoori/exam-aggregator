import { parseRichText, type RichNode, type RichTextTag } from "@gongmoa/core";
import { Image } from "expo-image";
import { useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { AppText } from "./app-text";
import { ImageZoomModal } from "./image-zoom-modal";
import { isOpenableLink, openExternalLink } from "../lib/open-link";
import { richText, useIsDark } from "../theme";

// 저장된 게시판 본문(서식 있는 HTML)을 그리는 자리 — 웹 components/rich-text-content.tsx 의 앱 판.
//
// 앱에는 DOM 이 없어 HTML 을 직접 그릴 수 없으므로 core `parseRichText` 로 노드 트리를 받아
// 태그별로 Text/View/expo-image 를 고른다(설계서 §6.7 #31 — react-native-render-html 은 React 19
// 에서 defaultProps 가 죽어 채택하지 않았다). 본문 HTML 을 그리는 곳은 앱에서도 **이 한 곳**이다.
//
// **여기에 들어오는 html 은 서버가 sanitizeRichText 를 통과시켜 DB 에 넣은 값이어야 한다**
// (board-write EF / 웹 board/actions.ts). 앱에서는 XSS 가 아니라 "검증 안 된 마크업이 화면을
// 깨뜨리는" 문제다 — 허용 목록 밖 태그·속성·style 값을 파서가 조용히 버리기는 하지만, 임의의
// 이미지 주소가 추적 픽셀이 되고 임의의 링크가 다른 앱을 띄우는 것까지 여기서 막지는 않는다.
// 사용자가 방금 입력한 값이나 어딘가에서 받아온 HTML 을 그대로 넘기지 말 것. 에디터 미리보기가
// 이 컴포넌트에 넘기는 값도 **core sanitizeRichText 를 클라이언트에서 한 번 통과시킨 것**이어야
// 한다(웹 에디터가 미리보기에 같은 함수를 부르는 것과 같은 규칙 — 쓰는 동안 보이는 모습과 올린
// 뒤의 모습이 달라지지 않게).
//
// 스타일은 웹 globals.css `.board-content`(410-470행) 1:1 이고 값은 theme `richText` 토큰이다.
// RN 제약으로 웹과 달라지는 것: (1) 문자열은 반드시 Text 안에 — 블록 안의 인라인 연속(텍스트·
// b·a·span…)을 하나의 Text 로 묶고 인라인 태그는 중첩 Text 로 그린다. (2) CSS 마진 병합이 없어
// 이웃 블록의 세로 마진을 max() 로 직접 합친다(첫 자식 margin-top 0 도 웹 규칙). (3)
// text-underline-offset·overflow-wrap: anywhere 는 없어 RN 기본 밑줄·줄바꿈을 쓴다.
//
// **style 객체에 값이 undefined 인 키를 넣지 말 것.** uniwind 는 className 에서 만든 style 뒤에 props.style
// 을 잇고(`[style, props.style]`), RN(Fabric)은 뒤에 오는 `{ color: undefined }` 를 "앞 값을 지우는 null"
// 로 취급한다(ReactNativeAttributePayload.diffProperties — "An explicit value of undefined is treated as a
// null because it overrides any other preceding value"). 그래서 `color: ctx.color` 처럼 쓰면 className 의
// text-zinc-700/200·text-blue-600 이 지워져 본문이 기본색(검정)이 되고 다크 모드에서는 읽을 수 없다.
// 아래 inlineStyle·Block 이 값이 있을 때만 키를 넣는 이유다.

export type RichTextContentProps = {
  html: string;
  className?: string;
};

type ElementNode = Extract<RichNode, { type: "element" }>;

// 허용 태그 22종의 배치 종류. core 가 태그를 더하면 여기서 tsc 가 실패하도록 satisfies 로 묶는다 —
// "core 에서 export 한 키 목록을 렌더러가 읽는다"(설계서 #31)를 타입으로 강제하는 자리.
const TAG_KIND = {
  p: "block",
  br: "inline",
  div: "block",
  span: "inline",
  b: "inline",
  strong: "inline",
  i: "inline",
  em: "inline",
  u: "inline",
  s: "inline",
  strike: "inline",
  h2: "block",
  h3: "block",
  blockquote: "block",
  ul: "block",
  ol: "block",
  li: "block",
  pre: "block",
  code: "inline",
  hr: "block",
  a: "inline",
  img: "block",
} as const satisfies Record<RichTextTag, "block" | "inline">;

type BlockTag = { [K in RichTextTag]: (typeof TAG_KIND)[K] extends "block" ? K : never }[RichTextTag];

function isBlock(node: RichNode): node is ElementNode & { tag: BlockTag } {
  return node.type === "element" && TAG_KIND[node.tag] === "block";
}

// 웹 `.board-content` 의 블록 세로 마진(px). div 는 여백이 없고 p 도 같다(theme richText.paragraph —
// 옛 웹 글의 div 문단과 새 글의 p 문단이 같은 모습이어야 해서 0). 문단 사이 간격은 빈 줄이 만든다.
const BLOCK_MARGIN: Record<BlockTag, { top: number; bottom: number }> = {
  p: { top: 0, bottom: richText.paragraph.marginBottom },
  div: { top: 0, bottom: 0 },
  h2: { top: richText.h2.marginTop, bottom: richText.h2.marginBottom },
  h3: { top: richText.h3.marginTop, bottom: richText.h3.marginBottom },
  blockquote: { top: richText.blockquote.marginVertical, bottom: richText.blockquote.marginVertical },
  ul: { top: richText.list.marginVertical, bottom: richText.list.marginVertical },
  ol: { top: richText.list.marginVertical, bottom: richText.list.marginVertical },
  li: { top: richText.listItem.marginVertical, bottom: richText.listItem.marginVertical },
  pre: { top: richText.pre.marginVertical, bottom: richText.pre.marginVertical },
  hr: { top: richText.hr.marginVertical, bottom: richText.hr.marginVertical },
  img: { top: richText.image.marginVertical, bottom: richText.image.marginVertical },
};

// 브라우저 절대 크기 키워드(medium = 16px 기준 표). 새니타이저 isFontSize 가 통과시키는 키워드다.
const FONT_SIZE_KEYWORD: Record<string, number> = {
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
};
const REM_PX = 16;

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

// 인라인 텍스트 문맥. 조상 태그·style 이 누적된 값이라 중첩 Text 마다 전부 명시해 그린다 — RN
// 의 Text 상속에만 맡기면 `<b><span style="font-weight: normal">` 처럼 되돌리는 경우를 못 그린다.
// color 만은 없으면 undefined 로 두어 루트 Text 의 className(zinc-700/200)·링크 색을 상속받는다.
type InlineCtx = {
  fontSize: number;
  fontWeight: NonNullable<TextStyle["fontWeight"]>;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  mono: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: TextStyle["textAlign"];
};

const BASE_INLINE: InlineCtx = {
  fontSize: richText.fontSize,
  fontWeight: "400",
  italic: false,
  underline: false,
  strike: false,
  mono: false,
};

type BlockCtx = {
  inline: InlineCtx;
  dark: boolean;
  onImagePress: (uri: string, label?: string) => void;
};

function inlineStyle(ctx: InlineCtx): TextStyle {
  const decoration: TextStyle["textDecorationLine"] =
    ctx.underline && ctx.strike ? "underline line-through" : ctx.underline ? "underline" : ctx.strike ? "line-through" : "none";
  const style: TextStyle = {
    fontSize: ctx.fontSize,
    lineHeight: richText.lineHeight,
    fontWeight: ctx.fontWeight,
    fontStyle: ctx.italic ? "italic" : "normal",
    textDecorationLine: decoration,
  };
  // 없는 값은 키 자체를 넣지 않는다(머리말 — undefined 키가 className 색을 지운다). color 가 없으면
  // 루트 Text 의 className(zinc-700/200)이나 링크 Text 의 blue 를 그대로 상속받는다.
  if (ctx.mono) style.fontFamily = MONO_FONT;
  if (ctx.color !== undefined) style.color = ctx.color;
  if (ctx.backgroundColor !== undefined) style.backgroundColor = ctx.backgroundColor;
  return style;
}

// style 속성(새니타이저가 `name: value; …` 로 정규화해 둔 것)을 선언 목록으로.
function parseStyleAttr(raw: string | undefined): [string, string][] {
  if (!raw) return [];
  const out: [string, string][] = [];
  for (const decl of raw.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const name = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (name && value) out.push([name, value]);
  }
  return out;
}

function resolveFontSize(value: string, current: number): number | null {
  const keyword = FONT_SIZE_KEYWORD[value];
  if (keyword) return keyword;
  if (value === "smaller") return current / 1.2;
  if (value === "larger") return current * 1.2;
  const m = /^(\d{1,3}(?:\.\d+)?)(px|pt|em|rem|%)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "px":
      return n;
    case "pt":
      return (n * 4) / 3;
    case "em":
      return n * current;
    case "rem":
      return n * REM_PX;
    default:
      return (n / 100) * current;
  }
}

function resolveFontWeight(value: string, current: InlineCtx["fontWeight"]): InlineCtx["fontWeight"] {
  if (/^[1-9]00$/.test(value)) return value as InlineCtx["fontWeight"];
  if (value === "bold") return "700";
  if (value === "normal") return "400";
  // bolder/lighter 는 상대값 — 브라우저 표(400→700→900 / 700→400→100)를 따른다.
  const n = Number(current);
  if (value === "bolder") return n < 400 ? "400" : n < 600 ? "700" : "900";
  if (value === "lighter") return n < 600 ? "100" : n < 800 ? "400" : "700";
  return current;
}

// style 선언을 인라인 문맥에 얹는다. 블록(p·div·h2…)의 style 은 background-color 가 View 로
// 가고 text-align 이 그 블록의 Text 정렬이 되므로 호출부가 그 둘을 따로 처리한다.
function applyInlineStyle(ctx: InlineCtx, decls: [string, string][], blockLevel: boolean): InlineCtx {
  if (decls.length === 0) return ctx;
  let next = ctx;
  const set = (patch: Partial<InlineCtx>) => {
    next = { ...next, ...patch };
  };
  for (const [name, value] of decls) {
    switch (name) {
      case "color":
        set({ color: value });
        break;
      case "background-color":
        if (!blockLevel) set({ backgroundColor: value });
        break;
      case "font-size": {
        const size = resolveFontSize(value, next.fontSize);
        if (size) set({ fontSize: size });
        break;
      }
      case "font-weight":
        set({ fontWeight: resolveFontWeight(value, next.fontWeight) });
        break;
      case "font-style":
        set({ italic: value !== "normal" });
        break;
      case "text-align":
        // 인라인 요소의 text-align 은 CSS 에서도 효과가 없다 — 블록에서만 받는다.
        if (blockLevel && (value === "left" || value === "center" || value === "right" || value === "justify")) {
          set({ textAlign: value });
        }
        break;
      case "text-decoration":
      case "text-decoration-line": {
        const parts = value.split(/\s+/);
        // overline 은 RN 에 없어 무시한다.
        set({
          underline: parts.includes("underline"),
          strike: parts.includes("line-through"),
        });
        break;
      }
      default:
        break;
    }
  }
  return next;
}

// ───────────────────────── 인라인 연속(run)의 공백 정리 ─────────────────────────
//
// HTML 은 텍스트 노드의 연속 공백을 한 칸으로 접고, 줄 처음·끝의 공백을 지우며, 블록 끝의
// <br> 하나는 줄을 만들지 않는다(`<p>a<br></p>` 는 한 줄). RN Text 는 그런 규칙이 없으므로
// run 단위로 미리 계산해 텍스트 노드별 문자열과 건너뛸 <br> 을 정한다. pre 안에서는 그대로 둔다.
type RunText = { texts: Map<RichNode, string>; skipBr: Set<RichNode>; hadBr: boolean; empty: boolean };

function normalizeRun(nodes: readonly RichNode[], preserve: boolean): RunText {
  const texts = new Map<RichNode, string>();
  const skipBr = new Set<RichNode>();
  let hadBr = false;
  let atLineStart = true;
  let lastEndedWithSpace = false;
  // 클로저 안에서 대입하는 변수라 TS 가 흐름 분석으로 never 로 좁히지 않게 타입을 명시한다.
  let lastText = null as RichNode | null;
  let lastMeaningful = null as RichNode | null;
  let first = true;

  const walk = (list: readonly RichNode[]) => {
    for (const node of list) {
      if (node.type === "text") {
        let t = node.text;
        if (preserve) {
          // HTML 파싱 규칙: <pre> 바로 뒤의 개행 하나는 버린다.
          if (first && t.startsWith("\n")) t = t.slice(1);
        } else {
          t = t.replace(/[ \t\n\r\f]+/g, " ");
          if ((atLineStart || lastEndedWithSpace) && t.startsWith(" ")) t = t.slice(1);
        }
        first = false;
        texts.set(node, t);
        if (t) {
          atLineStart = false;
          lastEndedWithSpace = !preserve && t.endsWith(" ");
          lastText = node;
          if (t.trim() || preserve) lastMeaningful = node;
        }
        continue;
      }
      if (node.tag === "br") {
        hadBr = true;
        lastMeaningful = node;
        if (!preserve && lastText && lastEndedWithSpace) {
          // 줄 끝 공백은 브라우저가 지운다.
          texts.set(lastText, (texts.get(lastText) ?? "").replace(/ $/, ""));
        }
        atLineStart = true;
        lastEndedWithSpace = false;
        continue;
      }
      walk(node.children);
    }
  };
  walk(nodes);

  if (!preserve && lastText && lastEndedWithSpace) {
    texts.set(lastText, (texts.get(lastText) ?? "").replace(/ $/, ""));
  }
  // 블록 맨 끝의 <br> 하나는 줄을 만들지 않는다.
  if (lastMeaningful && lastMeaningful.type === "element" && lastMeaningful.tag === "br") skipBr.add(lastMeaningful);

  let empty = true;
  for (const t of texts.values()) {
    if (t) {
      empty = false;
      break;
    }
  }
  return { texts, skipBr, hadBr, empty };
}

// ───────────────────────── 인라인 렌더 ─────────────────────────

function renderInline(node: RichNode, ctx: InlineCtx, run: RunText, key: number): ReactNode {
  if (node.type === "text") {
    const t = run.texts.get(node) ?? "";
    return t || null;
  }
  const { tag } = node;
  if (tag === "br") return run.skipBr.has(node) ? null : "\n";
  // 인라인 자리에 온 블록(a 안의 img 같은 것)은 껍데기를 버리고 글자만 살린다. 이미지는 Text
  // 안에 넣을 수 없어 여기서는 그리지 않는다(블록 자리의 img 는 renderBlockChildren 이 그린다).
  if (tag === "img" || tag === "hr") return null;

  let next = ctx;
  switch (tag) {
    case "b":
    case "strong":
      next = { ...next, fontWeight: "700" };
      break;
    case "i":
    case "em":
      next = { ...next, italic: true };
      break;
    case "u":
      next = { ...next, underline: true };
      break;
    case "s":
    case "strike":
      next = { ...next, strike: true };
      break;
    case "code":
      // `pre, code { font-size: 0.9em }` — em 이라 중첩되면 다시 0.9배(웹과 같다).
      next = { ...next, mono: true, fontSize: next.fontSize * richText.codeFontScale };
      break;
    case "a":
      // `.board-content a { text-decoration: underline }`
      next = { ...next, underline: true };
      break;
    default:
      break;
  }
  next = applyInlineStyle(next, parseStyleAttr(node.attrs.style), false);
  const children = node.children.map((child, i) => renderInline(child, next, run, i));

  if (tag === "a") {
    const href = node.attrs.href;
    // http(s) 만 링크다. mailto·내부 경로는 새니타이저가 남기지만 앱은 열지 않고 글자로 둔다
    // (lib/open-link.ts 머리말). 열지 않는 링크는 색·밑줄도 주지 않는다.
    if (isOpenableLink(href)) {
      return (
        <Text
          key={key}
          accessibilityRole="link"
          className="text-blue-600 dark:text-blue-400"
          style={inlineStyle(next)}
          onPress={() => void openExternalLink(href)}
        >
          {children}
        </Text>
      );
    }
    return (
      <Text key={key} style={inlineStyle({ ...next, underline: ctx.underline })}>
        {children}
      </Text>
    );
  }

  return (
    <Text key={key} style={inlineStyle(next)}>
      {children}
    </Text>
  );
}

// 블록 안의 인라인 연속 하나 = Text 하나. 문자열이 View 의 직접 자식이 되는 일이 없게 하는 자리.
function InlineRun({ nodes, ctx, preserve }: { nodes: readonly RichNode[]; ctx: InlineCtx; preserve: boolean }) {
  const run = normalizeRun(nodes, preserve);
  if (run.empty && !run.hadBr) return null;
  const children = nodes.map((node, i) => renderInline(node, ctx, run, i));
  return (
    <AppText
      variant="15"
      className="text-zinc-700 dark:text-zinc-200"
      style={[
        inlineStyle(ctx),
        ctx.textAlign ? { textAlign: ctx.textAlign } : null,
        // 글자 없이 <br> 만 있는 줄(`<div><br></div>`)도 브라우저처럼 한 줄 높이를 차지한다.
        run.empty ? { minHeight: richText.lineHeight } : null,
      ]}
    >
      {children}
    </AppText>
  );
}

// ───────────────────────── 블록 렌더 ─────────────────────────

type Item = { kind: "block"; node: ElementNode & { tag: BlockTag } } | { kind: "run"; nodes: RichNode[] };

// 자식을 "블록" 과 "인라인 연속" 으로 나눈다. 블록 사이의 공백만 있는 텍스트(`</p>\n<p>`)는
// 브라우저처럼 버린다. 블록을 품은 인라인(`<span><p>…`)은 껍데기를 풀어 그 자식을 이 층에 올린다 —
// 새니타이저가 태그 균형만 맞추고 배치 규칙은 보지 않아 이런 모양이 저장될 수 있다.
function partition(children: readonly RichNode[], ctx: InlineCtx): { item: Item; ctx: InlineCtx }[] {
  const out: { item: Item; ctx: InlineCtx }[] = [];
  let run: RichNode[] = [];
  const flush = () => {
    if (run.length && run.some((n) => n.type === "element" || n.text.trim())) out.push({ item: { kind: "run", nodes: run }, ctx });
    run = [];
  };
  for (const child of children) {
    if (isBlock(child)) {
      flush();
      out.push({ item: { kind: "block", node: child }, ctx });
    } else if (child.type === "element" && child.tag !== "br" && containsBlock(child)) {
      flush();
      const inner = inlineCtxFor(child, ctx);
      for (const entry of partition(child.children, inner)) out.push(entry);
    } else {
      run.push(child);
    }
  }
  flush();
  return out;
}

function containsBlock(node: ElementNode): boolean {
  return node.children.some((c) => c.type === "element" && (TAG_KIND[c.tag] === "block" || containsBlock(c)));
}

// 인라인 래퍼를 풀어 올릴 때 그 서식만 문맥에 남긴다(renderInline 의 태그별 규칙과 같다).
function inlineCtxFor(node: ElementNode, ctx: InlineCtx): InlineCtx {
  let next = ctx;
  if (node.tag === "b" || node.tag === "strong") next = { ...next, fontWeight: "700" };
  else if (node.tag === "i" || node.tag === "em") next = { ...next, italic: true };
  else if (node.tag === "u" || node.tag === "a") next = { ...next, underline: true };
  else if (node.tag === "s" || node.tag === "strike") next = { ...next, strike: true };
  else if (node.tag === "code") next = { ...next, mono: true, fontSize: next.fontSize * richText.codeFontScale };
  return applyInlineStyle(next, parseStyleAttr(node.attrs.style), false);
}

type Margins = { marginTop: number; marginBottom: number };

// 블록 자식들을 CSS 마진 병합 규칙으로 그린다: 이웃한 두 블록의 세로 마진은 max(). 루트의 첫 자식은
// margin-top 0(`.board-content > *:first-child`). 세로 패딩이 없는 부모 안에서는 첫 자식의 margin-top·
// 끝 자식의 margin-bottom 이 부모 마진에 흡수된다(부모 마진이 더 큰 보통의 경우만 정확 — ul(8) 이
// li(2.4) 안에 마지막으로 올 때처럼 자식 마진이 더 크면 웹보다 좁아진다; 의도적 근사).
function renderBlockChildren(
  children: readonly RichNode[],
  ctx: BlockCtx,
  opts: { root?: boolean; padded?: boolean; preserve?: boolean; list?: "ul" | "ol" } = {},
): ReactNode[] {
  const entries = partition(children, ctx.inline);
  const out: ReactNode[] = [];
  let prevBottom = 0;
  let liIndex = 0;
  entries.forEach(({ item, ctx: inline }, i) => {
    const own = item.kind === "block" ? BLOCK_MARGIN[item.node.tag] : { top: 0, bottom: 0 };
    const isFirst = i === 0;
    const isLast = i === entries.length - 1;
    const absorb = !opts.root && !opts.padded;
    const marginTop = isFirst ? (opts.root || absorb ? 0 : own.top) : Math.max(prevBottom, own.top);
    const marginBottom = isLast && absorb ? 0 : own.bottom;
    prevBottom = own.bottom;
    const blockCtx: BlockCtx = inline === ctx.inline ? ctx : { ...ctx, inline };

    if (item.kind === "run") {
      out.push(<InlineRun key={i} nodes={item.nodes} ctx={inline} preserve={!!opts.preserve} />);
      return;
    }
    if (item.node.tag === "li") {
      const marker = opts.list === "ol" ? `${++liIndex}.` : "•";
      out.push(<ListItem key={i} node={item.node} marker={marker} ctx={blockCtx} margins={{ marginTop, marginBottom }} />);
      return;
    }
    out.push(<Block key={i} node={item.node} ctx={blockCtx} margins={{ marginTop, marginBottom }} />);
  });
  return out;
}

function Block({ node, ctx, margins }: { node: ElementNode & { tag: BlockTag }; ctx: BlockCtx; margins: Margins }) {
  const decls = parseStyleAttr(node.attrs.style);
  // 블록의 background-color 는 글자가 아니라 상자 색이다.
  const backgroundColor = decls.find(([name]) => name === "background-color")?.[1];
  // `backgroundColor: undefined` 를 넣으면 pre 의 className(bg-zinc-100/800)이 지워진다(머리말).
  const viewStyle: ViewStyle = backgroundColor ? { ...margins, backgroundColor } : { ...margins };
  let inline = applyInlineStyle(ctx.inline, decls, true);

  switch (node.tag) {
    case "p":
      return (
        <View style={[viewStyle, { minHeight: richText.paragraph.minHeight }]}>
          {renderBlockChildren(node.children, { ...ctx, inline })}
        </View>
      );
    case "div":
      return <View style={viewStyle}>{renderBlockChildren(node.children, { ...ctx, inline })}</View>;
    case "h2":
    case "h3":
      // `h2 { font-size: 1.25rem } h3 { font-size: 1.1rem }` + font-weight 700, 줄높이는 본문 28px 상속.
      inline = { ...inline, fontSize: richText[node.tag].fontSize, fontWeight: "700" };
      return <View style={viewStyle}>{renderBlockChildren(node.children, { ...ctx, inline })}</View>;
    case "blockquote":
      // 글자색 #52525b/#a1a1aa 는 Tailwind v4 팔레트에 없는 웹 리터럴이라 토큰 값으로 준다.
      inline = { ...inline, color: inline.color ?? richText.blockquote.color[ctx.dark ? "dark" : "light"] };
      return (
        <View
          className="border-blue-300"
          style={[
            viewStyle,
            {
              borderLeftWidth: richText.blockquote.borderLeftWidth,
              paddingVertical: richText.blockquote.paddingVertical,
              paddingLeft: richText.blockquote.paddingLeft,
            },
          ]}
        >
          {renderBlockChildren(node.children, { ...ctx, inline }, { padded: true })}
        </View>
      );
    case "ul":
    case "ol":
      return (
        <View style={[viewStyle, { paddingLeft: richText.list.paddingLeft }]}>
          {renderBlockChildren(node.children, { ...ctx, inline }, { list: node.tag })}
        </View>
      );
    case "li":
      // 목록 밖에 홀로 온 li — 마커 없이 블록으로.
      return <View style={viewStyle}>{renderBlockChildren(node.children, { ...ctx, inline })}</View>;
    case "pre":
      // `pre { overflow-x: auto; white-space: pre }` — 가로 스크롤 + 공백·개행 보존, 고정폭 0.9em.
      inline = { ...inline, mono: true, fontSize: inline.fontSize * richText.codeFontScale };
      return (
        <View
          className="bg-zinc-100 dark:bg-zinc-800"
          style={[
            viewStyle,
            {
              borderRadius: richText.pre.borderRadius,
              paddingVertical: richText.pre.paddingVertical,
              paddingHorizontal: richText.pre.paddingHorizontal,
            },
          ]}
        >
          <ScrollView horizontal bounces={false}>
            <View>{renderBlockChildren(node.children, { ...ctx, inline }, { padded: true, preserve: true })}</View>
          </ScrollView>
        </View>
      );
    case "hr":
      return <View className="border-zinc-200 dark:border-zinc-700" style={[viewStyle, { borderTopWidth: richText.hr.borderTopWidth }]} />;
    case "img":
      return <RichImage src={node.attrs.src} alt={node.attrs.alt} margins={margins} onPress={ctx.onImagePress} />;
    default:
      return null;
  }
}

// li = 마커 + 내용. CSS list-style-position: outside 처럼 마커를 목록 들여쓰기(1.5rem) 안에 오른쪽
// 정렬로 놓는다. 마커 글자는 li 글자와 같은 크기·색(브라우저와 같다). "10." 처럼 들여쓰기보다
// 넓어지면 내용을 밀어낸다(웹은 왼쪽으로 넘친다 — 폰 폭에서 잘리는 것보다 낫다).
function ListItem({ node, marker, ctx, margins }: { node: ElementNode; marker: string; ctx: BlockCtx; margins: Margins }) {
  const inline = applyInlineStyle(ctx.inline, parseStyleAttr(node.attrs.style), true);
  return (
    <View style={[margins, { flexDirection: "row" }]}>
      <AppText
        variant="15"
        className="text-zinc-700 dark:text-zinc-200"
        style={[
          inlineStyle(inline),
          {
            minWidth: richText.list.paddingLeft,
            marginLeft: -richText.list.paddingLeft,
            paddingRight: richText.listMarkerGap,
            textAlign: "right",
          },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {marker}
      </AppText>
      <View style={{ flex: 1, minWidth: 0 }}>{renderBlockChildren(node.children, { ...ctx, inline })}</View>
    </View>
  );
}

// 본문 이미지. 웹 `img { display: block; max-width: 100%; height: auto }` — 원본이 폭보다 좁으면
// 원본 크기, 넓으면 폭에 맞춰 원본 비율로. 크기는 onLoad 의 source 로 알기 전까지 4:3 자리를 잡는다
// (question-image.tsx 와 같은 실측 방식; 게시판 이미지는 서버가 1600px webp 로 굽지만 폭·높이를
// 저장하지 않는다). 누르면 기존 ImageZoomModal 로 확대(핀치).
function RichImage({
  src,
  alt,
  margins,
  onPress,
}: {
  src: string | undefined;
  alt: string | undefined;
  margins: Margins;
  onPress: (uri: string, label?: string) => void;
}) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  if (!src) return null;
  const label = alt || undefined;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={label ?? "본문 이미지"}
      onPress={() => onPress(src, label)}
      style={margins}
    >
      <Image
        source={{ uri: src }}
        style={{
          width: "100%",
          maxWidth: dims?.width,
          aspectRatio: dims ? dims.width / dims.height : richText.image.placeholderAspectRatio,
          borderRadius: richText.image.borderRadius,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={100}
        accessible={!!label}
        accessibilityLabel={label}
        onLoad={(e) => {
          const { width, height } = e.source;
          if (width > 0 && height > 0) setDims({ width, height });
        }}
      />
    </Pressable>
  );
}

// 웹 `<RichTextContent html className>` 과 같은 props. 루트 클래스(`text-[15px] leading-7
// text-zinc-700 dark:text-zinc-200`)는 문자열을 View 에 못 얹는 RN 사정으로 각 Text(InlineRun)가 든다.
export function RichTextContent({ html, className }: RichTextContentProps) {
  const nodes = useMemo(() => parseRichText(html), [html]);
  const dark = useIsDark();
  const [zoom, setZoom] = useState<{ uri: string; label?: string } | null>(null);
  const ctx: BlockCtx = {
    inline: BASE_INLINE,
    dark,
    onImagePress: (uri, label) => setZoom({ uri, label }),
  };
  return (
    <View className={className}>
      {renderBlockChildren(nodes, ctx, { root: true })}
      <ImageZoomModal uri={zoom?.uri ?? null} label={zoom?.label} onClose={() => setZoom(null)} />
    </View>
  );
}
