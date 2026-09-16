import { newItemsForLimit } from "@gongmoa/core";
import { Check, ChevronDown, Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, ScrollView, Pressable, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { AppText } from "../app-text";
import { Sheet } from "../sheet";
import { themedIcon } from "../../theme/icons";

// 복습이 어떻게 돌아가는지 설명하는 시트(카드 헤더의 ? 버튼) — 웹 review-guide-modal.tsx 1:1.
//
// 카드 본문에 설명을 안 붙이고 여기로 몰아둔 이유는 웹과 같다: 매일 보는 자리에 상시 설명이
// 있으면 정작 매일 확인해야 할 "오늘 몇 문항"이 밀려난다. 여기는 사용자가 궁금해서 스스로 연
// 자리라 길어도 된다. 순서도 웹과 같은 시간순(무엇인지 → 어떻게 움직이는지 → 오늘 뭘 하면
// 되는지 → 그다음에 생기는 의문)이고, ease·lapses·SRS 같은 말은 한 번도 쓰지 않는다.
const CheckIcon = themedIcon(Check);
const XIcon = themedIcon(X);
const ChevronIcon = themedIcon(ChevronDown);
const SparklesIcon = themedIcon(Sparkles);

export function ReviewGuideSheet({
  visible,
  dailyLimit,
  onClose,
}: {
  visible: boolean;
  dailyLimit: number;
  onClose: () => void;
}) {
  const newLimit = newItemsForLimit(dailyLimit);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="복습이 어떻게 돌아가나요?"
      icon={<SparklesIcon size={17} colorClassName="text-white" />}
      maxHeight="88%"
    >
      <ScrollView className="min-h-0 shrink" contentContainerClassName="px-5 pt-4 pb-2">
        {/* 핵심 3장은 항상 펼쳐둔다. 이것만 읽고 닫아도 기능을 쓸 수 있어야 한다. */}
        <Step n={1} title="틀린 문제는 잊어버릴 때쯤 다시 나와요">
          <P first>배운 건 하루만 지나도 절반이 날아가요.</P>
          <P>
            그래서 <B>딱 잊어버릴 때쯤</B> 다시 보여줘요. 그때 다시 보면 훨씬 오래 남아요.
          </P>
          <P>언제 다시 볼지는 문제마다 따로 정해요. 직접 고르지 않아도 돼요.</P>
        </Step>

        <Step n={2} title="맞히면 멀어지고, 틀리면 가까워져요">
          <P first>한 문제가 어떻게 움직이는지 볼까요?</P>
          <Timeline visible={visible} />
          <P>
            계속 맞히면 점점 안 나와요. 그게 <B>외웠다</B>는 뜻이에요.
          </P>
          {/* "틀리면 처음부터"를 무조건으로 쓰지 않는다 — 예정일 전에 회독·섞어풀기로 만나
              틀린 건 간격만 반감하고 실패로 세지 않는다(core srs.ts 의 조기 실패). */}
          <P>
            그러다 복습에서 한 번 틀리면 다시 처음부터예요. 가까워졌다 멀어졌다 하면서, 진짜 아는
            문제만 조용히 사라져요.
          </P>
        </Step>

        <Step n={3} title="오늘은 오늘 것만 하면 돼요" last>
          <P first>
            하루에 <B>{dailyLimit}문항</B>만 나와요.
          </P>
          <P>
            밀린 게 300개라도 오늘 화면엔 {dailyLimit}개만 떠요. 그것만 끝내면 <B>오늘은 끝</B>
            이에요. 더 안 해도 돼요.
          </P>
        </Step>

        {/* 아래는 접어둔다. 한 번에 다 보이면 스크롤 길이만 보고 닫는다. */}
        <AppText
          variant="11"
          weight="bold"
          className="mt-6 mb-1 tracking-wide text-zinc-400 dark:text-zinc-500"
        >
          더 궁금하면
        </AppText>

        <Faq q="맞혔는데 왜 또 나와요?">
          <P first>한 번 맞힌 거랑 아는 건 달라요.</P>
          <P>
            찍어서 맞았을 수도 있고, 오늘은 기억나도 다음 주엔 잊을 수도 있어요. 그래서{" "}
            <B>간격을 두고</B> 한 번 더 물어봐요. 거기서 또 맞히면 그다음엔 훨씬 나중에 나와요.
          </P>
        </Faq>

        {/* 복습 세션 밖의 채점(회독·섞어풀기)도 스케줄에 들어간다. 공시생의 기본 학습은
            회독이라 이 경로로 채점되는 양이 복습 세션보다 많다. */}
        <Faq q="복습 말고 그냥 문제지 풀 때도 반영되나요?">
          <P first>
            네. 회독이든 섞어풀기든 <B>채점되면 다 반영</B>돼요.
          </P>
          <P>
            다만 예정일보다 일찍 만난 문제는 살살 반영해요. 20일 뒤에 보라고 잡아둔 문제를 3일
            만에 맞혔다면 그건 3일치 기억이라, 다음 날짜가 조금만 밀려요.
          </P>
          <P>
            틀렸을 때도 같아요. 예정일이 한참 남았는데 틀린 건 <B>실패로 안 쳐요.</B> 다시 나올
            때까지가 절반으로 줄기만 하고, 접어두는 횟수에도 안 들어가요. 대신 오늘 안에 한 번 더
            나와요.
          </P>
        </Faq>

        <Faq q="제 오답은 훨씬 많은데 왜 조금만 나와요?">
          <P first>
            나머지는 <B>차례를 기다리는 중</B>이에요. 없어진 게 아니에요.
          </P>
          <P>
            한꺼번에 다 넣으면 며칠 뒤에 복습할 게 수백 개씩 몰려요. 그러면 아무도 못 해요. 그래서
            하루에 <B>{newLimit}개씩만</B> 새로 넣어요.
          </P>
          <P>
            밀린 복습이 많은 날은 새 문제를 아예 안 넣어요. 밀린 걸 먼저 비우는 게 순서니까요.
          </P>
          <Note>
            기다리는 문제도 오답노트의 <B>섞어풀기</B>로는 지금 바로 풀 수 있어요.
          </Note>
        </Faq>

        <Faq q="며칠 쉬면 엄청 쌓이나요?">
          <P first>
            아니요. 쉬는 동안엔 <B>새 문제가 안 들어와요.</B>
          </P>
          <P>3일 쉬면 그 3일에 예약돼 있던 것만 밀려요. 며칠만 풀면 금방 원래대로 돌아와요.</P>
          <P>
            너무 많이 밀렸다면 <SettingsChip /> 에서 <B>밀린 복습 정리하기</B>를 누르세요. 며칠에
            나눠서 다시 예약해줘요. 문제가 지워지는 건 아니에요.
          </P>
        </Faq>

        <Faq q="없어진 문제가 있어요">
          <P first>
            여덟 번 넘게 틀린 문제는 복습에서 <B>잠깐 빼놨어요.</B>
          </P>
          <P>
            계속 보여줘도 안 외워지는 문제예요. 그런 건 자꾸 푸는 것보다 해설을 한 번 제대로 읽는
            게 빨라요.
          </P>
          <P>
            <SettingsChip /> 의 <B>접어둔 문제</B>에서 확인하고, 다시 넣을 수도 있어요.
          </P>
        </Faq>

        <Faq q="위에 있는 날짜 줄은 뭐예요?">
          <P first>앞으로 며칠 동안 몇 개씩 나올지 보여줘요.</P>
          <P>
            <B>−는 쉬는 날</B>이에요. 그날은 복습할 게 없어요.
          </P>
        </Faq>

        <Faq q="양을 바꾸고 싶어요">
          <P first>
            <SettingsChip /> 에서 바꿀 수 있어요.
          </P>
          <P>
            <B>하루에 풀 문항 수</B> — 시험이 가까우면 늘리고, 여유가 없으면 줄이세요.
          </P>
          <P>
            <B>복습에 넣을 과목</B> — 지금 안 보는 과목은 꺼두세요. 진도는 안 지워지고, 다시 켜면
            며칠에 나눠서 돌려줘요.
          </P>
        </Faq>
      </ScrollView>

      <View className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          className="w-full rounded-xl bg-blue-600 py-2.5 active:bg-blue-700"
        >
          <AppText variant="sm" weight="bold" className="text-center text-white">
            알겠어요
          </AppText>
        </Pressable>
      </View>
    </Sheet>
  );
}

