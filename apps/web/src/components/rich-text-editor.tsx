"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { uploadBoardImage } from "@/app/board/actions";
import {
  prepareImageUpload,
  UPLOAD_BODY_LIMIT_BYTES,
} from "@/lib/prepare-image-upload";
import {
  escapeEditorText,
  wrapRootInlineRuns,
  type EditorRootNode,
} from "@/lib/rich-text-editor";

// 자유게시판 글쓰기 에디터.
//
// contentEditable + document.execCommand 로 만든다. execCommand 는 표준에서
// deprecated 지만, 대안은 (1) 편집기 라이브러리를 하나 더 얹거나 (2) Selection/Range
// 로 서식 적용을 직접 구현하는 것뿐이다. 이 게시판이 필요한 서식은 굵게·색·크기·
// 정렬·목록·링크·이미지가 전부고, 그만큼은 모든 최신 브라우저가 여전히 execCommand
// 로 정확히 처리한다 — 라이브러리 하나(수백 KB)를 번들에 더 얹는 것보다 이쪽이 싸다.
//
// **보안**: 여기서 나오는 HTML 은 신뢰하지 않는다. 저장은 서버 액션이 하고, 그
// 액션이 sanitizeRichText 를 통과시킨 결과만 DB 에 넣는다(board/actions.ts).
// 이 파일의 어떤 코드도 신뢰 경계가 아니다.
//
// styleWithCSS: 켜두면 크기·색이 <font size> 대신 <span style> 로 나온다. 꺼져 있는
// 브라우저를 위해 새니타이저가 <font> 도 span 으로 옮겨 받는다(rich-text.ts).
//
// **문단은 <p>, 굵게·기울임·밑줄·취소선은 <b>/<i>/<u>/<strike> 로 낸다(2026-09-19).** 그 전에는
// defaultParagraphSeparator 를 두지 않아 브라우저가 문단을 <div> 로, styleWithCSS 라 굵게를
// <span style="font-weight: bold"> 로 저장했고, 앱의 간단 편집기(core rich-text-lite)는 그 모양을
// 부분집합 밖으로 보아 평문 웹 글도 앱에서 잠겼다(설계서 §12-9·§13 질문 17). 그래서
//   · 초기화에서 execCommand("defaultParagraphSeparator", "p") — 엔터로 생기는 문단이 <p>(Chrome·
//     Firefox·Safari 모두 지원, MDN execCommand 명령 표). 지원 밖 브라우저는 <div> 그대로 두고 core
//     정규화가 받아준다.
//   · 네 서식 명령만 styleWithCSS 를 잠시 끄고 실행 — <b>/<i>/<u>/<strike> 가 나온다. 크기·색은 그대로
//     <span style>(원래 lite 로 못 가는 서식이고 <font> 보다 span 이 새니타이저에 곧게 들어간다).
//   · 첫 줄은 세 브라우저 모두 블록 없이 루트 텍스트로 남긴다(엔터 뒤의 줄만 감싼다) — sync 가 내보내기
//     직전에 루트의 인라인 연속을 <p> 로 감싼다(lib/rich-text-editor.ts). 빈 에디터에 <p><br></p> 를
//     심어 두는 방식은 쓰지 않는다: Chrome·Safari 는 전체 선택 + 삭제로 내용을 지우면 그 문단까지 지우고
//     <br> 하나(또는 아무것도)만 남겨 다음 입력이 다시 루트 텍스트가 된다(에디터 라이브러리들이 저마다
//     "빈 문단 유지" 코드를 두는 이유). 내보내기 직전의 감싸기는 어느 브라우저에서든 결과가 같다.
// 화면은 그대로다 — .board-content p 의 여백이 0 이라 루트 텍스트·div·p 가 같은 모습(globals.css).

// 본문 이미지의 긴 변 상한. 서버가 다시 굽는 값(1600px)과 같게 맞춘다 — 여기서
// 더 크게 보내봐야 서버에서 줄어들 뿐이고, 더 작게 보내면 서버가 못 살리는 화질이
// 그대로 굳는다.
const EDITOR_IMAGE_MAX_EDGE = 1600;

