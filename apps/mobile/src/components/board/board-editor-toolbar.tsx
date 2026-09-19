import type { RichTextLinePrefix, RichTextLiteMark } from "@gongmoa/core";
import {
  Bold,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 글쓰기 에디터 툴바 — 웹 rich-text-editor.tsx 툴바의 **축소판**(설계서 #31: 굵게/기울임/밑줄/취소선/
// 목록/인용/링크/이미지). 웹에 있는 글자 크기·글자 색·정렬·구분선·되돌리기는 없다 — 앱 에디터가
// contenteditable 이 아니라 마크업(core rich-text-lite.ts)이라 그 서식을 표현할 자리가 없기 때문이다.
// 대신 웹에 없는 **미리보기** 토글이 오른쪽 끝에 있다(마크업 에디터는 쓰는 모습과 올린 뒤 모습이 달라
// 확인할 자리가 필요하다).
//
// 버튼 치수·색은 웹 ToolbarButton 그대로: h-8 w-8 rounded-lg, 아이콘 15, 활성 bg-blue-100 text-blue-700
// (다크 bg-blue-950/60 text-blue-300), 비활성 text-zinc-500(다크 text-zinc-400). hover 는 없다.

export type BoardEditorToolbarProps = {
  onMark: (mark: RichTextLiteMark) => void;
  onPrefix: (prefix: RichTextLinePrefix) => void;
  onLink: () => void;
  onImage: () => void;
  onTogglePreview: () => void;
  preview: boolean;
  uploading: boolean;
  disabled?: boolean;
};

// 렌더마다 themedIcon 을 새로 만들지 않게 모듈에서 한 번 감싼다.
const ICONS = {
  bold: themedIcon(Bold),
  italic: themedIcon(Italic),
  underline: themedIcon(Underline),
  strike: themedIcon(Strikethrough),
  bullet: themedIcon(List),
  ordered: themedIcon(ListOrdered),
  quote: themedIcon(Quote),
  link: themedIcon(Link2),
  image: themedIcon(ImageIcon),
  eye: themedIcon(Eye),
  eyeOff: themedIcon(EyeOff),
} as const;
type IconName = keyof typeof ICONS;

function ToolbarButton({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = ICONS[icon];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      className={[
        "h-8 w-8 items-center justify-center rounded-lg",
        active ? "bg-blue-100 dark:bg-blue-950/60" : "active:bg-zinc-100 dark:active:bg-zinc-800",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      <Icon
        size={15}
        colorClassName={active ? "text-blue-700 dark:text-blue-300" : "text-zinc-500 dark:text-zinc-400"}
      />
    </Pressable>
  );
}

function Divider() {
  return <View className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;
}

export function BoardEditorToolbar({
  onMark,
  onPrefix,
  onLink,
  onImage,
  onTogglePreview,
  preview,
  uploading,
  disabled = false,
}: BoardEditorToolbarProps) {
  // 미리보기 중에는 본문을 고칠 수 없으니 서식 버튼도 함께 잠긴다(눌러도 어디에 들어가는지 안 보인다).
  const editDisabled = disabled || preview;
  return (
    <View className="flex-row flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50/80 px-1.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/50">
      <ToolbarButton icon="bold" label="굵게" disabled={editDisabled} onPress={() => onMark("bold")} />
      <ToolbarButton icon="italic" label="기울임" disabled={editDisabled} onPress={() => onMark("italic")} />
      <ToolbarButton icon="underline" label="밑줄" disabled={editDisabled} onPress={() => onMark("underline")} />
      <ToolbarButton icon="strike" label="취소선" disabled={editDisabled} onPress={() => onMark("strike")} />

      <Divider />

      <ToolbarButton icon="bullet" label="글머리 기호" disabled={editDisabled} onPress={() => onPrefix("bullet")} />
      <ToolbarButton icon="ordered" label="번호 매기기" disabled={editDisabled} onPress={() => onPrefix("ordered")} />
      <ToolbarButton icon="quote" label="인용" disabled={editDisabled} onPress={() => onPrefix("quote")} />

      <Divider />

      <ToolbarButton icon="link" label="링크" disabled={editDisabled} onPress={onLink} />
      <ToolbarButton icon="image" label="사진" disabled={editDisabled || uploading} onPress={onImage} />

      <View className="ml-auto flex-row items-center gap-0.5">
        {uploading && (
          <AppText variant="11" className="mr-1 text-zinc-500 dark:text-zinc-400">
            사진 올리는 중…
          </AppText>
        )}
        <ToolbarButton
          icon={preview ? "eyeOff" : "eye"}
          label={preview ? "미리보기 닫기" : "미리보기"}
          active={preview}
          disabled={disabled}
          onPress={onTogglePreview}
        />
      </View>
    </View>
  );
}
