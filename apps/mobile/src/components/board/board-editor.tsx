import {
  boardImageUploadError,
  composeRichText,
  isRichTextLiteUrl,
  RICH_TEXT_LITE_MARKS,
  RICH_TEXT_LITE_PREFIX,
  sanitizeRichText,
  type RichTextLinePrefix,
  type RichTextLiteMark,
} from "@gongmoa/core";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View, type TextInputSelectionChangeEvent } from "react-native";
import { BoardEditorToolbar } from "./board-editor-toolbar";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Input } from "../input";
import { RichTextContent } from "../rich-text-content";
import { Sheet } from "../sheet";
import { bakeBoardImageWebp } from "../../lib/board-image";
import { handleEdgeError } from "../../lib/edge";
import { useUploadBoardImage } from "../../queries/board-write";

// 자유게시판 글쓰기 에디터(웹 components/rich-text-editor.tsx 의 앱 판) — **축소판**이다.
//
// 웹은 contenteditable + execCommand 지만 RN 에는 그것이 없고, WebView 나 리치 에디터 라이브러리는 새
// 네이티브 의존이라 OTA 를 깬다(설계서 §12-8 과 같은 판단). 그래서 **다중행 TextInput 하나 + 가벼운
// 마크업**으로 간다: 값은 core rich-text-lite.ts 의 lite 문자열이고, 제출 직전에 composeRichText 로
// HTML 이 된다(board-form.tsx). 툴바(설계서 #31: 굵게/기울임/밑줄/취소선/목록/인용/링크/이미지)는 선택
// 영역을 마커로 감싸거나 현재 줄 머리에 접두를 토글한다.
//
// **보안**: 여기서 나오는 것은 신뢰하지 않는다. 저장은 EF board-write 가 하고, 그 함수가 sanitizeRichText
// 를 통과시킨 결과만 DB 에 넣는다(웹과 같은 규칙, AGENTS.md "자유게시판 본문"). 이 파일의 어떤 코드도
// 신뢰 경계가 아니다.
//
// **미리보기**: 마크업 에디터는 쓰는 모습과 올린 뒤 모습이 다르므로 토글로 보여준다(웹에는 없다 —
// WYSIWYG 라 필요가 없었다). 미리보기에 넘기는 값은 composeRichText → **sanitizeRichText** 를 클라이언트
// 에서 한 번 통과시킨 것이다 — RichTextContent 머리말이 요구하는 규칙(새니타이즈 안 된 값은 "올린 뒤
// 모습과 다른 미리보기"가 된다).
//
// **이미지**: 웹은 브라우저에서 긴 변 1600px 로 줄여 보내고 서버(sharp)가 다시 굽지만, 앱은 Skia 로
// 가로 ≤1600px webp 를 구워(lib/board-image.ts) base64 로 EF 에 보내고 돌아온 URL 을 `![](url)` 로
// 커서 자리에 넣는다. 굽는 동안 "올리는 중" 표시는 avatar-field.tsx 의 한 틱 양보 방식.

export type BoardEditorProps = {
  value: string;
  onChange: (lite: string) => void;
  placeholder?: string;
  // 본문 이미지 공개 URL 접두사(boardImageOrigin) — 미리보기 새니타이즈와 compose 가 같은 값을 쓴다.
  imageOrigins: readonly string[];
  // 수정 화면에서 decomposeRichText 가 unsupported 를 돌려준 글. 값이 있으면 편집 대신 저장된 HTML 을
  // 그대로 그리고 message 를 한 줄 보인다(board-form.tsx 에 이유).
  locked?: { html: string; message: string } | null;
  // 이미지 업로드가 401 로 끝났을 때 로그인 뒤 돌아올 경로(`/board/new` 또는 `/board/[id]/edit`). 폼이
  // 자기 주소를 알고 있어 넘겨준다 — 수정 중이던 글로 돌아와야 한다.
  nextPath: string;
};

type Selection = { start: number; end: number };

// 웹 handleFiles 의 catch 문장 — 서버가 문구를 준 경우에는 그 문장을 그대로 쓴다.
const UPLOAD_FALLBACK = "사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.";

