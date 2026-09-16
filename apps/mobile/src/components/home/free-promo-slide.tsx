import { FREE_UNTIL_LABEL, isFreeForAll, kstDateKey } from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router, type Href } from "expo-router";
import { BrainCircuit, FileCheck2, NotebookPen, Sparkles } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { markSeenThisSession, seenThisSession, type HomePopupControls, type HomePopupSource } from "./home-popup";
import { AppText } from "../app-text";
import { kvGet, kvSet } from "../../lib/kv";

// 홈에 뜨는 "전면 무료" 이벤트 팝업 — 비회원 전용, 홈 팝업 슬라이드의 첫 장.
// 웹 apps/web/src/components/free-promo-slide.tsx 이식.
//
// 왜 비회원에게만: 이 장이 파는 것은 "가입"이다. 이미 로그인한 사람에게는 이벤트가 이미
// 적용돼 있어(core isFreeForAll) 누를 것이 없는 광고가 되고, 정작 필요한 안내(복습 유도)를
// 한 칸 뒤로 민다. 기간이 끝나면 resolve 가 null 을 돌려줘 이 장은 저절로 사라진다.
//
// 빈도(팝업 피로를 줄이는 두 겹) — 출석 광고와 같은 방식:
//   - 앱 실행(방문)당 한 번 — 메모리(웹 sessionStorage 파리티, home-popup.ts 머리말).
//   - "오늘 하루 보지 않기" — kv 에 KST 날짜. 그 날은 안 뜬다.
// 영구 숨김을 두지 않은 건 이벤트가 기간 한정이라서다.
//
// CTA 는 웹과 같이 `/signup` 을 가리킨다. 앱에도 가입 화면이 따로 있는 건 아니고(소셜 로그인
// = 가입), `app/signup.tsx` 가 웹 app/signup/page.tsx 처럼 `/login` 으로 넘기는 리다이렉트다
// (§5 `/signup` 행) — 웹과 같은 주소를 쓰면 딥링크·문구가 한 매핑으로 남는다.
const HIDDEN_KEY = "free-promo-hidden-day-v1";
const SHOWN_KEY = "free-promo-shown-v1";

async function shouldSkip(): Promise<boolean> {
  // kv 는 저장소가 깨져도 null 을 돌려준다(웹은 예외 시 "이미 봤다"로 쳤지만, 여기서는
  // 구분할 방법이 없다 — 최악이라야 다음 실행에 한 번 더 뜬다).
  return (await kvGet(HIDDEN_KEY)) === kstDateKey() || seenThisSession(SHOWN_KEY);
}

export const freePromoSource: HomePopupSource = {
  id: "free-promo",
  resolve: async ({ signedIn }) => {
    if (signedIn || !isFreeForAll() || (await shouldSkip())) return null;
    return {
      id: "free-promo",
      title: "전면 무료 이벤트",
      // 히어로가 짙은 색이라 판의 닫기(X)를 반투명 칩으로 띄우고, 광고 장이라 판도
      // 한 단계 넓게 쓴다(home-popup.ts).
      darkHeader: true,
      wide: true,
      onShown: () => markSeenThisSession(SHOWN_KEY),
      body: () => <FreePromoBody />,
      footer: (controls) => <FreePromoFooter {...controls} />,
    };
  },
};