const FONT_SIZES = [
  { label: "작게", value: "2" },
  { label: "보통", value: "3" },
  { label: "크게", value: "5" },
  { label: "아주 크게", value: "6" },
] as const;

// 글자색 팔레트. 본문 기본색(검정/흰색)은 "기본"으로 따로 두고, 나머지는 라이트·
// 다크 양쪽에서 읽히는 채도로 골랐다(연한 파스텔은 흰 배경에서 안 보인다).
const TEXT_COLORS = [
  { label: "기본", value: "" },
  { label: "빨강", value: "#dc2626" },
  { label: "주황", value: "#ea580c" },
  { label: "초록", value: "#0a7d5b" },
  { label: "파랑", value: "#2563eb" },
  { label: "보라", value: "#7c3aed" },
  { label: "회색", value: "#6b7280" },
] as const;

// <span style> 대신 태그로 내보낼 서식 명령. 이 넷만 앱 간단 편집기의 마커(**·*·__·~~)와 맞는다.
const TAG_COMMANDS = new Set(["bold", "italic", "underline", "strikeThrough"]);

// 에디터 루트의 자식을 wrapRootInlineRuns 가 받는 모양으로. 텍스트는 innerHTML 과 같은 이스케이프,
// 요소는 outerHTML, 주석은 버린다(브라우저는 붙여넣기에서 주석을 안 만들지만 innerHTML 에는 실린다).
function rootNodesOf(el: HTMLElement): EditorRootNode[] {
  const out: EditorRootNode[] = [];
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push({ tag: null, html: escapeEditorText(node.textContent ?? "") });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out.push({ tag: (node as Element).tagName.toLowerCase(), html: (node as Element).outerHTML });
    }
  });
  return out;
}

type ToolbarButtonProps = {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
};

