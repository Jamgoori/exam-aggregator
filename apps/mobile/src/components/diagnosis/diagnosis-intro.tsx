import {
  COACH_MAX_TOTAL,
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_MIN_WRONG,
  DIAGNOSIS_WINDOW_DAYS,
  type DiagnosisIntroCta,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BarChart3, Lightbulb, PenLine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Skeleton } from "../skeleton";
import { themedIcon } from "../../theme/icons";

// AI 약점 진단 소개 화면(웹 app/diagnosis/page.tsx)의 조각들: 히어로(한 줄 정의 + 버튼 하나)·
// 3단계·접어 둔 규칙/FAQ. 여기 적힌 숫자는 손으로 쓰지 않는다 — 전부 규칙을 실제로 집행하는
// core 상수에서 온다. 화면만 옛 숫자를 광고하면 허위 안내다.

// ── 히어로 ───────────────────────────────────────────────────────────────────
// 버튼은 페이지에 하나뿐이다 — 지금 이 사람이 할 수 있는 단 하나의 다음 행동(core diagnosisIntroCta).
export function DiagnosisIntroHero({ cta }: { cta: DiagnosisIntroCta | null }) {
  return (
    <View className="items-center gap-4">
      <View className="rounded-full bg-violet-100 px-3 py-1 dark:bg-violet-950/50">
        <AppText variant="11" weight="bold" allowFontScaling={false} className="text-violet-700 dark:text-violet-300">
          멤버십 · {DIAGNOSIS_CYCLE_DAYS}일에 1회
        </AppText>
      </View>
      {/* 좁은 화면에서 어정쩡한 데서 접히지 않게 줄바꿈을 직접 넣는다(웹 sm 미만). */}
      <AppText variant="26" weight="extrabold" accessibilityRole="header" className="text-center text-zinc-900 dark:text-zinc-100" pretty>
        틀린 문제 말고,{"\n"}
        <AppText variant="26" weight="extrabold" className="text-violet-600 dark:text-violet-400">
          틀리는 이유
        </AppText>
        를 봅니다
      </AppText>
      <AppText variant="sm" className="max-w-md text-center leading-7 text-zinc-600 dark:text-zinc-400" pretty>
        최근 {DIAGNOSIS_WINDOW_DAYS}일에 틀린 문항을 개념 단위로 다시 세우고, 오답마다 왜 그렇게 골랐는지와 뭘
        하면 되는지를 써 드려요.
      </AppText>
      {cta ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(cta.href as Href)}
          className="mt-1 w-full flex-row items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 shadow-sm active:bg-violet-700"
        >
          <AppText variant="base" weight="bold" className="text-white">
            {cta.label}
          </AppText>
          <AppText variant="base" weight="bold" className="text-white" accessibilityElementsHidden>
            →
          </AppText>
        </Pressable>
      ) : (
        <Skeleton className="mt-1 h-[52px] w-full rounded-xl" />
      )}
      {cta?.note && (
        <AppText variant="xs" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
          {cta.note}
        </AppText>
      )}
    </View>
  );
}

// ── 3단계 ────────────────────────────────────────────────────────────────────
const PenIcon = themedIcon(PenLine);
const BarIcon = themedIcon(BarChart3);
const BulbIcon = themedIcon(Lightbulb);

const STEPS: { Icon: typeof PenIcon; title: string; body: string }[] = [
  { Icon: PenIcon, title: "평소처럼 풉니다", body: "CBT·섞어풀기·복습에서 채점된 기록이 그대로 쌓여요." },
  {
    Icon: BarIcon,
    title: "개념별로 모아 보여줘요",
    body: "문항이 아니라 개념이 축이에요. 어떤 개념에서 몇 번 무너졌는지 그래프로 바로 보여요.",
  },
  {
    Icon: BulbIcon,
    title: "극복법을 받아요",
    body: "고른 개념마다 내 오답을 근거로 원인·극복 계획·시험장 체크리스트를 써 주고, 같은 개념 기출 5문제를 그 자리에서 풀 수 있어요.",
  },
];

