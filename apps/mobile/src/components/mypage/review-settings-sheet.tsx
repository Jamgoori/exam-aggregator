import { DAILY_LIMIT_OPTIONS, type ReviewPrefsResponse } from "@gongmoa/core";
import { useState } from "react";
import { ScrollView, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Sheet } from "../sheet";
import { handleEdgeError } from "../../lib/edge";
import {
  useRestoreSuspended,
  useSetDailyLimit,
  useSpreadBacklog,
  useToggleSubjectPaused,
} from "../../queries/review-due";

// 복습 설정 시트(웹 review-due-card.tsx 의 ReviewSettingsModal 1:1). 하루 문항 수 → 밀린 복습
// 정리 → 접어둔 문제 → 과목 켜고 끄기 순.
//
// 카드 안 칩이 아니라 시트인 이유는 웹과 같다: 과목이 열 개 가까이 되면 칩이 카드를 밀어내
// 매일 보는 "오늘 복습" 숫자가 접힌다. 설정은 가끔 여는 것이고, 그 순간에는 화면을 다 써도 된다.
//
// 과목은 "끈 과목"으로 저장한다(review_preferences.paused_subject_ids) — 켠 과목 목록으로
// 저장하면 나중에 새로 공부를 시작한 과목이 조용히 빠진 채로 남는다. 쓰기는 전부 EF
// `review-prefs` 를 지난다(앱은 이 테이블을 읽기만 한다 — §6.2).

// 밀린 문항이 이만큼 넘으면 "정리하기"를 권한다. 하루 상한의 몇 배쯤 되면 매일 풀어도 숫자가
// 안 줄어드는 것처럼 보여 손을 놓게 된다.
const BACKLOG_NUDGE_MIN = 100;

export type ReviewSubjectChoice = NonNullable<ReviewPrefsResponse["subjects"]>[number];

