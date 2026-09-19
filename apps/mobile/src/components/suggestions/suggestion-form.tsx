import { SUGGESTION_CONTENT_MAX, SUGGESTION_TITLE_MAX } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Check, Lock, Pin } from "lucide-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Input } from "../input";
import { handleEdgeError } from "../../lib/edge";
import { useCreateSuggestion, useUpdateSuggestion } from "../../queries/suggestions";
import { themedIcon } from "../../theme/icons";

// 건의 작성/수정 폼(웹 suggestion-form.tsx 1:1). 새 글과 수정이 같은 컴포넌트인 이유는 입력 항목이 완전히
// 같아서다 — 따로 두면 "수정 화면에만 비밀글 체크박스가 빠진" 식으로 갈라진다.
//
// isAdmin 이 false 면 고정 체크박스 자체를 그리지 않는다 — 서버(EF suggestions)도 관리자 여부를 다시
// 검사하지만(canPinSuggestion), 화면에서부터 안 보여야 "체크할 수 있을 것처럼 보이는데 눌러도 안 먹는"
// 혼란이 없다.
//
// 본문은 평문이다(웹 textarea·`whitespace-pre-wrap`) — 게시판의 BoardEditor 를 쓰지 않는다. 검증(제목 100자·
// 내용 2000자·비속어)은 규칙(core rules/suggestions.ts)에 있고 여기서는 maxLength 로 길이만 미리 막는다(웹
// input/textarea 의 maxLength 자리).
const PinIcon = themedIcon(Pin);
const LockIcon = themedIcon(Lock);
const CheckIcon = themedIcon(Check);

