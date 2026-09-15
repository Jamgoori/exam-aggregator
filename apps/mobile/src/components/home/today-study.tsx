import {
  computeDiagnosisProgress,
  computeTodayStudy,
  SAMPLE_TODAY_STUDY,
  type DiagnosisProgress,
  type TodayStudyAttempt,
  type TodayStudyData,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BrainCircuit, ChevronRight, Flame } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { TodayStudyCardSkeleton } from "./home-skeletons";
import { AppText } from "../app-text";
import { QueryState } from "../query-state";
import { useTodayStudy } from "../../queries/home";
import { useAuth } from "../../providers/auth-provider";
import { palette } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 오늘의 학습 현황 카드(웹 page.tsx TodayStudy·TodayStudyCard·DiagnosisRow·MiniStat).
// 비회원에게는 "풀고 나면 이렇게 쌓인다"를 보여주는 예시(예시 화면 표기), 회원에게는 진짜 내
// 숫자 — 마이페이지 요약(응시·연속 학습)과 AI 진단 자격(응시 N/3)을 한 장에 담는다. 로그인
// 여부·조회는 여기서 하고, 도착 전에는 같은 크기의 뼈대가 자리를 잡는다(회원에게 예시 숫자가
// 잠깐 비치는 일이 없다). 집계(이번 주·정답률·스트릭)는 core computeTodayStudy.
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const FlameIcon = themedIcon(Flame);
const ChevronIcon = themedIcon(ChevronRight);

export function TodayStudy() {
  const { userId } = useAuth();
  const query = useTodayStudy();
  if (!userId) return <TodayStudyCard data={SAMPLE_TODAY_STUDY} sample />;
  return (
    <QueryState query={query} skeleton={<TodayStudyCardSkeleton />}>
      {(raw) => <TodayStudyLive attempts={raw.attempts} wrongCount={raw.wrongCount} />}
    </QueryState>
  );
}

function TodayStudyLive({ attempts, wrongCount }: { attempts: TodayStudyAttempt[]; wrongCount: number }) {
  // 날짜 계산은 그릴 때 — 캐시가 어제 것이어도 "오늘" 칸이 맞는다.
  const data = useMemo(
    () => computeTodayStudy(attempts, { attemptCount: attempts.length, wrongCount }),
    [attempts, wrongCount],
  );
  return <TodayStudyCard data={data} />;
}

export function TodayStudyCard({ data, sample = false }: { data: TodayStudyData; sample?: boolean }) {
  const weekMax = Math.max(1, ...data.week);
  const weekTotal = data.week.reduce((a, b) => a + b, 0);
  const progress = computeDiagnosisProgress({ attemptCount: data.attemptCount, wrongCount: data.wrongCount });
  return (
    <View
      className="w-full max-w-md self-center"
      accessibilityElementsHidden={sample || undefined}
      importantForAccessibility={sample ? "no-hide-descendants" : undefined}
    >
      <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl shadow-[#012854]/10 dark:border-zinc-800 dark:bg-zinc-950">
        <View className="mb-5 flex-row items-center justify-between">
          <View>
            <AppText variant="xs" weight="bold" className="text-[#12b382]">
              TODAY&apos;S STUDY
            </AppText>
            <AppText variant="lg" weight="bold" className="mt-1 text-zinc-900 dark:text-zinc-100">
              오늘의 학습 현황
            </AppText>
          </View>
          {sample ? (
            <View className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900">
              <AppText variant="11" weight="bold" allowFontScaling={false} className="text-zinc-500 dark:text-zinc-400">
                예시 화면
              </AppText>
            </View>
          ) : (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="마이페이지"
              onPress={() => router.push("/mypage" as Href)}
              className="h-10 w-10 items-center justify-center rounded-full bg-[#e7f2fc] active:bg-[#d3e8f8] dark:bg-zinc-800 dark:active:bg-zinc-700"
            >
              <FlameIcon size={18} colorClassName="text-zinc-700 dark:text-zinc-300" />
            </Pressable>
          )}
        </View>

        <View className="flex-row gap-3">
          <MiniStat label="오늘 응시" value={String(data.todayAttempts)} unit="회차" />
          <MiniStat
            label="정답률"
            value={data.accuracyPct == null ? "–" : String(data.accuracyPct)}
            unit={data.accuracyPct == null ? "" : "%"}
            accent
          />
          <MiniStat label="연속 학습" value={String(data.streakDays)} unit="일" />
        </View>

        <View className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <View className="mb-3 flex-row justify-between">
            <AppText variant="xs" weight="semibold" className="text-zinc-900 dark:text-zinc-100">
              이번 주 학습량
            </AppText>
            <AppText variant="xs" tabular className="text-zinc-500">
              {weekTotal.toLocaleString("ko-KR")}문제
            </AppText>
          </View>
          {/* 막대 높이는 퍼센트 — 열마다 h-full 을 주고 아래 정렬로 바닥에 붙인다. 0 인 날도
              바닥선이 보이게 최소 4%. */}
          <View className="h-24 flex-row gap-2">
            {DAYS.map((d, i) => (
              <View key={d} className="h-full flex-1 items-center justify-end gap-1">
                <View
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(4, Math.round((data.week[i] / weekMax) * 88))}%`,
                    backgroundColor: i === data.todayIndex ? palette.brand : `${palette.navy}26`,
                  }}
                />
                <AppText variant="10" className="text-zinc-500">
                  {d}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        {/* 진단까지 남은 거리 또는 "받기". 회원에게는 실제 링크, 예시에서는 그림. */}
        <DiagnosisRow
          progress={progress}
          href={sample ? undefined : progress.eligible ? "/mypage/diagnosis" : "/papers"}
        />
      </View>
    </View>
  );
}

function DiagnosisRow({ progress, href }: { progress: DiagnosisProgress; href?: string }) {
  const body = (
    <>
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#12b382]">
        <BrainCircuit size={18} color={palette.white} />
      </View>
      <View className="min-w-0 flex-1">
        <AppText variant="xs" weight="bold" className="text-zinc-900 dark:text-zinc-100">
          {progress.eligible ? "AI 약점 진단 받기" : `AI 약점 진단까지 ${progress.label}`}
        </AppText>
        <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-400">
          {progress.eligible
            ? "틀리는 이유를 개념별로 짚어 드려요"
            : (progress.remainingHint ?? "").replace("진단이 열려요", "틀리는 이유를 개념별로 알려드려요")}
        </AppText>
      </View>
      <ChevronIcon size={16} colorClassName="text-zinc-400" />
    </>
  );
  const cls = "mt-4 flex-row items-center gap-3 rounded-xl bg-[#12b382]/10 p-3";
  return href ? (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href as Href)}
      className={`${cls} active:opacity-90`}
    >
      {body}
    </Pressable>
  ) : (
    <View className={cls}>{body}</View>
  );
}

function MiniStat({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <View className="flex-1 rounded-xl bg-[#e7f2fc] p-3 dark:bg-zinc-800/70">
      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
        {label}
      </AppText>
      <AppText
        variant="xl"
        weight="bold"
        tabular
        className={["mt-2", accent ? "text-[#12b382]" : "text-zinc-900 dark:text-zinc-100"].join(" ")}
      >
        {value}
        <AppText variant="xs" weight="medium" className={accent ? "text-[#12b382]" : "text-zinc-900 dark:text-zinc-100"}>
          {" "}
          {unit}
        </AppText>
      </AppText>
    </View>
  );
}
