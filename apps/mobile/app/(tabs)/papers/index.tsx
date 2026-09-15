import { useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { PapersBrowser } from "../../../src/components/papers/papers-browser";

// `/papers?q&level&type&fav&page`(설계서 §5 행) — 웹 app/papers/page.tsx + exam-browser.tsx.
// 이미 이 탭에 있는 상태에서 "기출문제" 탭을 다시 누르면 1페이지로(웹 gongmoa:browser-reset).
export default function PapersScreen() {
  const navigation = useNavigation();
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    // 탭 재탭만 잡는다 — 다른 탭에서 넘어올 때(포커스 전)는 보던 페이지를 유지한다.
    const unsubscribe = (navigation as unknown as {
      addListener: (event: "tabPress", cb: () => void) => () => void;
      isFocused: () => boolean;
    }).addListener("tabPress", () => {
      if (navigation.isFocused()) setResetSignal((n) => n + 1);
    });
    return unsubscribe;
  }, [navigation]);

  return <PapersBrowser resetSignal={resetSignal} />;
}
