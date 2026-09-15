import { FREE_EXPLANATION_DAILY_PAPERS } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Check, Minus } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 무료/멤버십 비교표(웹 membership/page.tsx FEATURE_ROWS:287·FeatureTable:313, 설계서 §8.1).
// 여기 적힌 것이 실제 동작과 어긋나면 그 자체로 허위 표시가 되므로, 줄을 고칠 때는 반드시
// 대응하는 게이팅(§8.3 표)도 함께 확인할 것. href 를 준 줄은 기능 이름이 상세 안내로 가는 링크.
export const FEATURE_ROWS: { label: string; free: string | boolean; premium: string | boolean; href?: string }[] = [
  { label: "기출문제·정답 열람", free: true, premium: true },
  { label: "문제지 PDF 다운로드", free: true, premium: true },
  { label: "CBT 온라인 풀이·채점", free: true, premium: true },
  { label: "댓글·난이도 평가·북마크", free: true, premium: true },
  { label: "문제지 해설 열람", free: `하루 ${FREE_EXPLANATION_DAILY_PAPERS}개`, premium: "제한 없음" },
  { label: "오답노트 (모아보기·메모·다시 풀기)", free: true, premium: true },
  { label: "오답노트 안에서 문항 해설 보기", free: false, premium: true },
  { label: "회독별 다른 회원 평균 점수", free: false, premium: true },
  { label: "오늘의 복습 (간격 반복 일정)", free: false, premium: true },
  { label: "AI 약점 진단", free: false, premium: true, href: "/diagnosis" },
];

const CheckIcon = themedIcon(Check);
const MinusIcon = themedIcon(Minus);

// 좁은 화면에서 가로 스크롤이 생기지 않게: 값 칸만 고정폭(무료 4.5rem / 멤버십 5rem), 기능 이름은
// 남는 폭을 쓰며 접는다.
export function FeatureTable({ rows = FEATURE_ROWS }: { rows?: typeof FEATURE_ROWS }) {
  return (
    <View accessibilityRole="none">
      <View className="flex-row items-center border-b border-zinc-200 dark:border-zinc-700">
        <AppText variant="xs" weight="medium" className="flex-1 py-3 text-zinc-500 dark:text-zinc-500">
          기능
        </AppText>
        <AppText variant="xs" weight="medium" className="w-[4.5rem] py-3 text-center text-zinc-500 dark:text-zinc-500">
          무료
        </AppText>
        <AppText variant="xs" weight="bold" className="w-[5rem] py-3 text-center text-blue-600 dark:text-blue-400">
          멤버십
        </AppText>
      </View>
      {rows.map((row, i) => (
        <View
          key={row.label}
          className={["flex-row items-center", i < rows.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : ""].join(" ")}
        >
          <View className="flex-1 py-3 pr-2">
            {row.href ? (
              <Pressable accessibilityRole="link" onPress={() => router.push(row.href as Href)} hitSlop={4} className="self-start">
                <AppText variant="xs" weight="semibold" className="text-blue-700 underline dark:text-blue-400" pretty>
                  {row.label}
                </AppText>
              </Pressable>
            ) : (
              <AppText variant="xs" className="text-zinc-700 dark:text-zinc-300" pretty>
                {row.label}
              </AppText>
            )}
          </View>
          <View className="w-[4.5rem] items-center px-1 py-3">
            <Cell value={row.free} />
          </View>
          <View className="w-[5rem] items-center bg-blue-50/40 px-1 py-3 dark:bg-blue-950/20">
            <Cell value={row.premium} highlight />
          </View>
        </View>
      ))}
    </View>
  );
}

function Cell({ value, highlight }: { value: string | boolean; highlight?: boolean }) {
  if (value === true) {
    return <CheckIcon size={17} accessibilityLabel="제공" colorClassName={highlight ? "text-blue-600 dark:text-blue-400" : "text-emerald-500"} />;
  }
  if (value === false) {
    return <MinusIcon size={17} accessibilityLabel="제공 안 함" colorClassName="text-zinc-300 dark:text-zinc-700" />;
  }
  return (
    <AppText
      variant="11"
      weight="medium"
      className={["text-center", highlight ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400"].join(" ")}
      pretty
    >
      {value}
    </AppText>
  );
}