function FreePromoBody() {
  return (
    <>
      {/* 히어로. 판(흰 배경) 위에 색을 통째로 덮어 첫인상을 바꾼다 — 이 장은 "읽어주세요"가
          아니라 "이건 놓치면 손해다"를 먼저 말해야 한다. pr-12 는 판 오른쪽 위 닫기(X) 자리.
          웹의 빛 번짐 장식(blur-2xl)과 promo-shine 그라데이션 글자는 RN 에 대응이 없어 뺐다 —
          문구·색·순서는 그대로다. */}
      <LinearGradient
        colors={["#1e3a8a", "#4338ca", "#7e22ce"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View className="px-5 pt-5 pr-12 pb-6">
          <View className="flex-row">
            <View className="flex-row items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
              <Sparkles size={12} color="#ffffff" />
              <AppText variant="11" weight="extrabold" className="text-white">
                기간 한정 이벤트
              </AppText>
            </View>
          </View>

          <AppText variant="2xl" weight="extrabold" className="mt-3 text-white" pretty>
            {FREE_UNTIL_LABEL}까지{"\n"}멤버십 <AppText variant="2xl" weight="extrabold" className="text-amber-300">전면 무료</AppText>
          </AppText>

          <AppText variant="13" className="mt-2.5 text-white/85" pretty>
            결제도 카드 등록도 없어요. <AppText variant="13" weight="bold" className="text-white">가입만 하면</AppText> 유료 기능이 전부 열립니다.
          </AppText>
        </View>
      </LinearGradient>

      {/* 무엇이 열리는지. 이벤트 문구만 있고 내용이 없으면 "무료로 뭘 준다는 거지"에서 멈춘다. */}
      <View className="gap-2 px-5 pt-4 pb-4">
        <Perk
          icon={<BrainCircuit size={16} color="#7c3aed" />}
          tone="violet"
          title="AI 약점 진단"
          desc="내가 틀린 문항을 개념 단위로 모아 약한 곳과 극복법까지 짚어줘요."
        />
        <Perk
          icon={<NotebookPen size={16} color="#2563eb" />}
          tone="blue"
          title="오답노트 · 오늘의 복습"
          desc="틀린 문제를 잊을 때쯤 다시 꺼내줘요. 해설도 그 자리에서 바로."
        />
        <Perk
          icon={<FileCheck2 size={16} color="#059669" />}
          tone="emerald"
          title="2026년 최신 해설 배포 중"
          desc="올해 시험까지 문항별 해설을 계속 올리고 있어요."
          badge="NEW"
        />
      </View>
    </>
  );
}

const TONES = {
  violet: "bg-violet-50 dark:bg-violet-950/40",
  blue: "bg-blue-50 dark:bg-blue-950/40",
  emerald: "bg-emerald-50 dark:bg-emerald-950/40",
} as const;

function Perk({
  icon,
  tone,
  title,
  desc,
  badge,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <View className="flex-row gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50">
      <View className={["mt-0.5 h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONES[tone]].join(" ")}>
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <AppText variant="13" weight="bold" className="text-zinc-900 dark:text-zinc-100">
            {title}
          </AppText>
          {badge && (
            <View className="rounded bg-rose-500 px-1.5 py-px">
              <AppText variant="10" weight="extrabold" allowFontScaling={false} className="text-white">
                {badge}
              </AppText>
            </View>
          )}
        </View>
        <AppText variant="13" className="mt-0.5 text-zinc-600 dark:text-zinc-400" pretty>
          {desc}
        </AppText>
      </View>
    </View>
  );
}

// 오른쪽(주요) 버튼은 가입(= `/signup` → 로그인)으로 보낸다. 이 장의 용건이 그것이고,
// 비회원에게만 뜬다. 왼쪽은 이 장만 오늘 하루 치운다 — 뒤에 실린 다른 안내까지 같이 없애지 않는다.
function FreePromoFooter({ close, dismiss }: HomePopupControls) {
  return (
    <View className="flex-row gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void kvSet(HIDDEN_KEY, kstDateKey());
          dismiss();
        }}
        className="flex-1 items-center rounded-xl border border-zinc-200 py-2.5 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"
      >
        <AppText variant="13" weight="medium" className="text-zinc-500 dark:text-zinc-400">
          오늘 하루 보지 않기
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          close();
          router.push("/signup" as Href);
        }}
        className="flex-[1.4] items-center overflow-hidden rounded-xl active:opacity-90"
      >
        <LinearGradient
          colors={["#4338ca", "#7e22ce"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ alignSelf: "stretch", alignItems: "center", paddingVertical: 10, borderRadius: 12 }}
        >
          <AppText variant="sm" weight="extrabold" className="text-white">
            3초 만에 무료로 시작하기
          </AppText>
        </LinearGradient>
      </Pressable>
    </View>
  );
}