function ToolbarButton({ onClick, label, active = false, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      // onMouseDown 에서 기본 동작을 막는다 — 안 막으면 버튼을 누르는 순간 본문의
      // 선택 영역이 풀려서, 정작 서식을 걸 대상이 사라진다(에디터의 고전적인 함정).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        active
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />;
}

export function RichTextEditor({
  initialHtml = "",
  onChange,
  placeholder = "내용을 입력하세요",
}: {
  initialHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);
  // 현재 커서 위치에 걸린 서식(굵게 등). 툴바 버튼을 눌린 상태로 보여주는 데만 쓴다.
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [showColors, setShowColors] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  // 초기 본문은 한 번만 넣는다. onChange 로 되돌아온 값을 다시 넣으면 타이핑할 때마다
  // 커서가 맨 앞으로 튄다(제어 컴포넌트로 만들면 안 되는 이유).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialHtml;
    setEmpty(el.textContent?.trim() === "" && !el.querySelector("img"));
    try {
      // 크기·색을 <font> 대신 <span style> 로 만들게 한다.
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      // 지원하지 않는 브라우저면 <font> 가 나오고, 새니타이저가 그것을 받아준다.
    }
    try {
      // 엔터로 생기는 문단을 <div> 가 아니라 <p> 로(머리말). 문서 전역 설정이라 마운트마다 다시 건다.
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // 지원하지 않는 브라우저면 <div> 가 나오고, core 정규화(decomposeRichText)가 그것을 받아준다.
    }
    // initialHtml 은 마운트 시점 값만 쓴다(위 주석).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setEmpty(el.textContent?.trim() === "" && !el.querySelector("img"));
    onChange(wrapRootInlineRuns(rootNodesOf(el)));
  }, [onChange]);

  const refreshActive = useCallback(() => {
    if (typeof document.queryCommandState !== "function") return;
    const read = (cmd: string) => {
      try {
        return document.queryCommandState(cmd);
      } catch {
        return false;
      }
    };
    setActive({
      bold: read("bold"),
      italic: read("italic"),
      underline: read("underline"),
      strikeThrough: read("strikeThrough"),
      insertUnorderedList: read("insertUnorderedList"),
      insertOrderedList: read("insertOrderedList"),
      justifyLeft: read("justifyLeft"),
      justifyCenter: read("justifyCenter"),
      justifyRight: read("justifyRight"),
    });
  }, []);

  // 선택 영역이 에디터 안에 있을 때만 툴바 상태를 갱신한다.
  useEffect(() => {
    function onSelectionChange() {
      const el = editorRef.current;
      const selection = document.getSelection();
      if (!el || !selection?.anchorNode) return;
      if (!el.contains(selection.anchorNode)) return;
      refreshActive();
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [refreshActive]);

  function exec(command: string, value?: string) {
    editorRef.current?.focus();
    const asTag = TAG_COMMANDS.has(command);
    try {
      // 굵게·기울임·밑줄·취소선은 <span style> 이 아니라 <b>/<i>/<u>/<strike> 로(머리말). styleWithCSS 는
      // 문서 전역 상태라 끄고 → 실행 → 다시 켠다(크기·색은 계속 <span style> 이어야 한다).
      if (asTag) document.execCommand("styleWithCSS", false, "false");
      document.execCommand(command, false, value);
    } catch {
      // 브라우저가 거절하면 아무 일도 일어나지 않는다(본문은 그대로다).
    } finally {
      if (asTag) {
        try {
          document.execCommand("styleWithCSS", false, "true");
        } catch {
          // 위 초기화와 같은 사정 — <font> 가 나오면 새니타이저가 받아준다.
        }
      }
    }
    refreshActive();
    sync();
  }

  function insertHtml(html: string) {
    editorRef.current?.focus();
    try {
      document.execCommand("insertHTML", false, html);
    } catch {
      // 위와 같다.
    }
    sync();
  }

  function handleLink() {
    const url = window.prompt("링크 주소를 입력하세요 (https://...)");
    if (!url) return;
    const trimmed = url.trim();
    // 눈에 보이는 확인은 여기서 한 번, 실제 관문은 서버의 새니타이저다.
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("링크는 http:// 또는 https:// 로 시작해야 해요.");
      return;
    }
    setError(null);
    exec("createLink", trimmed);
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      // 브라우저에서 먼저 긴 변 1600px 로 줄여 보낸다. 원본(3~8MB)을 그대로 보내면
      // 서버 액션 본문 상한에 걸려 **아무 일도 일어나지 않는다**
      // (lib/prepare-image-upload.ts 머리말).
      const prepared = await prepareImageUpload(file, { maxEdge: EDITOR_IMAGE_MAX_EDGE });
      if (prepared.size > UPLOAD_BODY_LIMIT_BYTES) {
        // 줄이기가 실패한 파일(브라우저가 못 여는 형식 등). 여기서 이유를 말해주지
        // 않으면 사용자는 버튼이 고장 난 줄 안다.
        setError("사진 용량이 너무 커서 올릴 수 없어요. 크기를 줄이거나 다른 사진을 써주세요.");
        return;
      }

      const formData = new FormData();
      formData.append("file", prepared);
      const result = await uploadBoardImage(formData);
      if (result.error || !result.url) {
        setError(result.error ?? "이미지를 올리지 못했어요.");
        return;
      }
      // 이미지 뒤에 문단을 하나 붙여, 사진 아래로 이어서 쓸 자리를 만든다.
      insertHtml(`<img src="${result.url}" alt=""><p><br></p>`);
    } catch {
      // 서버 액션 호출 자체가 실패하는 경로가 있다(요청이 플랫폼에서 거절되는 등).
      // catch 가 없으면 그 실패가 조용히 삼켜져 "눌러도 아무 일이 없다"가 된다.
      setError("사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-300 focus-within:border-blue-500 focus-within:ring-3 focus-within:ring-blue-500/15 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50/80 px-1.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/50">
        <ToolbarButton onClick={() => exec("bold")} label="굵게" active={active.bold}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("italic")} label="기울임" active={active.italic}>
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("underline")}
          label="밑줄"
          active={active.underline}
        >
          <Underline size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("strikeThrough")}
          label="취소선"
          active={active.strikeThrough}
        >
          <Strikethrough size={15} />
        </ToolbarButton>

        <Divider />

        {/* 글자 크기 — 목록을 열어 고른다. 툴바에 네 개를 다 늘어놓으면 모바일에서
            줄이 넘친다. */}
        <div className="relative">
          <ToolbarButton
            onClick={() => {
              setShowSizes((v) => !v);
              setShowColors(false);
            }}
            label="글자 크기"
            active={showSizes}
          >
            <Type size={15} />
          </ToolbarButton>
          {showSizes && (
            <div className="animate-modal-panel-in absolute top-full left-0 z-20 mt-1 w-28 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {FONT_SIZES.map((size) => (
                <button
                  key={size.value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    exec("fontSize", size.value);
                    setShowSizes(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {size.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 글자 색 */}
        <div className="relative">
          <ToolbarButton
            onClick={() => {
              setShowColors((v) => !v);
              setShowSizes(false);
            }}
            label="글자 색"
            active={showColors}
          >
            <Palette size={15} />
          </ToolbarButton>
          {showColors && (
            <div className="animate-modal-panel-in absolute top-full left-0 z-20 mt-1 flex w-44 flex-wrap gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // "기본"은 색을 지우는 것이라 removeFormat 이 아니라 본문 색을
                    // 다시 칠한다 — removeFormat 은 굵게·밑줄까지 같이 지운다.
                    exec("foreColor", color.value || "inherit");
                    setShowColors(false);
                  }}
                  title={color.label}
                  aria-label={`글자 색 ${color.label}`}
                  className="h-6 w-6 rounded-full border border-zinc-200 dark:border-zinc-600"
                  style={{
                    background: color.value || "linear-gradient(135deg,#fff 50%,#111 50%)",
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <Divider />

        <ToolbarButton
          onClick={() => exec("justifyLeft")}
          label="왼쪽 정렬"
          active={active.justifyLeft}
        >
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("justifyCenter")}
          label="가운데 정렬"
          active={active.justifyCenter}
        >
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("justifyRight")}
          label="오른쪽 정렬"
          active={active.justifyRight}
        >
          <AlignRight size={15} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => exec("insertUnorderedList")}
          label="글머리 기호"
          active={active.insertUnorderedList}
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("insertOrderedList")}
          label="번호 매기기"
          active={active.insertOrderedList}
        >
          <ListOrdered size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("formatBlock", "blockquote")} label="인용">
          <Quote size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertHtml("<hr><p><br></p>")} label="구분선">
          <Minus size={15} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={handleLink} label="링크">
          <Link2 size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => fileRef.current?.click()} label="사진">
          <ImageIcon size={15} />
        </ToolbarButton>

        <span className="ml-auto flex items-center gap-0.5">
          {uploading && (
            <span className="mr-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              사진 올리는 중…
            </span>
          )}
          <ToolbarButton onClick={() => exec("undo")} label="되돌리기">
            <Undo2 size={15} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("redo")} label="다시 실행">
            <Redo2 size={15} />
          </ToolbarButton>
        </span>
      </div>

      <div className="relative">
        {/* placeholder 는 :empty 로는 못 잡는다 — contentEditable 은 비어 있어도
            <br> 하나를 남기는 브라우저가 있다. 그래서 내용 유무를 직접 센다. */}
        {empty && (
          <p className="pointer-events-none absolute top-4 left-4 text-sm text-zinc-400 dark:text-zinc-500">
            {placeholder}
          </p>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="본문"
          onInput={sync}
          onBlur={sync}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={(e) => {
            // 붙여넣기는 서식을 걷어낸 평문으로 받는다. 다른 사이트에서 복사한
            // HTML 을 그대로 받으면 남의 사이트 스타일(폰트·배경·표)이 통째로
            // 딸려 들어와 본문이 깨진다. 서식은 툴바로 다시 준다.
            //
            // 이미지 파일을 붙여넣은 경우(스크린샷)는 업로드로 넘긴다.
            const files = e.clipboardData?.files;
            if (files && files.length > 0 && files[0].type.startsWith("image/")) {
              e.preventDefault();
              void handleFiles(files);
              return;
            }
            e.preventDefault();
            const text = e.clipboardData?.getData("text/plain") ?? "";
            document.execCommand("insertText", false, text);
            sync();
          }}
          onDrop={(e) => {
            const files = e.dataTransfer?.files;
            if (files && files.length > 0 && files[0].type.startsWith("image/")) {
              e.preventDefault();
              void handleFiles(files);
            }
          }}
          className="board-content min-h-72 w-full px-4 py-4 text-[15px] leading-7 outline-none"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />

      {error && (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-red-600 dark:border-zinc-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
