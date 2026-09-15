import { BarChart3, Lightbulb, ListChecks, Sparkles, Target, TrendingDown } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../app-text";
import { palette } from "../../theme";
import { themedIcon } from "../../theme/icons";

// AI 약점 진단이 "이렇게 나온다"를 보여주는 예시 화면(웹 diagnosis-sample-report.tsx, 설계서
// §4.5 #26 — violet dashed 카드, "이렇게 나와요 / 예시 화면 · 실제 데이터 아님").
//
// 진단은 응시 3회(또는 오답 15개) 뒤에야 열린다. 결과물이 어떻게 생겼는지 아무도 못 보면 세 번
// 올 이유가 없다 — 그래서 소개 화면에 실제 리포트와 같은 구조(미션 → 취약 개념 → 오답 패턴 →
// 개념별 극복법)로 한 장을 그려 둔다. 내용은 전부 지어낸 예시라 "예시 화면"을 판 전체에 한 번
// 눈에 띄게 박는다. 데이터를 읽지 않는 순수 마크업.
const WEAK_CONCEPTS: {
  subject: string;
  concept: string;
  accuracyPct: number;
  wrongCount: number;
  frequency: 1 | 2 | 3;
  trend: "down" | "flat" | "up";
}[] = [
  { subject: "행정법총론", concept: "행정행위의 효력", accuracyPct: 38, wrongCount: 5, frequency: 3, trend: "down" },
  { subject: "영어", concept: "어휘·숙어", accuracyPct: 58, wrongCount: 4, frequency: 3, trend: "flat" },
  { subject: "한국사", concept: "조선 후기 실학", accuracyPct: 60, wrongCount: 2, frequency: 2, trend: "up" },
];

const FREQUENCY_LABEL: Record<1 | 2 | 3, string> = { 1: "가끔 출제", 2: "자주 출제", 3: "매년 출제" };

const STEPS = [
  { title: "표 한 장 만들기", detail: "효력 넷 × (대상 · 발생 시점 · 예외) 3열 표를 손으로 한 번 써요.", minutes: 10 },
  { title: "틀린 5문항 다시 풀기", detail: "선지마다 주어(누가)를 먼저 표시하고 나서 고르세요.", minutes: 15 },
  { title: "같은 개념 기출 5문제", detail: "아래 버튼으로 바로 이어져요. 4문제 이상 맞히면 극복으로 기록돼요.", minutes: 10 },
];

const BarIcon = themedIcon(BarChart3);
const BulbIcon = themedIcon(Lightbulb);
const TargetIcon = themedIcon(Target);
const ListIcon = themedIcon(ListChecks);

// 알약 배지(`rounded-full px-1.5 py-0.5 text-[11px] font-bold` / 큰 것은 px-2.5 py-1 text-xs).
function Pill({ tone, label, large = false }: { tone: "amber" | "red" | "zinc" | "emerald"; label: string; large?: boolean }) {
  const cls = {
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    red: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  }[tone];
  return (
    <View className={["rounded-full", large ? "px-2.5 py-1" : "px-1.5 py-0.5", cls].join(" ")}>
      <AppText variant={large ? "xs" : "11"} weight="bold" allowFontScaling={false} className={cls}>
        {label}
      </AppText>
    </View>
  );
}

// 리포트 본문 문단(text-sm leading-relaxed text-zinc-700). <b> 는 nested AppText 로.
function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <AppText variant="sm" className={["leading-6 text-zinc-700 dark:text-zinc-300", className ?? ""].join(" ")} pretty>
      {children}
    </AppText>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return (
    <AppText variant="sm" weight="bold" className="leading-6 text-zinc-700 dark:text-zinc-300">
      {children}
    </AppText>
  );
}

