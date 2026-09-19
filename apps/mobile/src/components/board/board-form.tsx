import {
  BOARD_CATEGORIES,
  BOARD_TITLE_MAX,
  boardImageOrigin,
  composeRichText,
  decomposeRichText,
  sanitizeRichText,
  validateBoardPostInput,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Check } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { BoardEditor } from "./board-editor";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Chip } from "../chips";
import { Input } from "../input";
import { handleEdgeError } from "../../lib/edge";
import { SUPABASE_URL } from "../../lib/supabase";
import { useCreateBoardPost, useDeleteBoardPost, useUpdateBoardPost } from "../../queries/board-write";
import { themedIcon } from "../../theme/icons";

// 글쓰기·수정 공용 폼(웹 components/board-form.tsx 1:1). 두 화면이 다른 것은 "처음 값이 있는가"와 부르는
// 뮤테이션뿐이라 폼을 둘로 나누지 않는다(나누면 에디터 설정이 두 곳에서 어긋난다).
//
// 웹과 다른 곳:
//   · 말머리 <select> → 칩(Chip). 폰에서 네이티브 select 는 없고 선택지가 넷이라 한 줄에 다 들어간다.
//   · 본문 값은 HTML 이 아니라 lite 마크업(core rich-text-lite.ts)이고, 제출 직전에 composeRichText →
//     sanitizeRichText → validateBoardPostInput(서버와 같은 함수·문구)으로 **먼저 거른다** — 서버(EF)가
//     다시 같은 검사를 하지만, 굳이 올려보내고 거절당하면 데이터만 쓴다.
//   · 수정 화면에서 저장된 HTML 이 lite 부분집합 밖(웹 리치 에디터로만 만들 수 있는 서식)이면 에디터를
//     **잠그고 삭제만 허용**한다. 대안은 되돌릴 수 있는 만큼만 되돌려 나머지 서식을 조용히 날리는 것인데,
//     사용자는 "수정"을 눌렀을 뿐 색·크기·정렬을 지우겠다고 한 적이 없다 — 웹에서 고치라고 말하는 쪽이 낫다.
//     웹 에디터가 만드는 div 문단·루트 텍스트·<span style> 굵게 같은 "모양만 다른" 평문은 decomposeRichText 가
//     정규화해 되돌리므로(rich-text-lite.ts 머리말) 잠기지 않는다 — 앱에서 저장하면 div 가 p 로 바뀌지만 웹
//     .board-content p 가 여백 0 이라 화면은 같다.
//   · 뒤로가기 확인은 넣지 않았다 — 웹 board-form.tsx 에 beforeunload 가 없다. 임시저장도 웹에 없어 없다.

const CheckIcon = themedIcon(Check);

// 수정 화면 잠금 문구. 평문·굵게·목록·인용·링크·이미지만 든 웹 글은 이제 열리고, 잠기는 것은 앱 편집기에
// 없는 서식(크기·색·정렬·구분선·제목·코드·중첩 목록 등)이 실제로 든 글뿐이라 그 사실을 그대로 적는다 —
// "웹에서 쓴 글은" 이라고 하면 열리는 웹 글과 어긋난다.
const LOCKED_MESSAGE =
  "크기·색·구분선·제목 등 앱 편집기에 없는 서식이 있어 앱에서는 수정할 수 없어요. 웹(gongmoa.kr)에서 수정해주세요.";

