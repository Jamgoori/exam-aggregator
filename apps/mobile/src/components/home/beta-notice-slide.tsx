import { FREE_UNTIL_LABEL, isFreeForAll, TRIAL_DAYS } from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import {
  BookOpen,
  CalendarCheck,
  FileText,
  Hammer,
  MessageSquareWarning,
  Sparkles,
} from "lucide-react-native";
import { Pressable, View } from "react-native";
import { markSeenThisSession, seenThisSession, type HomePopupControls, type HomePopupSource } from "./home-popup";
import { AppText } from "../app-text";
import { kvGet, kvSet } from "../../lib/kv";
import { useIsDark } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 홈에 들어왔을 때 뜨는 "아직 개발 중" 안내. 웹 apps/web/src/components/beta-notice-slide.tsx 이식.
//
// 로그인 여부는 보지 않는다 — 처음 들른 비회원일수록 "화면이 계속 바뀐다"와 "지금은 전부
// 무료"를 먼저 알아야 미완성 화면을 고장으로 읽지 않는다. 두 번째 문단(멤버십 무료)이 이
// 안내의 진짜 용건이다: 잠긴 기능을 만나기 전에 "지금은 다 열려 있다"를 알려야 잠금 아이콘을
// 보고 지레 발길을 돌리지 않는다.
//
// 빈도는 두 겹:
//   - 앱 실행(방문)당 한 번 — 메모리(웹 sessionStorage 파리티).
//   - "다음부터 보지 않기" 를 누르면 영영 안 뜬다 — kv `beta-notice-hidden-v1` = "1"(영구).
// 문구를 바꿔서 이미 끈 사람에게도 다시 알리고 싶으면 아래 키의 버전을 올린다.

// 아이콘 색은 웹 클래스 그대로(다크 대응 포함). 고정 hex 로 두면 다크에서 어두운 판 위에
// 어두운 아이콘이 얹혀 사라진다(설계서 §4.1 — 웹 dark: 변형과 1:1).
const FileTextIcon = themedIcon(FileText);
const ReportIcon = themedIcon(MessageSquareWarning);
const SparklesIcon = themedIcon(Sparkles);
const BookOpenIcon = themedIcon(BookOpen);
const CalendarCheckIcon = themedIcon(CalendarCheck);
// 에메랄드 판 안의 아이콘(웹은 부모 p/ul 의 text-emerald-900 dark:text-emerald-200 을 상속).
const EMERALD_ICON = "text-emerald-900 dark:text-emerald-200";

const HIDDEN_KEY = "beta-notice-hidden-v1";
const SHOWN_KEY = "beta-notice-shown-v1";

async function shouldSkip(): Promise<boolean> {
  return (await kvGet(HIDDEN_KEY)) === "1" || seenThisSession(SHOWN_KEY);
}

export const betaNoticeSource: HomePopupSource = {
  id: "beta-notice",
  resolve: async () => {
    if (await shouldSkip()) return null;
    return {
      id: "beta-notice",
      title: "개발 중 안내",
      // 이 장이 눈앞에 온 순간에만 "이번 실행에 봤다"로 기록한다. 뒷장에 실려만 있다가 못
      // 보고 닫힌 경우에는 기록하지 않아 다음 실행에 다시 뜬다.
      onShown: () => markSeenThisSession(SHOWN_KEY),
      body: () => <BetaNoticeBody />,
      footer: (controls) => <BetaNoticeFooter {...controls} />,
    };
  },
};

// 머리말 그라데이션(웹 `from-blue-50/80 to-transparent dark:from-blue-950/30`).
// LinearGradient 는 className 을 못 받으므로 테마별 색을 직접 고른다 — 라이트 고정으로 두면
// 다크에서 `text-foreground` 제목(거의 흰색)이 밝은 blue-50 위에 얹혀 읽히지 않는다.
const BETA_HEADER_GRADIENT = {
  // blue-50 #eff6ff · 80% / blue-950 #172554 · 30%
  light: ["rgba(239,246,255,0.8)", "rgba(239,246,255,0)"] as const,
  dark: ["rgba(23,37,84,0.3)", "rgba(23,37,84,0)"] as const,
};

