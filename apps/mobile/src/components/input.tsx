import { Search } from "lucide-react-native";
import { forwardRef } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { themedIcon } from "../theme/icons";

// 입력(설계서 §4.5 #6). `rounded-lg border-zinc-300 px-3 py-2 text-sm`, 포커스 테두리는 브랜드
// 초록(웹 globals.css input:focus). Android 는 includeFontPadding 이 없어 lineHeight 로만 맞춘다.
export const Input = forwardRef<TextInput, TextInputProps>(function Input({ className, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      {...rest}
      maxFontSizeMultiplier={1.3}
      placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
      className={[
        "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-5 text-zinc-900 focus:border-[#12b382] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        className ?? "",
      ].join(" ")}
    />
  );
});

const SearchIcon = themedIcon(Search);

// 알약형 검색 입력(목록 상단).
export const PillSearch = forwardRef<TextInput, TextInputProps>(function PillSearch({ className, ...rest }, ref) {
  return (
    <View
      className={[
        "flex-row items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900",
        className ?? "",
      ].join(" ")}
    >
      <SearchIcon size={16} colorClassName="text-zinc-400" />
      <TextInput
        ref={ref}
        returnKeyType="search"
        {...rest}
        maxFontSizeMultiplier={1.3}
        placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
        className="flex-1 p-0 text-sm leading-5 text-zinc-900 dark:text-zinc-100"
      />
    </View>
  );
});
