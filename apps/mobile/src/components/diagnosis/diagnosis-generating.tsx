import { KST_TIME_ZONE } from "@gongmoa/core";
import { LoaderCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// "만드는 중" 카드(웹 diagnosis-board.tsx GeneratingNotice). 요청을 넣은 뒤 리포트가 도착할
// 때까지 이 자리가 화면에 남는다 — 아무 말도 안 하면 사용자는 버튼이 먹통이라고 생각하고 다시
// 누르러 오고, 그때마다 요금이 나갈 수 있었다. 몇 개를 만들고 있는지·언제 요청했는지·얼마나
// 지났는지를 함께 적는다.
//
// ⚠ **대기 시간이 웹보다 길다.** 웹은 버튼을 누른 그 자리에서 배치를 제출하고 페이지 폴링이
// 결과 수거까지 겸하지만, 앱 요청은 `ai_diagnoses` 에 행만 만들고 제출·수거는 Vercel 크론이
// **시간당 한 번**(vercel.json `0 * * * *`, 수거 → 제출 순서) 맡는다. 그래서 앱 단독 경로의
// 최악은 "제출까지 최대 1시간 + 배치 몇 분 + 수거까지 최대 1시간"이다. 웹 문구("보통 5~10분")
// 를 그대로 옮기면 화면이 거짓말을 하므로 여기만 앱 사실대로 적었다.
// **소유자 결정 대기**(설계서 §13 질문 9 의 대가): (a) 지금처럼 "최대 두 시간"으로 안내 ·
// (b) 크론을 10분 간격으로 · (c) 수거 전용 경로 신설. (b)·(c) 가 정해지면 이 문구와 아래
// SLOW_AFTER_MIN 을 함께 줄인다.
const SLOW_AFTER_MIN = 120;

const SpinnerIcon = themedIcon(LoaderCircle);

export type DiagnosisGenerating = { requestedAt: string; conceptCount: number };

export function DiagnosisGeneratingCard({
  generating,
  // 지금도 30초마다 다시 묻고 있는가. 폴링을 접은 뒤에는 "당겨서 새로고침"으로 안내를 바꾼다.
  polling,
}: {
  generating: DiagnosisGenerating;
  polling: boolean;
}) {
  const { requestedAt, conceptCount } = generating;
  const minutes = useElapsedMinutes(requestedAt);
  const slow = minutes != null && minutes >= SLOW_AFTER_MIN;

  return (
    <View className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-900/50 dark:bg-violet-950/20">
      <View className="flex-row items-center gap-2">
        <Spinner />
        <AppText variant="sm" weight="bold" className="text-violet-900 dark:text-violet-200">
          맞춤 극복법을 만들고 있어요
        </AppText>
      </View>
      <AppText variant="xs" className="mt-1.5 leading-relaxed text-violet-700/80 dark:text-violet-300/70" pretty>
        {conceptCount > 0 ? `고른 ${conceptCount}개 개념을 ` : ""}틀린 문항 하나씩 짚어 가며 분석하는
        중이에요.{" "}
        {slow
          ? "예상보다 오래 걸리고 있어요. 그대로 두시면 다 되는 대로 나타나요."
          : "앱에서 요청한 진단은 서버가 정해진 시각에 모아서 만들어요 — 최대 두 시간까지 걸릴 수 있어요."}
      </AppText>
      {/* 진행률을 알 수 없는 작업이라(배치가 언제 끝나는지 API가 알려주지 않는다) 좌우로 흐르는
          인디케이터만 둔다 — 가짜 퍼센트를 그리면 90%에서 멈춘 것처럼 보인다. */}
      <IndeterminateBar />
      <AppText variant="11" className="mt-2.5 leading-relaxed text-violet-700/60 dark:text-violet-300/50" pretty>
        {formatRequestedAt(requestedAt)} 요청
        {minutes != null ? ` · ${minutes < 1 ? "방금 시작했어요" : `${minutes}분 지났어요`}` : ""} ·{" "}
        {polling
          ? "다 되면 이 화면에 그대로 나타나요. 기다리는 동안 위 그래프에서 어떤 개념을 틀렸는지 볼 수 있어요."
          : "화면을 아래로 당기면 다 됐는지 다시 확인해요."}
      </AppText>
    </View>
  );
}

// 웹 Loader2 animate-spin(§4.3 모션 매핑) — 버튼 스피너와 같은 900ms 회전.
function Spinner() {
  const rotate = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    rotate.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
  }, [reduce, rotate]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <SpinnerIcon size={15} colorClassName="text-violet-900 dark:text-violet-200" />
    </Animated.View>
  );
}

// 웹 .animate-loading-bar(1/3 폭 막대가 좌우로 흐른다) — CBT 로딩 오버레이와 같은 방식으로
// translateX 를 컨테이너 배수로 준다(RN 은 % 트랜스폼이 없어 레이아웃 폭을 재서 곱한다).
function IndeterminateBar() {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [reduce, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * width * 0.67 }] }));
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/40"
    >
      {!reduce && width > 0 && (
        <Animated.View style={[style, { width: width / 3 }]} className="h-full rounded-full bg-violet-500" />
      )}
    </View>
  );
}

// 요청 후 지난 시간(분). 30초마다 갱신한다.
function useElapsedMinutes(since: string): number | null {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const started = Date.parse(since);
      if (Number.isNaN(started)) return;
      setMinutes(Math.max(0, Math.floor((Date.now() - started) / 60_000)));
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [since]);
  return minutes;
}

// "2026-08-27T05:12:00Z" → "오후 2:12". 한국 시간 기준(사용자가 사는 시간대다).
function formatRequestedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "조금 전";
  return new Date(t).toLocaleTimeString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}
