// 자유게시판 에디터(components/rich-text-editor.tsx)의 DOM 없는 순수 부분.
//
// contenteditable 은 첫 줄을 블록 없이 루트 텍스트로 두고, 엔터를 친 뒤의 줄만 블록
// (defaultParagraphSeparator — 우리는 p)으로 감싼다. Chrome·Safari 가 그렇고, Firefox 는 옛 br 모드에서
// 줄을 <br> 로만 나눈다. 그래서 에디터가 onChange 로 내보내기 직전에 루트의 인라인 연속을 <p> 로 감싼다 —
// 에디터 DOM 은 건드리지 않는다(노드를 옮기면 그 안에 있던 커서가 루트로 튄다 — DOM 표준의 live range 규칙:
// 노드가 떼어지면 그 안을 가리키던 range 경계가 부모로 옮겨진다). 화면은 그대로다(.board-content p 의 여백이
// 0 이라 루트 텍스트와 <p> 가 같은 모습).
//
// 앱의 core decomposeRichText 도 같은 규칙으로 옛 글을 접는다(packages/core/src/rich-text-lite.ts "웹 에디터
// 출력 정규화") — 여기서는 새 글이 저장부터 <p> 모양이 되게 한다. 저장은 어차피 서버가 sanitizeRichText 를
// 다시 돌리므로 이 함수는 신뢰 경계가 아니다.

// 루트 자식 하나. 컴포넌트가 el.childNodes 를 이 모양으로 옮겨 넘긴다(텍스트는 innerHTML 과 같은 이스케이프,
// 요소는 outerHTML). 주석 노드는 넘기지 않는다.
export type EditorRootNode = { tag: string | null; html: string };

// 루트에서 문단으로 감싸지 않는 태그. 브라우저가 블록으로 두는 것 + 본문 CSS 가 블록으로 그리는 img.
// hr·img 는 새니타이저가 남기는 void 태그라 문단 안에 넣으면 모양이 달라진다.
const ROOT_BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "hr",
  "img",
  "table",
  "section",
  "article",
  "header",
  "footer",
  "figure",
]);

function isBlank(node: EditorRootNode): boolean {
  // 텍스트는 공백·&nbsp; 만이면 비어 있다. 요소는 비어 있다고 보지 않는다(<b></b> 도 그대로 둔다 —
  // 새니타이저·core 정규화가 빈 서식은 버린다).
  return node.tag === null && node.html.replace(/&nbsp;/g, " ").trim() === "";
}

// innerHTML 의 텍스트 노드 직렬화와 같은 이스케이프(HTML 직렬화 알고리즘: & < > 와 U+00A0 만).
export function escapeEditorText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
}

// 루트 자식 목록 → 저장용 HTML. 블록은 그대로, 인라인 연속(텍스트·서식 요소·br)은 <p> 로 감싼다.
// 루트의 <br> 은 문단 경계다(Firefox 옛 모드 "첫줄<br>둘째"). 블록 사이의 공백만 든 텍스트는 버린다.
// 빈 연속(br 뒤에 아무것도 없는 줄)은 <p><br></p> — 에디터가 빈 줄에 쓰는 것과 같은 모양.
export function wrapRootInlineRuns(nodes: readonly EditorRootNode[]): string {
  const out: string[] = [];
  let run: EditorRootNode[] = [];
  let sawBr = false;

  const flush = (endedByBr: boolean) => {
    const hasContent = run.some((n) => !isBlank(n));
    if (hasContent) {
      out.push(`<p>${run.map((n) => n.html).join("")}</p>`);
    } else if (endedByBr || sawBr) {
      // "첫줄<br><br>셋째" 의 가운데처럼 br 사이의 빈 줄. 블록 끝의 br 하나(마지막 flush)는 줄이 아니다.
      out.push("<p><br></p>");
    }
    run = [];
  };

  for (const node of nodes) {
    if (node.tag === "br") {
      flush(true);
      sawBr = true;
      continue;
    }
    if (node.tag !== null && ROOT_BLOCK_TAGS.has(node.tag)) {
      // 블록 앞의 연속. br 로 끝나지 않은 빈 연속은 블록 사이 공백이다.
      flush(false);
      sawBr = false;
      out.push(node.html);
      continue;
    }
    run.push(node);
  }
  // 끝의 연속. 직전이 br 이었고 내용이 없으면 "블록 끝의 br 하나" 라 줄을 만들지 않는다.
  sawBr = false;
  flush(false);
  return out.join("");
}