export function SuggestionForm({
  suggestion,
  isAdmin = false,
}: {
  suggestion?: {
    id: string;
    title: string;
    content: string;
    isSecret: boolean;
    isPinned: boolean;
  };
  isAdmin?: boolean;
}) {
  const create = useCreateSuggestion();
  const update = useUpdateSuggestion();
  const pending = create.isPending || update.isPending;
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(suggestion?.title ?? "");
  const [content, setContent] = useState(suggestion?.content ?? "");
  const [isSecret, setIsSecret] = useState(suggestion?.isSecret ?? false);
  const [isPinned, setIsPinned] = useState(suggestion?.isPinned ?? false);

  const editing = suggestion !== undefined;
  const backHref = (editing ? `/suggestions/${suggestion.id}` : "/suggestions") as Href;
  const nextPath = editing ? `/suggestions/${suggestion.id}/edit` : "/suggestions/new";

  function cancel() {
    // 웹 취소는 링크(원글 또는 목록). 모달 위라 뒤로가기로 닫는다 — 딥링크로 바로 열려 아래가 없으면 그 주소로.
    if (router.canGoBack()) router.back();
    else router.replace(backHref);
  }

  async function submit() {
    if (pending) return;
    setError(null);
    try {
      const result = editing
        ? await update.mutateAsync({ action: "update", id: suggestion.id, title, content, isSecret, isPinned })
        : await create.mutateAsync({ action: "create", title, content, isSecret, isPinned });
      // 등록/수정한 글을 바로 보여준다(웹 router.replace(`/suggestions/${result.id}`)). 모달 위에서는 dismissTo
      // 로 모달을 닫으며 간다: 수정이면 아래에 있는 상세로 돌아가고(무효화로 새로 온다), 새 글이면 상세를
      // 새로 연다(게시판 board-form.tsx 와 같은 흐름).
      router.dismissTo(`/suggestions/${result.id}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: nextPath });
      // 401·426 은 화면 이동으로 끝난 것이라 여기서 또 알리지 않는다.
      if (!handled.redirected) setError(handled.message);
    }
  }

  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <AppText variant="sm" weight="medium" nativeID="suggestion-title">
          제목
        </AppText>
        <Input
          value={title}
          onChangeText={setTitle}
          maxLength={SUGGESTION_TITLE_MAX}
          accessibilityLabel="제목"
          accessibilityLabelledBy="suggestion-title"
        />
      </View>

      <View className="gap-1.5">
        <AppText variant="sm" weight="medium" nativeID="suggestion-content">
          내용
        </AppText>
        {/* 웹 textarea rows=10(≈ 10줄 × 20px + 여백) — 폰에서도 열 줄쯤 보이게 min-h 로 맞춘다. */}
        <TextInput
          value={content}
          onChangeText={setContent}
          maxLength={SUGGESTION_CONTENT_MAX}
          placeholder="어떤 점이 불편했는지, 무엇이 있으면 좋을지 편하게 적어주세요."
          placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
          multiline
          numberOfLines={10}
          textAlignVertical="top"
          maxFontSizeMultiplier={1.3}
          accessibilityLabel="내용"
          accessibilityLabelledBy="suggestion-content"
          className="min-h-[216px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-5 text-zinc-900 focus:border-[#12b382] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <AppText variant="xs" className="self-end text-zinc-400 dark:text-zinc-500" tabular>
          {content.length}/{SUGGESTION_CONTENT_MAX}
        </AppText>
      </View>

      {isAdmin && (
        <OptionCard
          checked={isPinned}
          onToggle={() => {
            const checked = !isPinned;
            setIsPinned(checked);
            // 공지는 성격상 비밀글일 이유가 없다 — 켜는 순간 비밀글 체크를 같이 끈다.
            if (checked) setIsSecret(false);
          }}
          tone="amber"
          icon={<PinIcon size={14} colorClassName="text-amber-600 dark:text-amber-400" />}
          title="공지로 상단 고정 (운영자)"
          description="체크하면 목록 맨 위에 항상 고정돼요. 공지는 비밀글로 둘 수 없어요."
        />
      )}

      {/* 비밀글 — 이 게시판의 핵심 옵션이라 체크박스를 눈에 띄는 카드로 둔다.
          공지로 고정하면 비밀글일 수 없으므로 그동안은 비활성화한다. */}
      <OptionCard
        checked={isSecret}
        onToggle={() => setIsSecret((v) => !v)}
        disabled={isPinned}
        tone="blue"
        icon={<LockIcon size={14} colorClassName="text-blue-600 dark:text-blue-400" />}
        title="비밀글로 작성"
        description="체크하면 제목과 내용을 나와 운영자만 볼 수 있어요. 결제·계정처럼 남에게 보이면 곤란한 내용은 비밀글로 남겨주세요."
      />

      {error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      <View className="flex-row items-center justify-end gap-2">
        <Button variant="outline" label="취소" onPress={cancel} disabled={pending} />
        <Button label={pending ? "저장 중..." : editing ? "수정하기" : "등록하기"} pending={pending} onPress={submit} className="px-5" />
      </View>
    </View>
  );
}

// 체크박스 카드(웹 `<label>` + `has-checked:` 스타일). RN 에는 has-checked 가 없어 checked 로 클래스를 가른다.
// 색은 웹과 같이 고정(공지)은 호박색, 비밀글은 파랑.
function OptionCard({
  checked,
  onToggle,
  disabled = false,
  tone,
  icon,
  title,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tone: "amber" | "blue";
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const checkedBorder =
    tone === "amber"
      ? "border-amber-400 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
      : "border-blue-400 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/25";
  const boxChecked = tone === "amber" ? "border-amber-600 bg-amber-600" : "border-blue-600 bg-blue-600";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      className={[
        "flex-row items-start gap-3 rounded-xl border px-3.5 py-3",
        checked ? checkedBorder : "border-zinc-200 dark:border-zinc-700",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      <View
        className={[
          "mt-0.5 h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
          checked ? boxChecked : "border-zinc-400 dark:border-zinc-500",
        ].join(" ")}
      >
        {checked && <CheckIcon size={12} colorClassName="text-white" strokeWidth={3} />}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          {icon}
          <AppText variant="sm" weight="semibold">
            {title}
          </AppText>
        </View>
        <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-400" pretty>
          {description}
        </AppText>
      </View>
    </Pressable>
  );
}
