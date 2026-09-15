import { FREE_UNTIL_LABEL, KST_TIME_ZONE, streakTier } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Skeleton } from "../skeleton";

// 요약 타일 줄(웹 mypage/page.tsx 429-462): CBT 응시 · 연속 학습(등급 필) · 남은 오답 · 멤버십.
// 타일 규격은 웹 `min-w-[7rem] flex-1 rounded-xl border px-4 py-3`(§4.5 #5 StatTile 과 같은 값).

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="min-w-[7rem] flex-1 gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
        {label}
      </AppText>
      {children}
    </View>
  );
}

export function StatsTiles({
  attemptCount,
  streakDays,
  // null 이면 아직 집계 전(스켈레톤).
  totalUnresolved,
  membership,
}: {
  attemptCount: number;
  streakDays: number;
  totalUnresolved: number | null;
  membership: MembershipTileProps;
}) {
  const tier = streakTier(streakDays);
  return (
    <View className="flex-row flex-wrap gap-3">
      <Tile label="CBT 응시">
        <AppText variant="xl" weight="semibold" tabular>
          {attemptCount}
        </AppText>
      </Tile>
      <Tile label="연속 학습">
        <View className="flex-row items-baseline gap-1.5">
          <AppText variant="xl" weight="semibold" tabular>
            {streakDays}일
          </AppText>
          {tier && (
            <View className={["rounded-full px-2 py-0.5", tier.className].join(" ")}>
              <AppText variant="xs" weight="medium" allowFontScaling={false} className={tier.className}>
                {tier.label}
              </AppText>
            </View>
          )}
        </View>
      </Tile>
      <Tile label="남은 오답">
        {totalUnresolved === null ? (
          <Skeleton className="h-7 w-16 rounded-lg" />
        ) : (
          <AppText
            variant="xl"
            weight="semibold"
            tabular
            className={totalUnresolved > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
          >
            {totalUnresolved}문항
          </AppText>
        )}
      </Tile>
      <MembershipTile {...membership} />
    </View>
  );
}

// 만료일을 "9월 29일까지" 로. 해가 바뀌면 연도까지 적는다 — 12월에 보는 "1월 5일"이 올해인지
// 내년인지 헷갈리면 남은 일수를 다시 세게 된다. 타임존은 언제나 KST(웹 formatExpiry).
export function formatExpiry(iso: string, now: Date): string {
  const year = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: KST_TIME_ZONE }).slice(0, 4);
  const expiry = new Date(iso);
  return expiry.toLocaleDateString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    ...(year(expiry) === year(now) ? {} : { year: "numeric" as const }),
    month: "long",
    day: "numeric",
  });
}

// 만료가 가까우면(D-7) 색을 바꾼다. 끊기기 전에 한 번은 눈에 걸려야 한다는 게 이 칸의 존재
// 이유다 — 평상시엔 조용하고, 급할 때만 목소리를 낸다.
const MEMBERSHIP_SOON_DAYS = 7;

export type MembershipTileProps = {
  admin: boolean;
  premium: boolean;
  // 전면 무료 이벤트 기간인지. 이때는 남은 일수를 세지 않으므로 daysLeft 가 언제나 null 이라,
  // 아무 말도 안 하면 "무제한"만 덩그러니 남는다.
  freeForAll: boolean;
  // 며칠 남았는지(출처 무관). 무기한이거나 무료 회원이면 null.
  daysLeft: number | null;
  // "9월 29일" — 화면 본문에서 이미 만들어 넘긴다.
  expiryLabel: string | null;
  // membership-get 응답 전이면 값 대신 스켈레톤.
  loading?: boolean;
};

// 요약 타일 줄 옆에 붙는 멤버십 칸(웹 MembershipTile). 적는 건 둘뿐이다: 며칠 남았나(숫자)와
// 언제까지인가(날짜). 기간의 출처(체험·출석·결제)는 일부러 적지 않는다 — 눌러서 /membership
// 의 CurrentStatus 에서 본다.
export function MembershipTile({ admin, premium, freeForAll, daysLeft, expiryLabel, loading }: MembershipTileProps) {
  const soon = daysLeft != null && daysLeft <= MEMBERSHIP_SOON_DAYS;

  // 관리자는 멤버십과 무관하게 모든 기능을 쓴다 — 만료가 있는 것처럼 보이면 거짓말이다.
  // note 가 null 이면 아랫줄을 아예 안 그린다(이 칸은 상태를 알려주는 자리이지 파는 자리가 아니다).
  const { value, note }: { value: string; note: string | null } = admin
    ? { value: "무제한", note: "관리자 계정" }
    : freeForAll
      ? { value: "전체 무료", note: `${FREE_UNTIL_LABEL}까지` }
      : premium && daysLeft != null && expiryLabel
        ? { value: `${daysLeft}일`, note: `${expiryLabel}까지` }
        : premium
          ? { value: "무제한", note: null }
          : { value: "무료 회원", note: null };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="멤버십"
      onPress={() => router.push("/membership" as Href)}
      className={[
        "min-w-[7rem] flex-1 gap-1 rounded-xl border px-4 py-3",
        soon
          ? "border-amber-300 bg-amber-50/50 active:border-amber-400 dark:border-amber-800 dark:bg-amber-950/20"
          : "border-zinc-200 active:border-zinc-300 dark:border-zinc-700 dark:active:border-zinc-600",
      ].join(" ")}
    >
      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
        멤버십
      </AppText>
      {loading ? (
        <Skeleton className="h-7 w-16 rounded-lg" />
      ) : (
        <>
          <View className="flex-row items-baseline gap-1">
            <AppText
              variant="xl"
              weight="semibold"
              tabular
              className={
                soon
                  ? "text-amber-700 dark:text-amber-400"
                  : premium || admin
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400 dark:text-zinc-500"
              }
            >
              {value}
            </AppText>
            {/* "42일"만 있으면 쓴 기간인지 남은 기간인지 모른다. 숫자가 있을 때만 붙인다. */}
            {daysLeft != null && !admin && premium && (
              <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
                남음
              </AppText>
            )}
          </View>
          {note && (
            <AppText
              variant="11"
              weight={soon ? "medium" : "normal"}
              className={soon ? "text-amber-700 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-600"}
            >
              {note}
            </AppText>
          )}
        </>
      )}
    </Pressable>
  );
}