// 문단. 첫 문단만 위 여백을 없앤다(제목·질문 바로 아래에 붙어야 한 덩어리로 읽힌다).
// 웹은 text-[13px] leading-[1.75] — AppText "13" 변형이 같은 크기다.
function P({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <AppText
      variant="13"
      className={["text-zinc-600 dark:text-zinc-300", first ? "" : "mt-2"].join(" ")}
      pretty
    >
      {children}
    </AppText>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return (
    <AppText variant="13" weight="bold" className="text-zinc-900 dark:text-zinc-100">
      {children}
    </AppText>
  );
}

// 본문보다 한 단계 낮은 곁다리. 이모지(⚙️) 대신 실제 아이콘을 쓰는 건 설정 버튼과 같은
// 모양이어야 어디를 누르라는 건지 바로 알기 때문이다.
//
// RN 은 Text 안에 View 를 넣으면 iOS 에서 줄 높이가 튄다. 아이콘은 Text 자식으로 둘 수 있는
// 요소가 아니므로(SVG), 여기서는 배경 없이 글자만으로 칩을 흉내내고 아이콘은 앞에 붙인다.
function SettingsChip() {
  return (
    <AppText variant="13" weight="semibold" className="text-zinc-600 dark:text-zinc-300">
      {"⚙ 설정"}
    </AppText>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-2.5 rounded-lg border-l-2 border-blue-300 bg-blue-50/60 py-1.5 pr-2 pl-2.5 dark:border-blue-800 dark:bg-blue-950/25">
      <AppText variant="13" className="text-zinc-600 dark:text-zinc-300" pretty>
        {children}
      </AppText>
    </View>
  );
}

// 번호 원과 그 아래로 흐르는 세로선. 세 장이 따로 노는 카드가 아니라 순서가 있는 한 흐름이라는
// 걸 선 하나로 알린다(웹은 gradient, 여기는 단색 — RN 에 그라디언트를 쓰려면 의존이 하나 는다).
function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View className={["relative flex-row gap-3.5", last ? "pb-1" : "pb-6"].join(" ")}>
      {!last && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute top-8 bottom-2 left-[13.5px] w-px bg-blue-200 dark:bg-blue-900"
        />
      )}
      <View className="z-10 h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
        <AppText variant="xs" weight="bold" className="text-white" allowFontScaling={false}>
          {n}
        </AppText>
      </View>
      <View className="min-w-0 flex-1 pt-0.5">
        <AppText variant="sm" weight="bold" pretty>
          {title}
        </AppText>
        <View className="mt-2">{children}</View>
      </View>
    </View>
  );
}