// 현재 줄의 접두 종류. 번호 목록은 어떤 숫자든 받는다(rich-text-lite.ts ORDERED_RE 와 같은 뜻).
function linePrefixOf(line: string): { kind: RichTextLinePrefix; length: number } | null {
  if (line.startsWith(RICH_TEXT_LITE_PREFIX.bullet)) return { kind: "bullet", length: 2 };
  const ordered = /^\d+\. /.exec(line);
  if (ordered) return { kind: "ordered", length: ordered[0].length };
  if (line.startsWith(RICH_TEXT_LITE_PREFIX.quote)) return { kind: "quote", length: 2 };
  if (line === ">") return { kind: "quote", length: 1 };
  return null;
}

export function BoardEditor({
  value,
  onChange,
  placeholder = "내용을 입력하세요",
  imageOrigins,
  locked,
  nextPath,
}: BoardEditorProps) {
  const inputRef = useRef<TextInput>(null);
  // onSelectionChange 로 따라가는 현재 선택 영역. 툴바를 누르는 순간의 값을 쓰려는 것이라 ref 다
  // (state 로 두면 선택마다 리렌더).
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  // 툴바 콜백은 누른 순간의 value 를 쓰면 되지만, 사진 넣기는 picker 와 업로드를 **기다린 뒤** 삽입한다 —
  // 그동안 TextInput 은 열려 있어 사용자가 글을 이어 쓸 수 있다. 렌더 시점에 닫힌 value 로 삽입하면 그
  // 사이 친 글자가 통째로 사라지므로, 삽입은 언제나 최신 값을 든 이 ref 로 한다.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  // 프로그램이 값을 바꾼 직후 커서를 옮길 때만 채우는 제어 selection. 네이티브가 적용해 onSelectionChange 로
  // 되돌려 주면 비워서 다시 비제어로 둔다(늘 제어하면 안드로이드에서 타이핑마다 커서가 튄다).
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSheet, setLinkSheet] = useState<{ url: string; label: string; error: string | null } | null>(null);
  const upload = useUploadBoardImage();

  const liteOptions = useMemo(() => ({ imageOrigins }), [imageOrigins]);
  // 미리보기 HTML — compose 결과를 클라이언트에서 한 번 더 새니타이즈한 것(머리말).
  const previewHtml = useMemo(
    () => (preview ? sanitizeRichText(composeRichText(value, liteOptions), liteOptions) : ""),
    [preview, value, liteOptions],
  );

  function applyEdit(next: string, selection: Selection) {
    onChange(next);
    selectionRef.current = selection;
    // 값이 먼저 네이티브에 닿은 뒤 selection 이 적용돼야 한다 — 같은 렌더에 실으면 안드로이드가 옛 길이로
    // 자르는 일이 있어 한 틱 늦춘다.
    setTimeout(() => setForcedSelection(selection), 0);
    inputRef.current?.focus();
  }

  function onSelectionChange(e: TextInputSelectionChangeEvent) {
    selectionRef.current = e.nativeEvent.selection;
    if (forcedSelection) setForcedSelection(undefined);
  }

  // 선택 영역을 마커로 감싼다. 선택이 없으면 마커 쌍을 넣고 커서를 그 사이에 둔다.
  function wrapWithMark(mark: RichTextLiteMark) {
    const m = RICH_TEXT_LITE_MARKS[mark];
    const { start, end } = selectionRef.current;
    if (start === end) {
      const next = value.slice(0, start) + m + m + value.slice(start);
      applyEdit(next, { start: start + m.length, end: start + m.length });
      return;
    }
    const next = value.slice(0, start) + m + value.slice(start, end) + m + value.slice(end);
    applyEdit(next, { start: start + m.length, end: end + m.length });
  }

  // 현재 줄 머리에 접두를 토글한다. 다른 접두가 있으면 바꿔 끼운다.
  function togglePrefix(kind: RichTextLinePrefix) {
    const { start } = selectionRef.current;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", start);
    const lineEnd = lineEndIdx < 0 ? value.length : lineEndIdx;
    const line = value.slice(lineStart, lineEnd);
    const current = linePrefixOf(line);
    const body = current ? line.slice(current.length) : line;

    let nextLine: string;
    if (current?.kind === kind) {
      nextLine = body;
    } else if (kind === "ordered") {
      // 앞 줄이 번호 목록이면 이어서 센다(compose 는 어떤 숫자든 받지만 눈에 보이는 번호가 자연스럽게).
      const prevLine = lineStart > 0 ? value.slice(value.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1) : "";
      const prev = /^(\d+)\. /.exec(prevLine);
      nextLine = `${prev ? Number(prev[1]) + 1 : 1}. ${body}`;
    } else {
      nextLine = RICH_TEXT_LITE_PREFIX[kind] + body;
    }

    const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd);
    const delta = nextLine.length - line.length;
    const cursor = Math.max(lineStart, Math.min(start + delta, lineStart + nextLine.length));
    applyEdit(next, { start: cursor, end: cursor });
  }

  // 커서 자리에 텍스트를 넣고 커서를 그 뒤로. await 뒤에도 불리므로 value 가 아니라 valueRef 를 읽는다.
  function insertAtCursor(text: string) {
    const current = valueRef.current;
    const { start, end } = selectionRef.current;
    const next = current.slice(0, start) + text + current.slice(end);
    const cursor = start + text.length;
    applyEdit(next, { start: cursor, end: cursor });
  }

  function openLinkSheet() {
    setError(null);
    const { start, end } = selectionRef.current;
    setLinkSheet({ url: "", label: start === end ? "" : value.slice(start, end), error: null });
  }

  function confirmLink() {
    if (!linkSheet) return;
    const url = linkSheet.url.trim();
    // 눈에 보이는 확인은 여기서 한 번, 실제 관문은 서버의 새니타이저다. 앱은 https 만 받는다(스트림 지시 —
    // 웹은 http 도 받지만 앱에서 새로 넣는 링크는 https 로 좁힌다; 웹에서 쓴 http 링크를 되돌리는 것은
    // compose/decompose 가 받아준다).
    if (!/^https:\/\//i.test(url) || !isRichTextLiteUrl(url)) {
      setLinkSheet({ ...linkSheet, error: "링크는 https:// 로 시작해야 해요." });
      return;
    }
    const label = linkSheet.label.trim().replace(/[[\]]/g, "") || url;
    setLinkSheet(null);
    insertAtCursor(`[${label}](${url})`);
  }

  async function pickImage() {
    setError(null);
    // iOS PHPicker·Android Photo Picker 는 권한 요청 없이 열린다(avatar-field.tsx 와 같은 이유로
    // requestMediaLibraryPermissionsAsync 를 따로 부르지 않는다).
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // 본문 사진은 자르지 않는다(웹도 원본 비율 그대로 1600px 로 줄일 뿐이다).
      allowsEditing: false,
      // 1 미만이어야 두 플랫폼 다 JPEG 로 다시 구워 준다(HEIC 가 넘어오지 않게 — avatar-field.tsx).
      quality: 0.9,
      base64: true,
      exif: false,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    if (!asset?.base64) {
      setError("이미지를 선택해주세요.");
      return;
    }

    // 원본 검사 — 웹 uploadBoardImage 와 같은 함수·같은 문구(core boardImageUploadError). mimeType 이 비어
    // 오는 기기가 있어 JPEG 를 기본값으로 두고, fileSize 도 없으면 base64 길이에서 되계산한다.
    const invalid = boardImageUploadError({
      type: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? Math.floor((asset.base64.length * 3) / 4),
    });
    if (invalid) {
      setError(invalid);
      return;
    }

    setUploading(true);
    try {
      // 굽기(Skia)는 동기라 JS 스레드를 잡는다 — "올리는 중" 표시가 그려지도록 한 틱 양보한 뒤 굽는다.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const baked = bakeBoardImageWebp(asset.base64);
      const url = await upload.mutateAsync(baked.base64);
      // 이미지는 한 줄 전체여야 이미지다(rich-text-lite.ts). 커서 앞이 줄 중간이면 줄을 바꾸고, 뒤에는
      // 사진 아래로 이어서 쓸 빈 줄을 만든다(웹이 <img> 뒤에 <p><br></p> 를 붙이는 것과 같은 이유).
      const { start } = selectionRef.current;
      const before = valueRef.current.slice(0, start);
      const needsBreak = before.length > 0 && !before.endsWith("\n");
      insertAtCursor(`${needsBreak ? "\n" : ""}![](${url})\n`);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: nextPath });
      // 401·426 은 화면 이동으로 끝난 것이라 여기서 또 알리지 않는다.
      if (!handled.redirected) setError(handled.message || UPLOAD_FALLBACK);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View className="overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700">
      <BoardEditorToolbar
        onMark={wrapWithMark}
        onPrefix={togglePrefix}
        onLink={openLinkSheet}
        onImage={() => void pickImage()}
        onTogglePreview={() => setPreview((v) => !v)}
        preview={preview}
        uploading={uploading}
        disabled={!!locked}
      />

      {locked ? (
        <View>
          <View className="border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
            <AppText variant="xs" className="text-amber-800 dark:text-amber-200" pretty>
              {locked.message}
            </AppText>
          </View>
          <RichTextContent html={locked.html} className="min-h-72 px-4 py-4" />
        </View>
      ) : preview ? (
        previewHtml ? (
          <RichTextContent html={previewHtml} className="min-h-72 px-4 py-4" />
        ) : (
          <View className="min-h-72 px-4 py-4">
            <AppText variant="sm" className="text-zinc-400 dark:text-zinc-500">
              미리볼 내용이 없어요.
            </AppText>
          </View>
        )
      ) : (
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onSelectionChange={onSelectionChange}
          selection={forcedSelection}
          multiline
          textAlignVertical="top"
          // 바깥 Screen 의 ScrollView 가 스크롤한다 — 안쪽에서도 스크롤하면 손가락이 어디를 끄는지 모른다.
          scrollEnabled={false}
          placeholder={placeholder}
          placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
          accessibilityLabel="본문"
          maxFontSizeMultiplier={1.3}
          // 웹 `.board-content min-h-72 px-4 py-4 text-[15px] leading-7`.
          className="min-h-72 px-4 py-4 text-[15px] text-zinc-900 dark:text-zinc-100"
          style={{ lineHeight: 28 }}
        />
      )}

      {error && (
        <View className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <AppText variant="xs" accessibilityRole="alert" className="text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        </View>
      )}

      {/* 링크 시트 — 웹의 window.prompt 자리. 주소와(선택한 글자가 없을 때) 표시할 글자를 받는다. */}
      <Sheet visible={linkSheet !== null} onClose={() => setLinkSheet(null)} title="링크 넣기" compactHeader showHandle={false}>
        {linkSheet && (
          <View className="gap-3 px-4 pb-6 pt-3">
            <View className="gap-1">
              <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" nativeID="board-link-url-label">
                링크 주소
              </AppText>
              <Input
                value={linkSheet.url}
                onChangeText={(url) => setLinkSheet({ ...linkSheet, url, error: null })}
                placeholder="https://"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                accessibilityLabelledBy="board-link-url-label"
              />
            </View>
            <View className="gap-1">
              <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" nativeID="board-link-label-label">
                표시할 글자 (비우면 주소 그대로)
              </AppText>
              <Input
                value={linkSheet.label}
                onChangeText={(label) => setLinkSheet({ ...linkSheet, label })}
                placeholder="링크 글자"
                accessibilityLabelledBy="board-link-label-label"
              />
            </View>
            {linkSheet.error && (
              <AppText variant="xs" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
                {linkSheet.error}
              </AppText>
            )}
            <View className="flex-row justify-end gap-2">
              <Button
                variant="outline"
                label="취소"
                onPress={() => setLinkSheet(null)}
                className="rounded-xl px-4 py-2.5"
                textClassName="font-medium text-zinc-600 dark:text-zinc-300"
              />
              <Button label="넣기" onPress={confirmLink} className="rounded-xl px-6 py-2.5" />
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}
