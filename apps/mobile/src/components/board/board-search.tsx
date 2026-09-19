import { Search, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { themedIcon } from "../../theme/icons";

// 자유게시판 검색창(웹 board-search.tsx 1:1).
//
// 입력할 때마다 서버를 왕복하지 않는다(디바운스도 없다) — 제출했을 때만 주소를 바꾼다. 게시판 검색은
// "생각하고 한 번 누르는" 동작이라, 글자마다 목록이 흔들리면 오히려 읽기 어렵다. 지우기(X)는 웹처럼
// 곧바로 빈 검색으로 되돌린다.
const SearchIcon = themedIcon(Search);
const ClearIcon = themedIcon(X);

export function BoardSearch({
  initialQuery,
  onSubmit,
  className,
}: {
  initialQuery: string;
  // 다듬은(trim) 검색어. 빈 문자열 = 검색 해제.
  onSubmit: (query: string) => void;
  className?: string;
}) {
  const [value, setValue] = useState(initialQuery);
  // 주소가 바깥에서 바뀌면(탭 전환으로 q 가 지워지는 등) 입력값을 따라가게 한다 — 렌더 중 "prop 변화에
  // 상태 맞추기"(효과 안 setState 없음).
  const [seen, setSeen] = useState(initialQuery);
  if (seen !== initialQuery) {
    setSeen(initialQuery);
    setValue(initialQuery);
  }

  return (
    <View className={["relative flex-1", className ?? ""].join(" ")}>
      <View pointerEvents="none" className="absolute top-0 bottom-0 left-3 z-10 justify-center">
        <SearchIcon size={16} colorClassName="text-zinc-400" />
      </View>
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={() => onSubmit(value.trim())}
        returnKeyType="search"
        placeholder="제목·내용 검색"
        placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
        accessibilityLabel="게시글 검색"
        autoCorrect={false}
        maxFontSizeMultiplier={1.3}
        className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pr-9 pl-9 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {value ? (
        <View className="absolute top-0 right-2 bottom-0 justify-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
            onPress={() => {
              setValue("");
              onSubmit("");
            }}
            className="h-6 w-6 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
          >
            <ClearIcon size={14} colorClassName="text-zinc-400" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
