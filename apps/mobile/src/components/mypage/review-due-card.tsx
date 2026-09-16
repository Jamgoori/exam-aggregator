import type { DueForecastDay } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { CalendarCheck, ChevronDown, CircleQuestionMark, Lock, Settings } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ReviewGuideSheet } from "./review-guide-sheet";
import { ReviewSettingsSheet } from "./review-settings-sheet";
import { AppText } from "../app-text";
import { handleEdgeError } from "../../lib/edge";
import { useDueSummary, useReviewPrefs, useStartDueSession } from "../../queries/review-due";
import { useMembershipDays } from "../../queries/membership";
import { themedIcon } from "../../theme/icons";

// 오답노트 탭 안 "오늘의 복습" 카드(웹 review-due-card.tsx 1:1, 설계서 §4.5 #26·§8.3).
//
// 홈에는 두지 않는다 — 홈은 매번 보는 자리라, 잠긴 카드가 거기 있으면 결제 안 한 사용자가
// 오답노트 자체를 피하게 된다. 여기는 사용자가 "복습하러" 들어온 맥락이라 제안이 자연스럽다.
// 무료 상태에서 밀린 문항 수 같은 숫자는 보여주지 않는다(못 누르는 숫자는 설득이 아니라 압박).
//
// **숫자·잠금 판정은 전부 서버가 한다**: EF `review-due`·`review-prefs`. 앱은 SRS 를 계산하지
// 않고(AGENTS.md 금지선), 403 을 오류가 아니라 잠긴 카드로 읽는다.
//
// 웹은 sm 브레이크포인트로 좁은 화면/넓은 화면을 갈랐는데, 앱은 언제나 좁은 쪽이다(§4.4) —
// 그래서 웹의 `sm:hidden` 계열(압축 보조 문구 한 줄, 접힌 예보)만 그린다.
const LockIcon = themedIcon(Lock);
const CalendarIcon = themedIcon(CalendarCheck);
const HelpIcon = themedIcon(CircleQuestionMark);
const SettingsIcon = themedIcon(Settings);
const ChevronIcon = themedIcon(ChevronDown);

const MEMBERSHIP_HREF = "/membership?next=%2Fmypage%3Ftab%3Dwrong-notes" as Href;

