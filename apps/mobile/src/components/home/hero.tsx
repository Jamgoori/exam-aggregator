import { router, type Href } from "expo-router";
import { ArrowRight, Check } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { TodayStudy } from "./today-study";
import { AppText } from "../app-text";
import { palette } from "../../theme";

// 히어로(웹 page.tsx Hero). 배경 `bg-[#e7f2fc]/45`(다크 `zinc-900/60`), lg 미만은 한 열이라
// 글을 가운데로 모으고 그 아래 오늘의 학습 현황 카드가 온다. 홈만의 팔레트(남색 primary +
// 초록 accent) — 값은 theme palette.navy / palette.brand.
const CHECKS = ["무료로 시작", "기출·정답은 로그인 없이 열람", "구글·카카오 1초 로그인"];

export function Hero() {
  return (
    <View className="overflow-hidden border-b border-zinc-200 bg-[#e7f2fc]/45 dark:border-zinc-800 dark:bg-zinc-900/60">
      <View className="gap-12 px-4 py-8">
        <View className="items-center">
          <AppText
            variant="4xl"
            weight="bold"
            accessibilityRole="header"
            className="max-w-xl text-center text-zinc-900 dark:text-zinc-50"
            style={{ letterSpacing: -1.44 }}
            pretty
          >
            합격에 필요한 모든 것,{"\n"}
            <AppText variant="4xl" weight="bold" className="text-[#12b382]" style={{ letterSpacing: -1.44 }}>
              공모아
            </AppText>
            에서 시작하세요.
          </AppText>
          <AppText variant="base" className="mt-6 max-w-lg text-center leading-7 text-zinc-600 dark:text-zinc-400" pretty>
            공무원 기출문제를 온라인으로 풀고 바로 채점하세요.{"\n"}
            틀린 문제는 오답노트에 자동으로 쌓이고, AI가 왜 틀리는지 개념 단위로 진단해 드립니다.
          </AppText>
          <View className="mt-9 w-full gap-3">
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push("/papers" as Href)}
              className="flex-row items-center justify-center gap-2 rounded-lg bg-[#012854] px-5 py-3.5 shadow-lg shadow-[#012854]/15 active:opacity-90 dark:bg-[#0a7d5b] dark:shadow-black/30"
            >
              <AppText variant="sm" weight="bold" className="text-white">
                기출문제 풀러가기
              </AppText>
              <ArrowRight size={16} color={palette.white} />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push("/diagnosis" as Href)}
              className="flex-row items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 py-3.5 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:active:bg-zinc-800"
            >
              <AppText variant="sm" weight="bold" className="text-zinc-900 dark:text-zinc-100">
                AI 약점진단 알아보기
              </AppText>
            </Pressable>
          </View>
          <View className="mt-10 flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {CHECKS.map((label) => (
              <View key={label} className="flex-row items-center gap-1.5">
                <Check size={14} color={palette.brand} />
                <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
                  {label}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        {/* 회원이면 진짜 내 숫자, 아니면 예시(예시 화면 표기). 도착 전에는 같은 크기의 뼈대. */}
        <TodayStudy />
      </View>
    </View>
  );
}