export function BoardForm({
  mode,
  postId,
  isAdmin = false,
  initial,
}: {
  mode: "create" | "edit";
  postId?: string;
  isAdmin?: boolean;
  initial?: {
    title: string;
    category: string;
    contentHtml: string;
    isPinned: boolean;
  };
}) {
  // 본문 이미지 접두사. compose·미리보기 새니타이즈·제출 새니타이즈가 전부 같은 값을 써야 같은 결과다.
  const imageOrigins = useMemo(() => [boardImageOrigin(SUPABASE_URL)], []);
  // 저장된 HTML → lite. 부분집합 밖이면 unsupported(잠금).
  const decomposed = useMemo(
    () => (initial ? decomposeRichText(initial.contentHtml, { imageOrigins }) : { lite: "" }),
    [initial, imageOrigins],
  );
  const locked = "unsupported" in decomposed && initial ? { html: initial.contentHtml, message: LOCKED_MESSAGE } : null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "free");
  const [lite, setLite] = useState("lite" in decomposed ? decomposed.lite : "");
  const [isPinned, setIsPinned] = useState(initial?.isPinned ?? false);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateBoardPost();
  const update = useUpdateBoardPost();
  const remove = useDeleteBoardPost();
  const pending = create.isPending || update.isPending;

  const backHref = (mode === "edit" && postId ? `/board/${postId}` : "/board") as Href;
  const nextPath = mode === "edit" && postId ? `/board/${postId}/edit` : "/board/new";

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace(backHref);
  }

  async function submit() {
    if (pending || locked) return;
    setError(null);
    // 순서는 서버와 같다: 새니타이즈 → 검증. 검증을 원본에 대고 하면 "검사에 통과한 것과 저장된 것이 다른"
    // 틈이 생긴다(docs/agents/board-rich-text.md §1).
    const sanitized = sanitizeRichText(composeRichText(lite, { imageOrigins }), { imageOrigins });
    const checked = validateBoardPostInput({ title, category, sanitizedHtml: sanitized });
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    try {
      const input = { title, category, contentHtml: sanitized, isPinned };
      const result =
        mode === "edit" && postId ? await update.mutateAsync({ id: postId, ...input }) : await create.mutateAsync(input);
      // 등록·수정 뒤에는 쓴 글로 곧장 보낸다(웹 router.push(`/board/${id}`)) — 목록으로 보내면 "내 글이
      // 올라갔나"를 눈으로 찾게 만든다. 모달 위에서는 dismissTo 로 모달을 닫으며 간다: 수정이면 아래에 있는
      // 상세로 돌아가고(무효화로 새로 온다), 새 글이면 상세를 새로 연다.
      router.dismissTo(`/board/${result.id}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: nextPath });
      // 401·426 은 화면 이동으로 끝난 것이라 여기서 또 알리지 않는다.
      if (!handled.redirected) setError(handled.message);
    }
  }

  // 잠긴 글의 유일한 동작. 문구·흐름은 웹 board-post-actions.tsx 의 삭제 버튼과 같다.
  function confirmDelete() {
    if (!postId || remove.isPending) return;
    Alert.alert("이 글을 삭제할까요? 되돌릴 수 없어요.", undefined, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          setError(null);
          remove
            .mutateAsync({ id: postId })
            .then(() => router.dismissTo("/board" as Href))
            .catch(async (e) => {
              const handled = await handleEdgeError(e, { next: nextPath });
              if (!handled.redirected) setError(handled.message);
            });
        },
      },
    ]);
  }

  return (
    <View className="gap-4">
      {/* 웹 `flex-col gap-2 sm:flex-row` — 폰 폭이라 세로. */}
      <View className="gap-2">
        <View className="flex-row flex-wrap gap-2" accessibilityLabel="말머리">
          {BOARD_CATEGORIES.map((c) => (
            <Chip key={c.slug} label={c.label} active={category === c.slug} disabled={!!locked} onPress={() => setCategory(c.slug)} />
          ))}
        </View>
        <Input
          value={title}
          onChangeText={setTitle}
          placeholder="제목을 입력하세요"
          maxLength={BOARD_TITLE_MAX}
          editable={!locked}
          accessibilityLabel="제목"
          className="rounded-xl px-4 py-2.5"
        />
      </View>

      <BoardEditor
        value={lite}
        onChange={setLite}
        imageOrigins={imageOrigins}
        placeholder="자유롭게 이야기를 남겨주세요. 사진도 넣을 수 있어요."
        locked={locked}
        nextPath={nextPath}
      />

      {isAdmin && !locked && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isPinned }}
          onPress={() => setIsPinned((v) => !v)}
          className="flex-row items-center gap-2 self-start"
        >
          <View
            className={[
              "h-4 w-4 items-center justify-center rounded-sm border",
              isPinned ? "border-blue-600 bg-blue-600" : "border-zinc-400 dark:border-zinc-500",
            ].join(" ")}
          >
            {isPinned && <CheckIcon size={12} colorClassName="text-white" strokeWidth={3} />}
          </View>
          <AppText variant="sm" className="text-zinc-600 dark:text-zinc-300">
            목록 맨 위에 고정 (공지)
          </AppText>
        </Pressable>
      )}

      {error && (
        <View className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        </View>
      )}

      <View className="flex-row items-center justify-end gap-2">
        <Button
          variant="outline"
          label="취소"
          onPress={goBack}
          className="rounded-xl border-zinc-200 px-4 py-2.5 dark:border-zinc-700"
          textClassName="font-medium text-zinc-600 dark:text-zinc-300"
        />
        {locked ? (
          <Button
            variant="danger"
            label={remove.isPending ? "삭제 중…" : "삭제"}
            disabled={remove.isPending}
            onPress={confirmDelete}
            className="rounded-xl px-6 py-2.5"
          />
        ) : (
          <Button
            label={pending ? "올리는 중…" : mode === "edit" ? "수정하기" : "등록하기"}
            disabled={pending}
            onPress={() => void submit()}
            className="rounded-xl px-6 py-2.5"
          />
        )}
      </View>

      <AppText variant="11" className="text-zinc-400 dark:text-zinc-500" pretty>
        욕설·비방·개인정보가 담긴 글은 예고 없이 삭제될 수 있어요.
      </AppText>
    </View>
  );
}
