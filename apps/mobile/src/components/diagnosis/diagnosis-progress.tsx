import { computeDiagnosisProgress } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BrainCircuit, ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { palette } from "../../theme";
import { themedIcon } from "../../theme/icons";

// "AI 약점 진단까지 응시 2/3" 진행 바(웹 diagnosis-progress.tsx). 처음 온 수험생이 세 번
// 돌아오게 만드는 장치 — 채점 직후(결과 모달은 cbt/cbt-result-modal.tsx 의 compact 판)·
// 마이페이지·진단 소개에 같은 모양으로 붙는다. 자격이 되면 바 대신 "진단 받기" 링크.
// 이미 이번 주기에 받았는지는 여기서 모른다 — 필요한 자리는 eligibleHref/eligibleLabel 로.
const ChevronIcon = themedIcon(ChevronRight);
const BrainIcon = themedIcon(BrainCircuit);

export function DiagnosisProgress({
  attemptCount,
  wrongCount,
  eligibleHref = "/mypage/diagnosis",
  eligibleLabel = "AI 약점 진단 받기",
  // 아직 자격이 안 될 때 눌러 가는 곳. 기본은 소개 페이지.
  lockedHref = "/diagnosis",
  compact = false,
}: {
  attemptCount: number;
  wrongCount: number;
  eligibleHref?: string;
  eligibleLabel?: string;
  lockedHref?: string;
  compact?: boolean;
}) {
  const p = computeDiagnosisProgress({ attemptCount, wrongCount });
  const pad = compact ? "px-3.5 py-3" : "px-4 py-3.5";

  if (p.eligible) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(eligibleHref as Href)}
        className={`w-full flex-row items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 active:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:active:bg-violet-950/50 ${pad}`}
      >
        <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
          <BrainCircuit size={16} color={palette.white} />
        </View>
        <View className="min-w-0 flex-1">
          <AppText variant="sm" weight="bold" className="text-violet-900 dark:text-violet-100">
            {eligibleLabel}
          </AppText>
          <AppText variant="xs" className="text-violet-700/80 dark:text-violet-300/70">
            틀리는 이유를 개념별로 짚어 드려요
          </AppText>
        </View>
        <ChevronIcon size={16} colorClassName="text-violet-400" />
      </Pressable>
    );
  }

  const pct = Math.round(p.ratio * 100);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`AI 약점 진단까지 ${p.label}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      onPress={() => router.push(lockedHref as Href)}
      className={`w-full rounded-xl border border-violet-200 bg-violet-50/70 active:bg-violet-100/80 dark:border-violet-900/60 dark:bg-violet-950/30 dark:active:bg-violet-950/50 ${pad}`}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-1.5">
          <BrainIcon size={15} colorClassName="text-violet-900 dark:text-violet-100" />
          <AppText variant="13" weight="bold" className="text-violet-900 dark:text-violet-100">
            AI 약점 진단까지
          </AppText>
        </View>
        <AppText variant="13" weight="bold" tabular className="text-violet-700 dark:text-violet-300">
          {p.label}
        </AppText>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/50">
        <View className="h-full rounded-full bg-violet-600" style={{ width: `${Math.max(4, pct)}%` }} />
      </View>
      {p.remainingHint && (
        <AppText variant="11" className="mt-1.5 text-violet-700/80 dark:text-violet-300/70">
          {p.remainingHint}
        </AppText>
      )}
    </Pressable>
  );
}