export function DiagnosisSteps() {
  return (
    <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {STEPS.map((s, i) => (
        <View
          key={s.title}
          className={["flex-row items-start gap-3 p-4", i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""].join(" ")}
        >
          <View className="mt-0.5 h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-950/40">
            <s.Icon size={16} colorClassName="text-violet-600 dark:text-violet-400" />
          </View>
          <View className="min-w-0 flex-1">
            <AppText variant="sm" weight="bold" className="text-zinc-900 dark:text-zinc-100">
              {i + 1}. {s.title}
            </AppText>
            <AppText variant="13" className="mt-0.5 leading-6 text-zinc-600 dark:text-zinc-400" pretty>
              {s.body}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── 접어 둔 상세 ─────────────────────────────────────────────────────────────
// 규칙과 FAQ는 처음 보는 사람에게 필요한 정보가 아니다. 필요한 사람만 펼치도록 접어 두되,
// 안에 들어가는 내용은 실제 동작 그대로 적는다.
const RULES: { label: string; value: string }[] = [
  { label: "진단 주기", value: `${DIAGNOSIS_CYCLE_DAYS}일에 1회 (받은 날부터 ${DIAGNOSIS_CYCLE_DAYS}일)` },
  { label: "분석 기간", value: `최근 ${DIAGNOSIS_WINDOW_DAYS}일 안에 틀린 문제에서 개념 선정` },
  { label: "극복법 개수", value: `직접 고른 개념에 한 번에 최대 ${COACH_MAX_TOTAL}개` },
  { label: "그래프", value: "주기와 무관하게 항상 실시간" },
  { label: "받을 수 있는 조건", value: `멤버십 · 오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회` },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: `왜 ${DIAGNOSIS_CYCLE_DAYS}일에 한 번인가요?`,
    a: "하루 만에 약점이 바뀌지는 않아서예요. 매일 새로 뽑으면 어제와 거의 같은 말을 다시 읽게 되고, 정작 메우는 시간이 사라져요. 개념 그래프는 주기와 무관하게 실시간이라 오늘 푼 결과는 바로 볼 수 있어요.",
  },
  {
    q: "어떤 개념에 극복법이 붙나요?",
    a: `진단 화면에서 직접 고른 개념에 붙어요. 한 번에 최대 ${COACH_MAX_TOTAL}개까지 고를 수 있고, 처음에는 많이 틀린 개념이 미리 체크돼 있어요 — 그대로 눌러도 되고, 시험이 가까운 과목 위주로 바꿔도 돼요.`,
  },
  {
    q: "오래전에 틀린 문제도 분석하나요?",
    a: `극복법에 넣을 개념은 최근 ${DIAGNOSIS_WINDOW_DAYS}일 안에 틀린 문제에서 골라요 — 지금 무엇에서 무너지는지를 보는 게 목적이라서요. 다만 그 개념의 근거로는 예전에 틀린 문항까지 같이 봅니다. 그래프는 기간을 ‘전체’로 바꾸면 지금까지 쌓인 오답을 전부 놓고 볼 수 있어요.`,
  },
  {
    q: "멤버십이 끝나면 기록도 사라지나요?",
    a: "아니요. 잠기는 건 진단 화면이고, 오답 기록은 그대로 남아 다시 시작하면 이어집니다.",
  },
];

export function DiagnosisDetails() {
  return (
    <View className="gap-2">
      <Fold summary="규칙 자세히 보기">
        {RULES.map((r, i) => (
          <View
            key={r.label}
            className={["flex-row flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5", i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""].join(" ")}
          >
            <AppText variant="xs" weight="bold" className="text-zinc-500 dark:text-zinc-400">
              {r.label}
            </AppText>
            <AppText variant="13" weight="semibold" className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200" pretty>
              {r.value}
            </AppText>
          </View>
        ))}
      </Fold>
      <Fold summary="자주 묻는 질문">
        {FAQ.map((item, i) => (
          <View key={item.q} className={["py-3", i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""].join(" ")}>
            <AppText variant="13" weight="bold" className="text-zinc-800 dark:text-zinc-200">
              {item.q}
            </AppText>
            <AppText variant="13" className="mt-1 leading-6 text-zinc-600 dark:text-zinc-400" pretty>
              {item.a}
            </AppText>
          </View>
        ))}
      </Fold>
    </View>
  );
}

// 웹 <details> → 접기 토글. "+" 는 펼치면 45° 돌아간다.
function Fold({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between py-3.5"
      >
        <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
          {summary}
        </AppText>
        <AppText
          variant="lg"
          allowFontScaling={false}
          className="text-zinc-300 dark:text-zinc-600"
          style={{ transform: [{ rotate: open ? "45deg" : "0deg" }] }}
        >
          +
        </AppText>
      </Pressable>
      {open && <View className="border-t border-zinc-100 pb-2 dark:border-zinc-800">{children}</View>}
    </View>
  );
}
