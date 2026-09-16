import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  isAttendanceOpen,
  kstDateKey,
} from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { markSeenThisSession, seenThisSession, type HomePopupControls, type HomePopupSource } from "./home-popup";
import { AppText } from "../app-text";
import { kvGet, kvSet } from "../../lib/kv";

// 홈에 뜨는 출석 이벤트 광고. 웹 apps/web/src/components/attendance-promo-slide.tsx 이식 —
// 기업 이벤트 팝업과 같은 모양(광고 한 장 + 아래 "오늘 하루 보지 않기 / 닫기" 두 버튼)이다.
// 누르면 출석 화면으로 간다(회원=출석 현황, 비회원=로그인).
//
// **웹과 다른 곳 하나 — 광고를 그리는 방식.** 웹은 `/attendance-promo.png`(next/og 로 그린
// PNG 한 장)를 띄운다. 설계서 §4.5 #30 은 그 파일을 `apps/mobile/assets/attendance-promo.png`
// 로 번들하라고 적었는데, 그 PNG 는 레포에 있는 정적 파일이 아니라 웹 라우트가 요청마다
// 그려 내는 결과물이라(apps/web/src/app/attendance-promo.png/route.ts) 이 환경에서 만들어
// 넣을 수 없다. 그래서 같은 내용을 같은 순서·같은 숫자로 네이티브로 그린다 — 숫자는 광고
// 원본과 같은 출처(core attendance.ts)에서 오므로 둘이 갈라지지 않는다.
// **에셋이 들어오면 이 본문을 `<Image source={require("../../../assets/attendance-promo.png")}/>`
// 한 줄로 바꾸고 슬라이드에 `aspect: 720 / 792` 를 붙이면 된다**(슬라이더는 aspect 를 이미
// 지원한다 — home-popup-slider.tsx 의 PANEL_MAX_WIDTH).
//
// 빈도(팝업 피로를 줄이는 두 겹):
//   - 앱 실행(방문)당 한 번 — 메모리(웹 sessionStorage 파리티).
//   - "오늘 하루 보지 않기" — kv 에 KST 날짜. 그 날은 안 뜬다.
// 하루 경계는 출석 자체와 같은 KST 달력 날짜다(core kstDateKey) — 광고가 말하는 "오늘"과
// 도장이 찍히는 "오늘"이 다르면 안 된다.
const HIDDEN_KEY = "attendance-promo-hidden-day-v1";
const SHOWN_KEY = "attendance-promo-shown-v1";

async function shouldSkip(): Promise<boolean> {
  return (await kvGet(HIDDEN_KEY)) === kstDateKey() || seenThisSession(SHOWN_KEY);
}

// 그림에 적힌 내용을 그대로 문장으로. 숫자는 그림과 같은 출처(core)에서 받아 둘이
// 갈라지지 않게 한다(웹 ALT 와 같은 문장).
const ALT = [
  "출석체크 이벤트.",
  `하루 ${ATTENDANCE_MIN_QUESTIONS}문항을 풀면 그날 출석으로 인정돼요.`,
  ATTENDANCE_MILESTONES.map((m) => `${m.days}일 출석 시 멤버십 ${m.grantDays}일`).join(", "),
  `— 한 달이면 멤버십 최대 ${ATTENDANCE_MONTHLY_MAX_DAYS}일 무료.`,
].join(" ");

export const attendancePromoSource: HomePopupSource = {
  id: "attendance-promo",
  // 출석체크가 닫혀 있는 동안(전면 무료 이벤트)에는 광고 자체를 싣지 않는다 — 눌러 봐야
  // 도장이 찍히지 않는 화면으로 보내게 된다.
  resolve: async ({ attendanceHref }) => {
    if (!isAttendanceOpen() || (await shouldSkip())) return null;
    return {
      id: "attendance-promo",
      title: "출석체크 이벤트",
      // 눈앞에 온 순간에만 "이번 실행에 봤다"로 기록한다.
      onShown: () => markSeenThisSession(SHOWN_KEY),
      body: (controls) => <AttendancePromoBody href={attendanceHref} {...controls} />,
      footer: (controls) => <AttendancePromoFooter {...controls} />,
    };
  },
};

