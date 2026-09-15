import { DIAGNOSIS_CYCLE_DAYS } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ArrowRight, BrainCircuit } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { palette } from "../../theme";

// AI 약점 진단(웹 page.tsx Diagnosis + WeaknessReportCard): 짙은 남색 판 + 약점 리포트 예시.
export function DiagnosisSection() {
  return (
    <View className="border-y border-zinc-200 bg-[#012854] dark:border-zinc-800">
      <View className="gap-10 px-4 py-14">
        <View>
          <AppText variant="sm" weight="bold" className="text-[#12b382]">
            AI WEAKNESS DIAGNOSIS
          </AppText>
          <AppText
            variant="26"
            weight="bold"
            accessibilityRole="header"
            className="mt-3 max-w-lg tracking-tight text-white"
            pretty
          >
            열심히만 하지 마세요.{"\n"}약점을 알면 합격이 빨라집니다.
          </AppText>
          <AppText variant="sm" className="mt-5 max-w-lg leading-6 text-white/70" pretty>
            온라인 응시와 복습에서 틀린 문항을 AI가 개념 단위로 다시 세우고, 내가 고른 오답 하나하나를
            근거로 “왜 그렇게 골랐는지 · 그래서 뭘 하면 되는지”를 써 드립니다.
          </AppText>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/diagnosis" as Href)}
            className="mt-7 flex-row items-center gap-2 self-start rounded-lg bg-[#12b382] px-5 py-3.5 active:opacity-90"
          >
            <AppText variant="sm" weight="bold" className="text-white">
              무료로 진단 시작하기
            </AppText>
            <ArrowRight size={16} color={palette.white} />
          </Pressable>
        </View>

        <WeaknessReportCard />
      </View>
    </View>
  );
}

// 진단 결과의 "취약 개념" 부분을 축약한 예시. 개념 이름은 개념 사전에 있는 실제 축(과목 ·
// keyword_title)의 모양을 따랐다. 숫자는 예시.
const ROWS: { subject: string; concept: string; note: string; pct: number; weak: boolean }[] = [
  { subject: "행정법총론", concept: "행정행위의 효력", note: "주의 필요", pct: 38, weak: true },
  { subject: "영어", concept: "어휘·숙어", note: "보완 중", pct: 58, weak: false },
  { subject: "국어", concept: "문법", note: "안정적", pct: 82, weak: false },
];

function WeaknessReportCard() {
  return (
    <View
      className="relative rounded-2xl border border-white/15 bg-white/5 p-5"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 예시임을 카드 위에 박아 둔다 — 실제 내 리포트로 오해하고 나가는 일이 없게. */}
      <View className="absolute right-4 top-4 rounded-full border border-white/25 bg-white/10 px-2 py-0.5">
        <AppText variant="10" weight="bold" allowFontScaling={false} className="tracking-wide text-white/80">
          예시 화면
        </AppText>
      </View>
      <View className="flex-row items-center gap-3 border-b border-white/10 pb-4 pr-16">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#12b382]">
          <BrainCircuit size={18} color={palette.white} />
        </View>
        <View>
          <AppText variant="sm" weight="bold" className="text-white">
            나의 약점 리포트
          </AppText>
          <AppText variant="xs" className="text-white/55">
            최근 {DIAGNOSIS_CYCLE_DAYS}일 오답 기준 · 개념별 정답률
          </AppText>
        </View>
      </View>
      <View className="gap-4 pt-5">
        {ROWS.map((r) => (
          <View key={r.concept} className="flex-row items-center gap-3">
            <AppText variant="xs" className="w-20 shrink-0 text-white/70">
              {r.subject}
            </AppText>
            <View className="flex-1">
              <View className="mb-1.5 flex-row justify-between">
                <AppText variant="11" weight="medium" className="text-white">
                  {r.concept}
                </AppText>
                <AppText variant="11" className="text-white/50">
                  {r.note}
                </AppText>
              </View>
              <View className="h-2 rounded-full bg-white/10">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${r.pct}%`, backgroundColor: r.weak ? palette.brand : "rgba(255,255,255,0.5)" }}
                />
              </View>
            </View>
          </View>
        ))}
      </View>
      <AppText variant="11" className="mt-5 border-t border-white/10 pt-4 leading-5 text-white/55" pretty>
        고른 개념마다 원인 · 극복 계획 · 시험장 체크리스트를 써 주고, 같은 개념 기출 5문제를 그 자리에서 풀 수
        있어요.
      </AppText>
    </View>
  );
}