// 이 시트에서 가장 중요한 요소. 글로 읽지 않아도 "맞히면 간격이 벌어진다"가 보여야 한다 —
// 막대가 길어지는 것 자체가 설명이라, 숫자를 안 읽어도 전달된다.
const TIMELINE: { ok: boolean; when: string; pct: number }[] = [
  { ok: false, when: "3시간 뒤", pct: 6 },
  { ok: true, when: "내일", pct: 16 },
  { ok: true, when: "3일 뒤", pct: 34 },
  { ok: true, when: "8일 뒤", pct: 62 },
  { ok: true, when: "20일 뒤", pct: 100 },
];

// 움직임을 줄여달라고 한 사용자에게는 처음부터 다 자란 상태로 준다 — 이 애니메이션은 장식이
// 아니라 내용이라, 빼는 게 아니라 결과만 보여줘야 한다(웹의 prefers-reduced-motion 자리).
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

function Timeline({ visible }: { visible: boolean }) {
  const still = useReduceMotion();
  return (
    <View className="my-3 gap-2 rounded-xl bg-zinc-50 px-3.5 py-3 dark:bg-zinc-800/50">
      {TIMELINE.map((row, i) => (
        <View key={row.when} className="flex-row items-center gap-2.5">
          <View
            accessibilityLabel={row.ok ? "맞힘" : "틀림"}
            className={[
              "h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
              row.ok ? "bg-emerald-500" : "bg-rose-500",
            ].join(" ")}
          >
            {row.ok ? (
              <CheckIcon size={11} strokeWidth={3.5} colorClassName="text-white" />
            ) : (
              <XIcon size={11} strokeWidth={3.5} colorClassName="text-white" />
            )}
          </View>

          <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <TimelineBar pct={row.pct} delay={i * 90} still={still} visible={visible} ok={row.ok} />
          </View>

          <AppText variant="13" weight="bold" tabular className="w-[52px] shrink-0 text-right">
            {row.when}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// 막대 하나. 시트를 열 때마다 처음부터 자란다 — 웹은 마운트가 곧 열림이지만 여기서는 Sheet 가
// 닫힌 동안에도 살아 있을 수 있어 visible 을 직접 본다.
function TimelineBar({
  pct,
  delay,
  still,
  visible,
  ok,
}: {
  pct: number;
  delay: number;
  still: boolean;
  visible: boolean;
  ok: boolean;
}) {
  const grown = useSharedValue(still ? pct : 0);
  useEffect(() => {
    if (!visible) {
      grown.value = still ? pct : 0;
      return;
    }
    if (still) {
      grown.value = pct;
      return;
    }
    grown.value = withDelay(delay, withTiming(pct, { duration: 700, easing: Easing.out(Easing.ease) }));
  }, [visible, still, pct, delay, grown]);
  const style = useAnimatedStyle(() => ({ width: `${grown.value}%` }));
  return (
    <Animated.View
      style={style}
      className={["h-full rounded-full", ok ? "bg-blue-500" : "bg-rose-500"].join(" ")}
    />
  );
}

// 웹은 <details>. RN 에는 대응이 없어 상태를 직접 든다(아코디언 애니메이션은 두지 않는다 —
// 시트 안에서 높이가 튀면 스크롤 위치가 흔들린다).
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-t border-zinc-100 dark:border-zinc-800">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="-mx-2 flex-row items-center gap-2 rounded-lg px-2 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/50"
      >
        <AppText variant="13" weight="semibold" className="min-w-0 flex-1" pretty>
          {q}
        </AppText>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-500" />
        </View>
      </Pressable>
      {open && <View className="pb-3.5 pl-0.5">{children}</View>}
    </View>
  );
}