function AttendancePromoBody({ href, close }: { href: string } & HomePopupControls) {
  const last = ATTENDANCE_MILESTONES.length - 1;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${ALT} 출석 현황 보러 가기`}
      onPress={() => {
        close();
        router.push(href as Href);
      }}
      className="active:opacity-90"
    >
      {/* 위쪽 색 머리 / 아래쪽 흰 몸통 — 배경 한 장으로 두면 광고라기보다 안내문처럼
          보인다(웹 attendance-promo-card.tsx 주석). */}
      <LinearGradient colors={["#06664a", "#12b382"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <View className="px-5 pt-6 pr-12 pb-5">
          <View className="flex-row">
            <View className="rounded-full bg-white px-3 py-1">
              <AppText variant="xs" weight="bold" className="text-[#06664a]">
                출석체크 이벤트
              </AppText>
            </View>
          </View>
          <AppText variant="2xl" weight="bold" className="mt-3.5 text-white" pretty>
            매일 풀면,{"\n"}멤버십이 늘어나요
          </AppText>
          <AppText variant="sm" className="mt-2 text-emerald-100" pretty>
            하루 {ATTENDANCE_MIN_QUESTIONS}문항만 풀면 그날 출석
          </AppText>
        </View>
      </LinearGradient>

      {/* 몸통: 단계표가 이 광고의 전부다. 마지막 단계만 색을 바꾼다 — 다섯 칸이 전부 같은
          색이면 "끝까지 가면 두 배"라는 이 표의 결론이 안 보인다. */}
      <View className="gap-4 px-4 pt-4 pb-4">
        <View className="flex-row gap-1.5">
          {ATTENDANCE_MILESTONES.map((m, i) => (
            <View
              key={m.days}
              className={[
                "flex-1 items-center rounded-2xl border py-2.5",
                i === last
                  ? "border-orange-300 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/30"
                  : "border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60",
              ].join(" ")}
            >
              <AppText
                variant="sm"
                weight="bold"
                tabular
                className={i === last ? "text-amber-700 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-100"}
              >
                {m.days}일
              </AppText>
              <AppText variant="10" className="mt-1 text-zinc-500 dark:text-zinc-400">
                멤버십
              </AppText>
              <AppText
                variant="13"
                weight="bold"
                tabular
                className={i === last ? "text-amber-500" : "text-[#12b382]"}
              >
                +{m.grantDays}일
              </AppText>
            </View>
          ))}
        </View>

        {/* 결론 한 줄. 위 표를 안 읽고 닫는 사람도 이 문장은 본다. */}
        <View className="flex-row items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3.5 dark:bg-emerald-950/30">
          <AppText variant="base" weight="bold" className="text-zinc-900 dark:text-zinc-100" pretty>
            한 달이면 멤버십 최대 {ATTENDANCE_MONTHLY_MAX_DAYS}일
          </AppText>
          <View className="rounded-lg bg-[#12b382] px-2.5 py-1">
            <AppText variant="sm" weight="bold" className="text-white">
              무료
            </AppText>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// 이벤트 팝업의 관례대로 아래 띠에 두 버튼을 나란히. 왼쪽이 "오늘 하루 보지 않기",
// 오른쪽이 "닫기" — 위치를 바꾸면 습관적으로 누르던 사람이 원하지 않는 쪽을 누른다.
// 왼쪽은 이 장만 치우고 다음 장으로 넘어간다(뒤에 실린 안내는 남는다).
function AttendancePromoFooter({ close, dismiss }: HomePopupControls) {
  return (
    <View className="flex-row border-t border-zinc-200 dark:border-zinc-800">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void kvSet(HIDDEN_KEY, kstDateKey());
          dismiss();
        }}
        className="flex-1 items-center border-r border-zinc-200 py-3.5 active:bg-zinc-50 dark:border-zinc-800 dark:active:bg-zinc-800"
      >
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400" pretty>
          오늘 하루 보지 않기
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={close}
        className="flex-1 items-center py-3.5 active:bg-zinc-50 dark:active:bg-zinc-800"
      >
        <AppText variant="sm" weight="semibold" className="text-zinc-800 dark:text-zinc-100">
          닫기
        </AppText>
      </Pressable>
    </View>
  );
}