function BetaNoticeBody() {
  const dark = useIsDark();
  return (
    <>
      {/* pr-12 — 판 오른쪽 위의 닫기(X)가 이 자리에 얹힌다. */}
      <LinearGradient
        colors={dark ? BETA_HEADER_GRADIENT.dark : BETA_HEADER_GRADIENT.light}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <View className="flex-row items-center gap-3 border-b border-zinc-100 px-5 pt-4 pr-12 pb-4 dark:border-zinc-800">
          <View className="h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600">
            <Hammer size={17} color="#ffffff" />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row">
              <View className="rounded-full bg-blue-100 px-2 py-0.5 dark:bg-blue-950/60">
                <AppText variant="10" weight="extrabold" allowFontScaling={false} className="text-blue-700 dark:text-blue-300">
                  개발 중
                </AppText>
              </View>
            </View>
            <AppText variant="15" weight="bold" className="mt-1" pretty>
              공모아는 아직 만드는 중이에요
            </AppText>
          </View>
        </View>
      </LinearGradient>

      <View className="px-5 pt-4 pb-4">
        {/* 두 문장을 한 문단에 붙이면 좁은 폭에서 "그러다"가 첫 줄 끝에 혼자 남는다. */}
        <AppText variant="13" className="text-zinc-600 dark:text-zinc-300" pretty>
          만들어가는 중이라 <B>화면과 기능이 바뀔 수 있어요.</B>
        </AppText>
        <AppText variant="13" className="mt-1 text-zinc-600 dark:text-zinc-300" pretty>
          그러다 보니 가끔 어색한 부분이나 오류가 보일 수 있어요.
        </AppText>

        {/* 자료가 비어 보이는 건 사이트가 부실한 게 아니라 아직 올리는 중이라는 뜻이다.
            이 말이 없으면 찾던 시험지가 없을 때 그대로 나가고 다시 안 온다. */}
        <View className="mt-3 flex-row gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50">
          <View className="mt-1">
            <FileTextIcon size={14} colorClassName="text-blue-500 dark:text-blue-400" />
          </View>
          <AppText variant="13" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300" pretty>
            <B>기출문제와 해설도 계속 올라오는 중</B>이에요. 지금 안 보이는 시험지나 해설도 차례로 채워지고 있으니 조금만 기다려 주세요.
          </AppText>
        </View>

        <View className="mt-3 flex-row flex-wrap items-center">
          <AppText variant="13" className="text-zinc-600 dark:text-zinc-300" pretty>
            이상한 걸 발견하면 문항 아래{" "}
          </AppText>
          <View className="flex-row items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            <ReportIcon size={11} colorClassName="text-zinc-600 dark:text-zinc-300" />
            <AppText variant="13" weight="semibold" className="text-zinc-600 dark:text-zinc-300">
              오류 신고
            </AppText>
          </View>
          <AppText variant="13" className="text-zinc-600 dark:text-zinc-300" pretty>
            {" "}로 알려주세요. 보이는 대로 고치고 있어요.
          </AppText>
        </View>

        {/* 이 장의 용건. 위 안내와 같은 톤으로 흘려보내지 않고 색 있는 판으로 띄운다 —
            잠긴 기능을 만나기 전에 이 문장을 봐야 의미가 있다. */}
        <View className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
          <View className="flex-row items-center gap-1.5">
            <SparklesIcon size={15} colorClassName={EMERALD_ICON} />
            <AppText variant="sm" weight="bold" className="min-w-0 flex-1 text-emerald-900 dark:text-emerald-200" pretty>
              멤버십 기능, 지금은 전부 무료예요
            </AppText>
          </View>
          {/* 전면 무료 이벤트 기간에는 "가입하면 60일"이 아니라 "언제까지 전부 무료"가 맞는
              말이다. 날짜·기간 모두 core 상수에서 오므로 이벤트가 끝나면 아래 문장으로
              저절로 돌아간다. */}
          <AppText variant="13" className="mt-1.5 text-emerald-800/90 dark:text-emerald-300/80" pretty>
            {isFreeForAll() ? (
              <>
                <B tone="emerald">{FREE_UNTIL_LABEL}까지</B> 멤버십 전체가 열려 있어요. 결제도 카드 등록도 없어요.
              </>
            ) : (
              <>
                가입하는 순간부터 <B tone="emerald">{TRIAL_DAYS}일</B> 동안 멤버십 전체가 열려요.
              </>
            )}
          </AppText>
          <View className="mt-2.5 gap-1.5">
            <BetaPerk icon={<BookOpenIcon size={13} colorClassName={EMERALD_ICON} />}>문제지 해설 제한 없이 보기</BetaPerk>
            <BetaPerk icon={<CalendarCheckIcon size={13} colorClassName={EMERALD_ICON} />}>오늘의 복습 — 잊을 때쯤 다시 풀기</BetaPerk>
            <BetaPerk icon={<SparklesIcon size={13} colorClassName={EMERALD_ICON} />}>오답노트 안에서 바로 해설 보기</BetaPerk>
          </View>
        </View>
      </View>
    </>
  );
}

// "다음부터 보지 않기"를 체크박스가 아니라 버튼으로 둔다. 체크박스는 누른 뒤 닫기까지 두 번
// 눌러야 하고, 안 누르고 닫으면 아무 일도 안 일어난다. 왼쪽은 이 장만 치우고(dismiss) 다음
// 장으로 넘어간다 — 이 안내가 싫다고 뒤에 실린 다른 안내까지 못 보게 할 이유는 없다.
function BetaNoticeFooter({ close, dismiss }: HomePopupControls) {
  return (
    <View className="flex-row gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void kvSet(HIDDEN_KEY, "1");
          dismiss();
        }}
        className="flex-1 items-center rounded-xl border border-zinc-200 py-2.5 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"
      >
        <AppText variant="13" weight="medium" className="text-zinc-600 dark:text-zinc-400">
          다음부터 보지 않기
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={close}
        className="flex-[1.2] items-center rounded-xl bg-blue-600 py-2.5 active:bg-blue-700"
      >
        <AppText variant="sm" weight="bold" className="text-white">
          알겠어요
        </AppText>
      </Pressable>
    </View>
  );
}

function B({ children, tone }: { children: React.ReactNode; tone?: "emerald" }) {
  return (
    <AppText
      variant="13"
      weight="bold"
      className={tone === "emerald" ? "text-emerald-900 dark:text-emerald-100" : "text-zinc-900 dark:text-zinc-100"}
    >
      {children}
    </AppText>
  );
}

function BetaPerk({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View className="flex-row items-start gap-2">
      <View className="mt-0.5 shrink-0">{icon}</View>
      <AppText variant="13" className="min-w-0 flex-1 text-emerald-900/85 dark:text-emerald-200/85" pretty>
        {children}
      </AppText>
    </View>
  );
}