export function DiagnosisSampleReport() {
  return (
    <View
      accessibilityLabel="AI 약점 진단 결과 예시"
      className="gap-4 rounded-2xl border border-dashed border-violet-300 bg-violet-50/40 p-4 dark:border-violet-800 dark:bg-violet-950/15"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <AppText variant="sm" weight="bold" className="text-violet-900 dark:text-violet-100">
          이렇게 나와요
        </AppText>
        <View className="rounded-full border border-violet-300 bg-white px-2.5 py-0.5 dark:border-violet-700 dark:bg-zinc-900">
          <AppText variant="11" weight="bold" allowFontScaling={false} className="tracking-wide text-violet-700 dark:text-violet-300">
            예시 화면 · 실제 데이터 아님
          </AppText>
        </View>
      </View>

      {/* 1) 오늘의 1분 미션 — 대시보드 맨 위 히어로 */}
      <View className="rounded-2xl bg-violet-600 p-4 shadow-sm">
        <View className="flex-row items-center gap-1.5">
          <Sparkles size={13} color="#ede9fe" />
          <AppText variant="11" weight="bold" className="text-violet-100">
            오늘의 1분 미션
          </AppText>
        </View>
        <AppText variant="15" weight="bold" className="mt-1.5 text-white" pretty>
          행정법총론 ‘행정행위의 효력’만 잡으면 예상 점수 +5점
        </AppText>
        <AppText variant="xs" className="mt-1 text-violet-100/85" pretty>
          최근 7일 오답 11문항 중 5문항이 이 개념이에요. 같은 개념 기출 5문제로 바로 확인해요.
        </AppText>
      </View>

      {/* 2) 취약 개념 — 문항이 아니라 개념이 축 */}
      <View className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <View className="flex-row items-center gap-1.5">
          <BarIcon size={14} colorClassName="text-violet-600 dark:text-violet-400" />
          <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            취약 개념
          </AppText>
        </View>
        <View className="mt-3 gap-3">
          {WEAK_CONCEPTS.map((c) => (
            <View key={c.concept} className="flex-row items-center gap-3">
              <AppText variant="xs" className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">
                {c.subject}
              </AppText>
              <View className="min-w-0 flex-1">
                <View className="mb-1.5 flex-row flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <AppText variant="11" weight="semibold" className="text-zinc-900 dark:text-zinc-100">
                    {c.concept}
                  </AppText>
                  <View className="flex-row items-center gap-1.5">
                    <Pill tone="amber" label={FREQUENCY_LABEL[c.frequency]} />
                    <Pill tone="red" label={`${c.wrongCount}회 틀림`} />
                    <AppText variant="11" tabular className="text-zinc-500 dark:text-zinc-400">
                      정답률 {c.accuracyPct}%
                    </AppText>
                    {c.trend === "down" && <TrendingDown size={12} color={palette.red[500]} accessibilityLabel="하락 추세" />}
                  </View>
                </View>
                <View className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <View
                    className={["h-full rounded-full", c.accuracyPct < 50 ? "bg-violet-600" : "bg-zinc-400 dark:bg-zinc-600"].join(" ")}
                    style={{ width: `${c.accuracyPct}%` }}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 3) 오답 패턴 인사이트 */}
      <View className="flex-row items-start gap-2.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <View className="mt-0.5 shrink-0 rounded-full bg-red-50 px-2 py-0.5 dark:bg-red-950/30">
          <AppText variant="11" weight="bold" allowFontScaling={false} className="text-red-700 dark:text-red-300">
            오답률 71%
          </AppText>
        </View>
        <AppText variant="13" className="min-w-0 flex-1 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
          행정법총론에서 “공정력과 구성요건적 효력을 바꿔 놓은” 함정 선지를 자주 골라요. 효력의 이름이 아니라{" "}
          <AppText variant="13" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            누구를 구속하는지
          </AppText>
          를 묻는 문제에서 무너져요.
        </AppText>
      </View>

      {/* 4) 개념별 맞춤 극복법 — 대시보드 CoachingCard 와 같은 문법 */}
      <View className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <View className="flex-row flex-wrap items-center gap-2">
          <Pill tone="red" label="5회 틀림" large />
          <Pill tone="zinc" label="정답률 38%" large />
          <Pill tone="amber" label="기출 24문항" large />
          <Pill tone="emerald" label="잡으면 +5점" large />
        </View>
        <View className="mt-2.5">
          <AppText variant="xs" weight="semibold" className="text-zinc-500">
            행정법총론
          </AppText>
          <AppText variant="base" weight="bold" className="text-zinc-900 dark:text-zinc-100">
            행정행위의 효력
          </AppText>
        </View>

        <View className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/10">
          <View className="flex-row items-center gap-1.5">
            <BulbIcon size={13} colorClassName="text-blue-700 dark:text-blue-300" />
            <AppText variant="xs" weight="bold" className="text-blue-700 dark:text-blue-300">
              어디서 무너지고 있나
            </AppText>
          </View>
          <Body className="mt-1.5">
            효력 넷(공정력·구성요건적 효력·불가쟁력·불가변력)의 정의는 알고 있는데, 선지가 “다른 국가기관이 그
            행위의 존재를 존중해야 한다”처럼 <B>효과 쪽</B>으로 바꿔 물으면 공정력을 고르고 있어요. 틀린 5문항 중
            4문항이 같은 자리에서 갈렸어요.
          </Body>
          <AppText variant="xs" weight="bold" className="mt-3 text-blue-700/80 dark:text-blue-300/80">
            왜 그렇게 골랐을까
          </AppText>
          <Body className="mt-1">
            공정력을 “일단 유효한 것으로 통용되는 힘”으로만 외워서, 상대방(국민)에 대한 통용력과 다른 기관에
            대한 존중 의무를 한 덩어리로 보고 있어요. 두 효력은 대상이 다르다는 축이 서 있지 않으면 어느 선지든
            공정력처럼 읽혀요.
          </Body>
        </View>

        <View className="mt-3">
          <AppText variant="xs" weight="bold" className="px-1 text-zinc-600 dark:text-zinc-400">
            내가 틀린 문항에서
          </AppText>
          <View className="mt-1.5 gap-2">
            <View className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
              <AppText variant="13" weight="semibold" className="leading-snug text-zinc-800 dark:text-zinc-200" pretty>
                2025 국가직 9급 12번 · 행정행위의 효력에 관한 설명으로 옳지 않은 것은?
              </AppText>
              <AppText variant="xs" className="mt-1 text-zinc-500 dark:text-zinc-400" pretty>
                내 선택 · ③ 과세처분이 있으면 민사법원은 그 처분의 존재를 전제로 판단해야 한다 (공정력)
              </AppText>
              <AppText variant="13" className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
                이건 구성요건적 효력의 전형적 서술이에요. “다른 법원·기관이”가 주어면 공정력이 아니라 구성요건적
                효력을 떠올려야 해요.
              </AppText>
            </View>
            <View className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
              <AppText variant="13" weight="semibold" className="leading-snug text-zinc-800 dark:text-zinc-200" pretty>
                2024 지방직 9급 7번 · 불가쟁력이 발생한 행정행위에 관한 설명 중 옳은 것은?
              </AppText>
              <AppText variant="xs" className="mt-1 text-zinc-500 dark:text-zinc-400" pretty>
                내 선택 · ② 불가쟁력이 생기면 행정청도 직권취소를 할 수 없다
              </AppText>
              <AppText variant="13" className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
                불가쟁력은{" "}
                <AppText variant="13" weight="bold" className="text-zinc-700 dark:text-zinc-300">
                  상대방
                </AppText>
                이 더 다툴 수 없다는 뜻이지 행정청을 묶지 않아요. 행정청을 묶는 건 불가변력이고, 그것도 준사법적
                행위에서만이에요.
              </AppText>
            </View>
          </View>
        </View>

        <View className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5 dark:border-violet-900/40 dark:bg-violet-950/15">
          <View className="flex-row items-center gap-1.5">
            <TargetIcon size={13} colorClassName="text-violet-700 dark:text-violet-300" />
            <AppText variant="xs" weight="bold" className="text-violet-700 dark:text-violet-300">
              이렇게 극복해요
            </AppText>
          </View>
          <AppText variant="sm" weight="semibold" className="mt-1.5 leading-6 text-zinc-800 dark:text-zinc-200" pretty>
            효력 넷을 “누구를 구속하나”라는 한 축으로 다시 세우세요: 상대방(공정력· 불가쟁력) vs 다른
            기관(구성요건적 효력) vs 행정청 자신(불가변력).
          </AppText>
          <View className="mt-2.5 gap-2">
            {STEPS.map((s, i) => (
              <View key={s.title} className="flex-row gap-2.5">
                <View className="mt-0.5 h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600">
                  <AppText variant="11" weight="bold" allowFontScaling={false} className="text-white">
                    {i + 1}
                  </AppText>
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-baseline gap-1.5">
                    <AppText variant="13" weight="bold" className="text-zinc-800 dark:text-zinc-200">
                      {s.title}
                    </AppText>
                    <AppText variant="11" weight="semibold" className="text-violet-600 dark:text-violet-400">
                      약 {s.minutes}분
                    </AppText>
                  </View>
                  <AppText variant="13" className="mt-0.5 leading-relaxed text-zinc-600 dark:text-zinc-400" pretty>
                    {s.detail}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className="mt-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
          <View className="flex-row items-center gap-1.5">
            <ListIcon size={13} colorClassName="text-zinc-700 dark:text-zinc-300" />
            <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
              시험장 체크리스트
            </AppText>
          </View>
          <View className="mt-1.5 gap-1">
            {[
              "1. 선지의 주어가 국민인가, 다른 기관인가, 행정청인가",
              "2. “존중·전제”가 나오면 구성요건적 효력부터 의심",
              "3. 불가쟁력은 기간 도과, 불가변력은 행위 성질 — 발생 원인이 다르다",
            ].map((line) => (
              <AppText key={line} variant="13" className="text-zinc-700 dark:text-zinc-300" pretty>
                {line}
              </AppText>
            ))}
          </View>
          <AppText variant="xs" className="mt-2.5 text-zinc-500 dark:text-zinc-500" pretty>
            함정 한 줄 · “공정력이 있으므로 법원은 ~해야 한다”는 선지는 대개 효력 이름을 바꿔 놓은 것.
          </AppText>
        </View>

        <View className="mt-3 items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5">
          <AppText variant="sm" weight="bold" className="text-white">
            같은 개념 기출 5문제 풀기
          </AppText>
        </View>
      </View>
    </View>
  );
}
