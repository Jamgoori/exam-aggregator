import { computeDiagnosisProgress, formatDuration, type CbtSubmitResponse } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BrainCircuit, ChevronRight, Trophy } from "lucide-react-native";
import { Modal, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 채점 결과 모달(웹 cbt-result-modal.tsx 1:1): 화면 전체 덮개 black/50, max-w-sm rounded-2xl p-8,
// Trophy 40 amber-500, 점수·정답률·풀이시간, 진단 진행 바(cbt-submit 응답 diagnosisProgress),
// "틀린 문제 다시 보기 (N문제)" → /mypage/attempts/[attemptId], "문제지로" / "다시 풀기".
// voidedQuestions 는 optional 로 취급한다(복원 경로엔 없다, §6.6).
const TrophyIcon = themedIcon(Trophy);
const BrainIcon = themedIcon(BrainCircuit);
const ChevronIcon = themedIcon(ChevronRight);

// "AI 약점 진단까지 응시 2/3" 진행 바(웹 diagnosis-progress.tsx, compact). 계산은 core.
function DiagnosisProgress({
  attemptCount,
  wrongCount,
  eligibleHref = "/mypage/diagnosis",
  eligibleLabel = "AI 약점 진단 받기",
  lockedHref = "/diagnosis",
}: {
  attemptCount: number;
  wrongCount: number;
  eligibleHref?: string;
  eligibleLabel?: string;
  lockedHref?: string;
}) {
  const p = computeDiagnosisProgress({ attemptCount, wrongCount });
  const pad = "px-3.5 py-3";

  if (p.eligible) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(eligibleHref as Href)}
        className={`w-full flex-row items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 active:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 ${pad}`}
      >
        <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
          <BrainIcon size={16} colorClassName="text-white" />
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

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(lockedHref as Href)}
      className={`w-full rounded-xl border border-violet-200 bg-violet-50/70 active:bg-violet-100/80 dark:border-violet-900/60 dark:bg-violet-950/30 ${pad}`}
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
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`AI 약점 진단까지 ${p.label}`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(p.ratio * 100) }}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/50"
      >
        <View className="h-full rounded-full bg-violet-600" style={{ width: `${Math.max(4, Math.round(p.ratio * 100))}%` }} />
      </View>
      {p.remainingHint && (
        <AppText variant="11" className="mt-1.5 text-violet-700/80 dark:text-violet-300/70">
          {p.remainingHint}
        </AppText>
      )}
    </Pressable>
  );
}

export function CbtResultModal({
  result,
  paperHref,
  onRetry,
}: {
  result: CbtSubmitResponse;
  // 문제지 상세 주소(paperId 는 링크로 쓸 수 없다).
  paperHref: string;
  onRetry: () => void;
}) {
  const score = result.score ?? 0;
  const total = result.totalQuestions ?? 0;
  const wrong = total - score;
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="w-full max-w-sm items-center gap-4 rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900">
          <TrophyIcon size={40} colorClassName="text-amber-500" />
          <AppText variant="lg" weight="semibold" className="text-center dark:text-zinc-100">
            채점 결과
          </AppText>
          <AppText variant="3xl" weight="bold" tabular className="text-center text-blue-600 dark:text-blue-400">
            {score} / {total}
          </AppText>
          <View className="w-full flex-row rounded-xl border border-zinc-100 dark:border-zinc-700">
            <View className="flex-1 items-center py-3">
              <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                정답률
              </AppText>
              <AppText weight="semibold" tabular className="mt-1 text-zinc-700 dark:text-zinc-300">
                {Math.round((score / (total || 1)) * 100)}%
              </AppText>
            </View>
            <View className="w-px bg-zinc-100 dark:bg-zinc-700" />
            <View className="flex-1 items-center py-3">
              <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                풀이시간
              </AppText>
              <AppText weight="semibold" tabular className="mt-1 text-zinc-700 dark:text-zinc-300">
                {formatDuration(result.durationSeconds ?? 0)}
              </AppText>
            </View>
          </View>
          {/* 채점 직후가 "다음에 또 올 이유"를 심을 유일한 순간 — 값이 없으면(집계 실패) 줄을 비운다. */}
          {result.diagnosisProgress && (
            <DiagnosisProgress
              attemptCount={result.diagnosisProgress.attemptCount}
              wrongCount={result.diagnosisProgress.wrongCount}
            />
          )}
          {result.attemptId && score < total && (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/mypage/attempts/${result.attemptId}` as Href)}
              className="w-full items-center rounded-xl bg-blue-600 px-4 py-2.5 active:bg-blue-700"
            >
              <AppText variant="sm" weight="medium" className="text-white">
                틀린 문제 다시 보기 ({wrong}문제)
              </AppText>
            </Pressable>
          )}
          <View className="w-full flex-row gap-2">
            <Pressable
              accessibilityRole="link"
              onPress={() => router.replace(paperHref as Href)}
              className="flex-1 items-center rounded-xl border border-zinc-300 px-4 py-2.5 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800/50"
            >
              <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
                문제지로
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              className="flex-1 items-center rounded-xl bg-blue-600 px-4 py-2.5 active:bg-blue-700"
            >
              <AppText variant="sm" weight="medium" className="text-white">
                다시 풀기
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