export function ReviewDueCard({ premium }: { premium: boolean }) {
  // 무료 회원에게는 조회 자체를 하지 않는다(서버가 403 을 줄 것을 알고 있다). 잠금 문구는
  // 카드가 직접 그린다 — 이건 게이트를 앱에서 "실행"하는 게 아니라, 이미 받은 멤버십 판정
  // (EF membership-get)으로 화면을 고르는 것이다.
  const summaryQuery = useDueSummary(premium);
  const prefsQuery = useReviewPrefs(premium);
  const startDue = useStartDueSession("create");
  const startExtra = useStartDueSession("extra");
  const { trialDaysLeft } = useMembershipDays();

  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  if (!premium) return <LockedCard />;

  const summary = summaryQuery.data ?? null;
  const prefs = prefsQuery.data;
  const choices = prefs?.subjects ?? [];
  const pausedNames = choices.filter((c) => c.paused).map((c) => c.name);
  // 하루 상한은 두 곳에서 오는데 원본은 하나다(review_preferences.daily_limit). **설정 쪽을
  // 먼저 쓴다** — 값을 바꾸면 EF 응답이 그 자리에서 캐시에 들어오는 반면 요약은 무효화 뒤
  // 다시 받아야 해서, 요약을 먼저 쓰면 방금 고른 칩이 잠깐 옛 값으로 되돌아간다.
  const dailyLimit = prefs?.dailyLimit ?? summary?.dailyLimit ?? 20;

  // 서버가 아직 잠겼다고 답했다면(요약이 null) 무료와 같은 자리를 그린다 — 멤버십이 방금
  // 끝난 계정이 숫자 없는 카드로 자연스럽게 넘어간다.
  if (summaryQuery.isSuccess && summary === null) return <LockedCard />;

  const todayCount = summary?.todayCount ?? 0;
  const pending = startDue.isPending || startExtra.isPending;

  // 보조 문구를 한 줄로 압축한다(웹의 좁은 화면 규칙). 셋이 동시에 뜨는 날이 흔한데
  // (신규 승격 + 상한 초과 + 대기 풀), 그러면 카드가 세 줄 길어진다.
  const compactMeta = [
    summary && summary.newCount > 0 ? `처음 ${summary.newCount}` : null,
    summary && summary.pendingTotal > 0 ? `대기 ${summary.pendingTotal}` : null,
  ].filter(Boolean) as string[];

  async function start(which: "create" | "extra") {
    if (pending) return;
    setError(null);
    const mutation = which === "create" ? startDue : startExtra;
    try {
      const res = await mutation.mutateAsync();
      // 두고 나온 세션을 이어 받았으면(resumed) 기기에 저장해 둔 답이 그대로 붙는다 —
      // 솔버가 세션 id 로 드래프트를 찾으므로 여기서 따로 할 일은 없다.
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: "/mypage?tab=wrong-notes" });
      if (handled.redirected) return;
      setError(handled.message || "세션을 시작하지 못했어요.");
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <View className="gap-3">
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
            <CalendarIcon size={16} colorClassName="text-blue-900 dark:text-blue-100" />
            <AppText variant="sm" weight="bold" className="min-w-0 text-blue-900 dark:text-blue-100">
              {todayCount > 0 ? (
                <>
                  오늘 복습할{" "}
                  <AppText variant="sm" weight="bold" className="text-blue-600 dark:text-blue-300">
                    {todayCount}문항
                  </AppText>
                </>
              ) : summaryQuery.isPending ? (
                "오늘의 복습"
              ) : (
                "오늘 복습할 문항 없어요"
              )}
            </AppText>
            <View className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5">
              <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white">
                멤버십
              </AppText>
            </View>
          </View>

          <AppText variant="xs" className="text-blue-700 dark:text-blue-300" pretty>
            {summaryLine(summary, summaryQuery.isPending)}
          </AppText>

          {compactMeta.length > 0 && (
            <AppText variant="xs" className="text-blue-700/60 dark:text-blue-300/50">
              {compactMeta.join(" · ")}
            </AppText>
          )}

          {error && (
            <AppText variant="xs" className="mt-1 text-red-600 dark:text-red-400" pretty>
              {error}
            </AppText>
          )}
        </View>

        {/* 시작 버튼이 없는 날(오늘치 끝 + 대기 없음)에는 아이콘만 남는다 — 그때 왼쪽에 붙어
            있으면 제목 아래 허공에 뜨므로 오른쪽으로 몰아둔다(웹과 같은 판단). */}
        <View className="flex-row items-center justify-end gap-1.5">
          {todayCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={() => void start("create")}
              className={[
                "flex-1 items-center rounded-lg bg-blue-600 px-3.5 py-2 active:bg-blue-700",
                pending ? "opacity-60" : "",
              ].join(" ")}
            >
              <AppText variant="sm" weight="bold" className="text-white">
                {pending ? "여는 중..." : "복습 시작"}
              </AppText>
            </Pressable>
          ) : (
            // 오늘치를 끝냈고 대기가 남아 있을 때만. 밀린 복습이 남아 있으면 서버가 거절하므로
            // 버튼 자체를 안 띄운다.
            summary != null &&
            summary.pendingTotal > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: pending, busy: pending }}
                disabled={pending}
                onPress={() => void start("extra")}
                className={[
                  "flex-1 items-center rounded-lg border border-blue-300 px-3.5 py-2 active:bg-blue-100 dark:border-blue-800 dark:active:bg-blue-900/40",
                  pending ? "opacity-60" : "",
                ].join(" ")}
              >
                <AppText variant="sm" weight="bold" className="text-blue-700 dark:text-blue-300">
                  {pending ? "여는 중..." : "복습 더하기"}
                </AppText>
              </Pressable>
            )
          )}

          {/* 톱니 왼쪽 — 설정보다 먼저 눌러야 할 것이다. 예약이 하나도 없는 첫 사용자에게 가장
              필요하므로 조건 없이 띄운다. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="복습 안내"
            onPress={() => setGuideOpen(true)}
            className="h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-blue-100 dark:active:bg-blue-900/40"
          >
            <HelpIcon size={17} colorClassName="text-blue-700/60 dark:text-blue-300/50" />
          </Pressable>
          {(choices.length > 0 || todayCount > 0) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="복습 설정"
              onPress={() => setSettingsOpen(true)}
              className="h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-blue-100 dark:active:bg-blue-900/40"
            >
              <SettingsIcon size={17} colorClassName="text-blue-700/70 dark:text-blue-300/60" />
            </Pressable>
          )}
        </View>
      </View>

      <ForecastBlock forecast={summary?.forecast ?? []} />

      {pausedNames.length > 0 && (
        <AppText variant="11" className="text-blue-700/60 dark:text-blue-300/50">
          {pausedNames.join(" · ")} 쉬는 중
        </AppText>
      )}

      {trialDaysLeft != null && trialDaysLeft <= 3 && (
        <Pressable accessibilityRole="link" onPress={() => router.push(MEMBERSHIP_HREF)}>
          <AppText variant="xs" weight="medium" className="text-blue-800 dark:text-blue-200" pretty>
            체험 {trialDaysLeft}일 남음 · 끝나면 예약된 복습이 사라져요{" "}
            <AppText variant="xs" weight="bold" className="text-blue-800 underline dark:text-blue-200">
              요금제 보기
            </AppText>
          </AppText>
        </Pressable>
      )}

      <ReviewGuideSheet visible={guideOpen} dailyLimit={dailyLimit} onClose={() => setGuideOpen(false)} />
      <ReviewSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        choices={choices}
        dailyLimit={dailyLimit}
        overdueTotal={summary?.overdueTotal ?? 0}
        suspendedTotal={summary?.suspendedTotal ?? 0}
      />
    </View>
  );
}

// 제목 아래 한 줄. 오늘 낼 게 있으면 과목 분포지만, 없으면 "몇 시간 뒤 한 번 더 나와요" 같은
// 상태 안내가 온다 — 0인 날을 그냥 비워두면 기능이 멈춘 걸로 오해한다(웹과 같은 분기).
function summaryLine(
  summary: { todayCount: number; subjects: { name: string; count: number }[]; relearnCount: number; nextDueOffset: number | null } | null,
  loading: boolean,
): string {
  if (!summary) return loading ? "오늘 복습할 문항을 세는 중이에요" : "복습 예정 문항을 모았어요";
  if (summary.todayCount > 0) {
    return summary.subjects.length > 0
      ? summary.subjects.map((s) => `${s.name} ${s.count}`).join(" · ")
      : "복습 예정 문항을 모았어요";
  }
  // 방금 틀린 문항은 몇 시간 뒤 재확인으로 돌아온다. 이걸 안 알리면 "없어요"를 보고 닫았다가
  // 세 시간 뒤 숫자가 다시 생긴다.
  if (summary.relearnCount > 0) return `방금 틀린 ${summary.relearnCount}문항이 몇 시간 뒤 한 번 더 나와요`;
  if (summary.nextDueOffset != null) return `다음 복습은 ${summary.nextDueOffset}일 뒤예요`;
  return "새로 틀린 문제가 생기면 여기에 예약돼요";
}

// 앱은 언제나 좁은 화면이라 웹의 `sm:hidden` 쪽만 그린다: 7칸을 접고 한 줄 요약("이번 주 N문항")
// 만 남긴다. 요일+숫자 두 단이라 카드에서 가장 높이를 많이 먹는 자리인데, 매일 확인해야 할
// 정보는 아니다("오늘 몇 개"는 이미 제목에 있다).
function ForecastBlock({ forecast }: { forecast: DueForecastDay[] }) {
  const [open, setOpen] = useState(false);
  if (forecast.length === 0) return null;
  const weekTotal = forecast.reduce((n, d) => n + d.count, 0);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="-mx-1 flex-row items-center gap-1.5 rounded-lg px-1 py-1 active:bg-blue-100/60 dark:active:bg-blue-900/30"
      >
        <AppText variant="xs" weight="medium" className="text-blue-700/70 dark:text-blue-300/60">
          이번 주 {weekTotal}문항
        </AppText>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronIcon size={14} colorClassName="text-blue-700/70 dark:text-blue-300/60" />
        </View>
      </Pressable>
      {open && <ForecastStrip forecast={forecast} />}
    </View>
  );
}

// 요일 7칸 + 숫자만. 막대 그래프를 쓰지 않는 건 좁은 화면에서 안 깨지고 한눈에 읽히기
// 때문이다. 0인 날("-")이 보이는 것 자체가 스케줄이 돌고 있다는 증거라 칸을 지우지 않는다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function ForecastStrip({ forecast }: { forecast: DueForecastDay[] }) {
  if (forecast.length === 0) return null;
  const today = new Date();

  return (
    <View className="flex-row">
      {forecast.map((d) => {
        const date = new Date(today.getTime() + d.offset * 24 * 60 * 60 * 1000);
        const label = d.offset === 0 ? "오늘" : d.offset === 1 ? "내일" : WEEKDAYS[date.getDay()];
        return (
          <View key={d.offset} className="min-w-[44px] flex-1 items-center gap-0.5 py-1">
            <AppText variant="11" className="text-blue-700/60 dark:text-blue-300/50">
              {label}
            </AppText>
            <AppText
              variant="sm"
              tabular
              weight={d.count > 0 ? "bold" : "normal"}
              className={
                d.count > 0
                  ? "text-blue-900 dark:text-blue-100"
                  : "text-blue-400/60 dark:text-blue-500/40"
              }
            >
              {d.count > 0 ? d.count : "-"}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

// 무료 회원이 보는 자리. 잠겼다는 사실만 알리고 끝내면 어디로 가야 풀리는지 알 수 없어서,
// 카드 전체를 요금제 페이지 링크로 둔다.
function LockedCard() {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(MEMBERSHIP_HREF)}
      className="flex-row items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 active:border-blue-300 active:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:active:border-blue-800 dark:active:bg-blue-950/20"
    >
      <View className="mt-0.5">
        <LockIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-500" />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            오늘의 복습
          </AppText>
          <View className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5">
            <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white">
              멤버십
            </AppText>
          </View>
        </View>
        <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-500" pretty>
          공모아만의 특수 알고리즘이 틀린 문제를 가장 잊기 쉬운 순간에 다시 복습시켜줘요
        </AppText>
        <AppText variant="xs" weight="bold" className="mt-1.5 text-blue-600 dark:text-blue-400">
          멤버십 혜택 알아보기 ›
        </AppText>
      </View>
    </Pressable>
  );
}