export function ReviewSettingsSheet({
  visible,
  onClose,
  choices,
  dailyLimit,
  overdueTotal,
  suspendedTotal,
}: {
  visible: boolean;
  onClose: () => void;
  choices: ReviewSubjectChoice[];
  dailyLimit: number;
  overdueTotal: number;
  suspendedTotal: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [spreadDone, setSpreadDone] = useState<number | null>(null);
  const [restoreDone, setRestoreDone] = useState<number | null>(null);

  const setLimit = useSetDailyLimit();
  const togglePaused = useToggleSubjectPaused();
  const spread = useSpreadBacklog();
  const restore = useRestoreSuspended();

  // 목록·하루 상한은 캐시(EF 응답)가 진실이다 — 토글하면 응답이 그대로 캐시에 들어오고 여기로
  // 다시 내려온다. 웹이 낙관적 반영 + 실패 시 되돌리기를 하는 자리인데, 앱은 왕복이 한 번이라
  // 서버 응답을 기다리는 쪽이 "껐는데 다시 켜지는" 그림을 안 만든다(대신 그 행만 흐려진다).
  const onCount = choices.filter((c) => !c.paused).length;

  async function report(e: unknown, fallback: string) {
    const handled = await handleEdgeError(e, { next: "/mypage?tab=wrong-notes" });
    if (handled.redirected) return;
    setError(handled.message || fallback);
  }

  async function changeLimit(next: number) {
    if (setLimit.isPending || next === dailyLimit) return;
    setError(null);
    try {
      await setLimit.mutateAsync(next);
    } catch (e) {
      await report(e, "설정을 저장하지 못했어요.");
    }
  }

  async function spreadBacklog() {
    if (spread.isPending) return;
    setError(null);
    try {
      const res = await spread.mutateAsync();
      setSpreadDone(res.spreadCount ?? 0);
    } catch (e) {
      await report(e, "밀린 복습을 정리하지 못했어요.");
    }
  }

  async function restoreSuspended() {
    if (restore.isPending) return;
    setError(null);
    try {
      const res = await restore.mutateAsync();
      setRestoreDone(res.restoredCount ?? 0);
    } catch (e) {
      await report(e, "접어둔 문제를 되살리지 못했어요.");
    }
  }

  async function toggle(target: ReviewSubjectChoice) {
    if (busyId) return;
    const nextPaused = !target.paused;
    // 전부 끄면 복습이 통째로 멈춘다. 마지막 하나는 막고 이유를 말해준다.
    if (nextPaused && onCount <= 1) {
      setError("복습할 과목이 하나는 남아 있어야 해요.");
      return;
    }
    setError(null);
    setBusyId(target.id);
    try {
      await togglePaused.mutateAsync({ subjectId: target.id, paused: nextPaused });
    } catch (e) {
      await report(e, "설정을 저장하지 못했어요.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="복습 설정" maxHeight="85%">
      <View className="px-5 pb-3">
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
          하루 {dailyLimit}문항 · 과목 {onCount}/{choices.length} 켜짐
        </AppText>
      </View>

      <ScrollView className="min-h-0 shrink" contentContainerClassName="px-2 pb-1">
        <View className="px-3 pb-3">
          <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
            하루에 풀 문항 수
          </AppText>
          <View className="mt-2 flex-row gap-1.5">
            {DAILY_LIMIT_OPTIONS.map((n) => {
              const on = n === dailyLimit;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: setLimit.isPending }}
                  disabled={setLimit.isPending}
                  onPress={() => void changeLimit(n)}
                  className={[
                    "flex-1 items-center rounded-lg py-2",
                    on ? "bg-blue-600" : "bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700",
                    setLimit.isPending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <AppText
                    variant="sm"
                    weight="bold"
                    tabular
                    className={on ? "text-white" : "text-zinc-600 dark:text-zinc-300"}
                  >
                    {n}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <AppText variant="11" className="mt-1.5 text-zinc-500 dark:text-zinc-400" pretty>
            밀린 복습을 먼저 채우고, 남는 자리에 처음 보는 오답을 하루{" "}
            {Math.max(1, Math.round(dailyLimit / 2))}문항까지 새로 넣어요.
          </AppText>
        </View>

        {/* 연체가 크게 쌓였을 때만 보인다. 평소에 있으면 "정리해야 하나" 하는 불안만 준다. */}
        {overdueTotal >= BACKLOG_NUDGE_MIN && (
          <View className="mx-3 mb-3 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/30">
            <AppText variant="xs" weight="semibold" className="text-amber-900 dark:text-amber-200">
              밀린 복습 {overdueTotal}문항
            </AppText>
            {spreadDone == null ? (
              <>
                <AppText variant="11" className="mt-0.5 text-amber-800 dark:text-amber-200" pretty>
                  앞으로 며칠에 걸쳐 나눠서 다시 예약해요. 문항이 사라지지는 않아요.
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: spread.isPending, busy: spread.isPending }}
                  disabled={spread.isPending}
                  onPress={() => void spreadBacklog()}
                  className={[
                    "mt-2 self-start rounded-lg bg-amber-600 px-3 py-1.5 active:bg-amber-700",
                    spread.isPending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <AppText variant="xs" weight="bold" className="text-white">
                    {spread.isPending ? "정리하는 중..." : "밀린 복습 정리하기"}
                  </AppText>
                </Pressable>
              </>
            ) : (
              <AppText variant="11" className="mt-0.5 text-amber-800 dark:text-amber-200" pretty>
                {spreadDone}문항을 며칠에 나눠 다시 예약했어요.
              </AppText>
            )}
          </View>
        )}

        {/* 여덟 번 넘게 무너져 자동으로 접힌 문항. 조용히 사라지면 사용자는 데이터가 날아간
            걸로 읽으므로 어디 갔는지 여기서 말해준다. */}
        {suspendedTotal > 0 && (
          <View className="mx-3 mb-3 rounded-xl bg-zinc-100 px-3 py-2.5 dark:bg-zinc-800/60">
            <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
              접어둔 문제 {suspendedTotal}문항
            </AppText>
            {restoreDone == null ? (
              <>
                <AppText variant="11" className="mt-0.5 text-zinc-500 dark:text-zinc-400" pretty>
                  여덟 번 넘게 틀려서 복습에서 잠시 뺐어요. 간격을 좁혀도 안 풀리는 문제라, 해설을
                  먼저 보는 편이 빨라요.
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: restore.isPending, busy: restore.isPending }}
                  disabled={restore.isPending}
                  onPress={() => void restoreSuspended()}
                  className={[
                    "mt-2 self-start rounded-lg bg-zinc-700 px-3 py-1.5 active:bg-zinc-800 dark:bg-zinc-600 dark:active:bg-zinc-500",
                    restore.isPending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <AppText variant="xs" weight="bold" className="text-white">
                    {restore.isPending ? "되살리는 중..." : "다시 복습에 넣기"}
                  </AppText>
                </Pressable>
              </>
            ) : (
              <AppText variant="11" className="mt-0.5 text-zinc-500 dark:text-zinc-400" pretty>
                {restoreDone}문항을 며칠에 나눠 다시 넣었어요.
              </AppText>
            )}
          </View>
        )}

        {choices.length > 0 && (
          <AppText
            variant="xs"
            weight="semibold"
            className="px-3 pb-1 text-zinc-700 dark:text-zinc-300"
          >
            복습에 넣을 과목
          </AppText>
        )}
        <View>
          {choices.map((c) => {
            const on = !c.paused;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="switch"
                accessibilityState={{ checked: on, busy: busyId === c.id }}
                accessibilityLabel={c.name}
                onPress={() => void toggle(c)}
                className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/60"
              >
                <View className="min-w-0 flex-1">
                  <AppText
                    variant="sm"
                    weight="medium"
                    numberOfLines={1}
                    className={on ? "" : "text-zinc-400 dark:text-zinc-600"}
                  >
                    {c.name}
                  </AppText>
                  <AppText variant="xs" className="mt-0.5 text-zinc-400 dark:text-zinc-600">
                    {on
                      ? [
                          `복습 예약 ${c.scheduledCount}문항`,
                          // 1회독 중이면 예약 0에 대기만 수백인 과목이 흔하다. 예약만 보여주면
                          // "0문항"으로 떠서 끌 이유가 없어 보인다.
                          c.pendingCount > 0 ? `대기 ${c.pendingCount}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : `쉬는 중 · ${c.scheduledCount + c.pendingCount}문항 보관됨`}
                  </AppText>
                </View>
                <Switch on={on} busy={busyId === c.id} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {error && (
        <AppText variant="xs" className="px-5 pb-1 text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      <View className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <AppText variant="11" className="text-zinc-500 dark:text-zinc-400" pretty>
          끈 과목은 복습과 알림에 나오지 않아요. 진도는 지워지지 않고, 다시 켜면 밀린 문항을
          며칠에 나눠서 돌려줘요.
        </AppText>
      </View>
    </Sheet>
  );
}

// on/off 스위치(웹과 같은 치수: h-6 w-11, 손잡이 h-5 w-5). 저장이 도는 동안에는 살짝 흐려져서
// 눌린 게 반영 중이라는 걸 알린다. RN 기본 Switch 를 쓰지 않는 건 플랫폼마다 치수·색이 달라
// 웹 화면과 어긋나기 때문이다(설계서 §4.5 — 컨트롤은 웹 값 그대로 그린다).
function Switch({ on, busy }: { on: boolean; busy: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={[
        "h-6 w-11 shrink-0 justify-center rounded-full",
        on ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <View
        className="h-5 w-5 rounded-full bg-white"
        style={{ transform: [{ translateX: on ? 22 : 2 }] }}
      />
    </View>
  );
}
