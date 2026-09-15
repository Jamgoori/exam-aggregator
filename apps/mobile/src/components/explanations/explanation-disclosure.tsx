import type { QuestionExplanationContent } from "@gongmoa/core";
import { ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ExplanationBody } from "./explanation-body";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

const ChevronIcon = themedIcon(ChevronRight);

// 접혀 있는 "해설 보기"(웹 explanation-disclosure.tsx, 설계서 §4.5 #24): 토글 `text-sm font-medium
// text-blue-600` + ChevronRight 14(펼치면 rotate-90). **펼칠 때만 본문을 렌더**한다 — 문항이
// 수십~수백 개인 목록에서 안 볼지도 모르는 해설을 매번 통째로 만들지 않기 위해서다.
export function ExplanationDisclosure({
  explanation,
  correctChoice,
  // 세트문제(카드에 해설 여러 개)는 몇 번 해설인지 라벨이 필요하다.
  questionNumber,
  showNumber,
  // 전체 해설 페이지는 열람이 목적이라 펼친 채로 시작한다(웹 <details open>).
  defaultOpen = false,
}: {
  explanation: QuestionExplanationContent;
  correctChoice: number | null;
  questionNumber: number;
  showNumber: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-1 py-0.5"
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ChevronIcon size={14} colorClassName="text-blue-600 dark:text-blue-400" />
        </View>
        <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
          {showNumber ? `${questionNumber}번 해설 보기` : "해설 보기"}
        </AppText>
      </Pressable>
      {open && <ExplanationBody explanation={explanation} correctChoice={correctChoice} />}
    </View>
  );
}
