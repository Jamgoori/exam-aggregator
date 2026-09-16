import {
  clampMixLimit,
  compareLevels,
  levelColor,
  normalizeYearRange,
  recentYearRange,
  MIX_ALL_YEARS,
  MIX_DEFAULT_LIMIT,
  MIX_LIMIT_OPTIONS,
  MIX_MAX_LIMIT,
  MIX_MIN_LIMIT,
  MIX_NO_LEVEL,
  MIX_RECENT_YEAR_OPTIONS,
  type MixCreateOverviewResponse,
  type MixYearRange,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Shuffle } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Sheet } from "../sheet";
import { handleEdgeError } from "../../lib/edge";
import { useCreateMixSession } from "../../queries/mix";
import { themedIcon } from "../../theme/icons";

// 기출 섞어풀기 시작 패널(웹 mix-practice-starter.tsx 1:1). 고를 것은 급수·연도·문항 수 셋이다 —
// 시행처·순서 같은 나머지 설정은 늘어놓지 않는다(설정을 노출하지 말고 기본값으로 흡수).
// "안 풀어 본 문항 먼저"·"같은 개념 안 뭉치게"는 서버가 알아서 하고 문구로만 알린다.
//
// 급수가 없는 시행처(경찰·소방·해경·계리직)는 서버가 난도 등급으로 환산해 보낸다. 그 등급이
// 섞인 칩은 "9급"이 아니라 "9급 수준"으로 부른다 — 순경 준비생에게 "9급"은 자기 시험이 아니라는
// 신호로 읽혀 아예 안 누른다.
const ShuffleIcon = themedIcon(Shuffle);

type LevelGroup = MixCreateOverviewResponse["levelGroups"][number];
type CountCell = MixCreateOverviewResponse["cells"][number];

export function MixPracticeStarter({
  subjectSlug,
  subjectName,
  questionCount,
  levelGroups,
  initialLevel,
  cells,
  minYear,
  maxYear,
  compact = false,
}: {
  subjectSlug: string;
  subjectName: string;
  // 출제 가능한 문항 수. 0이면 시작 버튼 대신 준비 중 안내.
  questionCount: number;
  // 난도 등급별 문항 수(어느 등급에도 안 묶인 것은 MIX_NO_LEVEL). 둘 이상일 때만 칩을 그린다.
  levelGroups: LevelGroup[];
  // 허브에서 고르고 들어온 급수(?level=). 이 과목에 없는 등급이면 무시하고 전체로 둔다.
  initialLevel?: string | null;
  // (등급, 연도) 교차 문항 수. 두 필터를 함께 걸었을 때 남는 수를 여기서 센다.
  cells: CountCell[];
  minYear: number | null;
  maxYear: number | null;
  // 과목 오답노트 상단처럼 좁은 자리에 넣을 때: 설명 문구를 줄인다.
  compact?: boolean;
}) {
  const [limit, setLimit] = useState<number>(MIX_DEFAULT_LIMIT);
  // 칩에 없는 수를 직접 넣는 입력. 비어 있으면 칩 선택값을 쓴다.
  const [custom, setCustom] = useState("");
  // 고른 급수(다중 선택). 비어 있으면 전체 — 9급+7급처럼 둘을 같이 준비하는 사람도 있다.
  const [levels, setLevels] = useState<Set<string>>(() =>
    initialLevel && levelGroups.some((g) => g.key === initialLevel) ? new Set([initialLevel]) : new Set(),
  );
  // 연도 범위. 기본은 전체다 — 기출은 오래된 것도 그대로 출제 자산이라, 처음부터 최근 N년으로
  // 좁혀 두면 사용자가 모르는 채 모수를 잃는다.
  const [year, setYear] = useState<MixYearRange>(MIX_ALL_YEARS);
  // 직접 구간 고르기를 펼쳤는지. 칩으로 끝내는 사람이 대부분이라 접어 둔다.
  const [customYear, setCustomYear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateMixSession();
  const pending = create.isPending;

  // 칩 순서: 9급 → 7급 → … "기타"는 맨 뒤. 문항이 0인 등급은 애초에 오지 않는다.
  const groups = [...levelGroups].sort((a, b) => {
    if (a.key === MIX_NO_LEVEL) return 1;
    if (b.key === MIX_NO_LEVEL) return -1;
    return compareLevels(a.key, b.key);
  });
  const levelKeys = groups.map((g) => g.key);
  const showLevels = groups.length > 1;

  // 지금 필터로 남는 문항 수. 급수·연도를 함께 걸 수 있어 교차 표(cells)로 센다.
  const countFor = (levelSet: Set<string>, range: MixYearRange) =>
    cells.reduce((sum, c) => {
      if (levelSet.size > 0 && !levelSet.has(c.level)) return sum;
      if (range.from != null || range.to != null) {
        if (c.year == null) return sum;
        if (range.from != null && c.year < range.from) return sum;
        if (range.to != null && c.year > range.to) return sum;
      }
      return sum + c.count;
    }, 0);
  const selectedCount = countFor(levels, year);

  // 연도 칩. 자료가 한 해뿐이면 고를 것이 없다.
  const years =
    minYear != null && maxYear != null && maxYear > minYear
      ? Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i)
      : [];
  const showYears = years.length > 1;
  const setYearRange = (next: MixYearRange) => setYear(normalizeYearRange(next, { min: minYear, max: maxYear }));
  const isAllYears = year.from == null && year.to == null;
  const activeRecent = MIX_RECENT_YEAR_OPTIONS.find((n) => {
    const r = recentYearRange(n, maxYear);
    return !isAllYears && r.from === year.from && r.to === year.to;
  });

  function toggleLevel(key: string) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // 전부 골랐으면 "전체"와 같다 — 상태도 전체로 돌려 칩 표시가 헷갈리지 않게 한다.
      return next.size === levelKeys.length ? new Set() : next;
    });
  }

  const maxForSubject = Math.max(MIX_MIN_LIMIT, Math.min(MIX_MAX_LIMIT, selectedCount));
  const effectiveLimit = Math.min(maxForSubject, custom.trim() ? clampMixLimit(custom) : limit);
  const isCustomActive = custom.trim().length > 0;

  async function begin() {
    if (pending) return;
    setError(null);
    try {
      const res = await create.mutateAsync({
        subjectSlug,
        limit: effectiveLimit,
        levels: [...levels],
        yearRange: year,
      });
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/subjects/${subjectSlug}/mix` });
      if (handled.redirected) return;
      setError(handled.message || "섞어풀기를 시작하지 못했어요.");
    }
  }

  if (questionCount === 0) {
    return (
      <AppText
        variant="sm"
        className="rounded-xl border border-zinc-200 px-4 py-3 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-500"
        pretty
      >
        {subjectName}은(는) 아직 섞어풀기를 준비 중이에요. 문항 이미지와 정답이 등록된 문제지가
        생기면 바로 열려요.
      </AppText>
    );
  }

  // 라벨: 환산된 문제지가 섞인 등급은 "9급 수준"(사실이 아닌 걸 사실처럼 부르지 않는다),
  // 실제 급수만 있는 등급은 그대로 "9급". 어느 등급에도 안 묶인 묶음은 "기타".
  const labelOf = (g: LevelGroup) => (g.key === MIX_NO_LEVEL ? "기타" : g.approx ? `${g.key} 수준` : g.key);
  const labelByKey = new Map(groups.map((g) => [g.key, labelOf(g)]));
  const levelLabel = (key: string) => labelByKey.get(key) ?? key;
  const summaryLevels =
    levels.size === 0 ? "" : ` ${levelKeys.filter((k) => levels.has(k)).map(levelLabel).join("·")}`;
  const hasApprox = groups.some((g) => g.approx);
  const summaryYears = isAllYears ? "" : ` ${year.from ?? minYear}~${year.to ?? maxYear}년`;

  return (
    <View className="gap-3">
      {showLevels && (
        <View className="gap-1.5">
          <AppText variant="xs" weight="semibold" className="text-zinc-500 dark:text-zinc-500">
            급수
          </AppText>
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip
              active={levels.size === 0}
              activeClassName="bg-zinc-800 dark:bg-zinc-100"
              activeTextClassName="text-white dark:text-zinc-900"
              onPress={() => setLevels(new Set())}
              label="전체"
              suffix={countFor(new Set(), year).toLocaleString()}
            />
            {groups.map((g) => (
              <Chip
                key={g.key}
                active={levels.has(g.key)}
                activeClassName={g.key === MIX_NO_LEVEL ? "bg-zinc-500" : levelColor(g.key)}
                activeTextClassName={g.key === MIX_NO_LEVEL ? "text-white" : levelColor(g.key)}
                onPress={() => toggleLevel(g.key)}
                label={labelOf(g)}
                suffix={countFor(new Set([g.key]), year).toLocaleString()}
              />
            ))}
          </View>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-600" pretty>
            여러 급수를 함께 고를 수 있어요. 시험(국가직·지방직 등)은 가리지 않고 섞여요.
            {hasApprox
              ? " 경찰·소방·해경·계리직처럼 급수가 없는 시험은 난도가 비슷한 급수에 함께 묶여요(간부후보는 7급 수준, 승진시험은 기타)."
              : ""}
          </AppText>
        </View>
      )}

      {showYears && (
        <View className="gap-1.5">
          <AppText variant="xs" weight="semibold" className="text-zinc-500 dark:text-zinc-500">
            연도
          </AppText>
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip
              active={isAllYears}
              activeClassName="bg-zinc-800 dark:bg-zinc-100"
              activeTextClassName="text-white dark:text-zinc-900"
              onPress={() => {
                setYear(MIX_ALL_YEARS);
                setCustomYear(false);
              }}
              label="전체"
              suffix={`${minYear}~${maxYear}`}
            />
            {MIX_RECENT_YEAR_OPTIONS.filter(
              // 자료 전체를 덮는 "최근 N년"은 전체 칩과 같아 두 개가 동시에 켜진 것처럼 보인다.
              (n) => maxYear != null && minYear != null && maxYear - n + 1 > minYear,
            ).map((n) => (
              <Chip
                key={n}
                active={activeRecent === n && !customYear}
                activeClassName="bg-blue-600"
                activeTextClassName="text-white"
                onPress={() => {
                  setYearRange(recentYearRange(n, maxYear));
                  setCustomYear(false);
                }}
                label={`최근 ${n}년`}
              />
            ))}
            <Chip
              active={customYear}
              activeClassName="bg-blue-600"
              activeTextClassName="text-white"
              onPress={() => setCustomYear((v) => !v)}
              label="직접 고르기"
            />
          </View>

          {customYear && (
            <View className="flex-row flex-wrap items-center gap-2">
              <YearSelect
                label="시작 연도"
                value={year.from ?? minYear}
                years={years}
                onChange={(v) => setYearRange({ from: v, to: year.to ?? maxYear })}
              />
              <AppText variant="sm" className="text-zinc-400 dark:text-zinc-600">
                ~
              </AppText>
              <YearSelect
                label="끝 연도"
                value={year.to ?? maxYear}
                years={years}
                onChange={(v) => setYearRange({ from: year.from ?? minYear, to: v })}
              />
            </View>
          )}

          <AppText variant="11" className="text-zinc-400 dark:text-zinc-600" pretty>
            {isAllYears
              ? "기본은 전체예요. 법·제도가 바뀐 과목이면 최근 몇 년으로 좁혀서 풀어보세요."
              : `${year.from ?? minYear}~${year.to ?? maxYear}년 문제만 나와요. 지금 조건으로 풀 수 있는 문항 ${selectedCount.toLocaleString()}개.`}
          </AppText>
        </View>
      )}

      <View className="gap-1.5">
        <AppText variant="xs" weight="semibold" className="text-zinc-500 dark:text-zinc-500">
          문항 수
        </AppText>
        <View className="flex-row flex-wrap items-center gap-2">
          {MIX_LIMIT_OPTIONS.filter((n) => n <= maxForSubject || n === MIX_LIMIT_OPTIONS[0]).map((n) => (
            <Chip
              key={n}
              active={!isCustomActive && limit === n}
              activeClassName="bg-blue-600"
              activeTextClassName="text-white"
              onPress={() => {
                setLimit(n);
                setCustom("");
              }}
              label={`${n}문항`}
            />
          ))}
          <View className="flex-row items-center gap-1">
            <TextInput
              accessibilityLabel="문항 수 직접 입력"
              value={custom}
              onChangeText={setCustom}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="직접"
              placeholderTextColorClassName="text-zinc-400 dark:text-zinc-600"
              maxLength={3}
              maxFontSizeMultiplier={1.3}
              className={[
                "w-20 rounded-full border px-3 py-2 text-center text-sm font-semibold dark:bg-zinc-900",
                isCustomActive
                  ? "border-blue-500 text-blue-700 dark:text-blue-300"
                  : "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
              ].join(" ")}
            />
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
              문항
            </AppText>
          </View>
        </View>
        <AppText variant="11" className="text-zinc-400 dark:text-zinc-600" pretty>
          {MIX_MIN_LIMIT}~{maxForSubject}문항까지. 아직 안 풀어 본 문제를 먼저, 여러 시험·연도가
          고르게 섞이고 같은 개념이 몰리지 않게 골라요.
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending, busy: pending }}
        disabled={pending}
        onPress={() => void begin()}
        className={[
          "w-full flex-row items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 active:bg-blue-700",
          pending ? "opacity-60" : "",
        ].join(" ")}
      >
        <ShuffleIcon size={16} colorClassName="text-white" />
        <AppText variant="sm" weight="bold" className="min-w-0 shrink text-white" pretty>
          {pending
            ? "문제를 섞는 중..."
            : `${subjectName}${summaryLevels}${summaryYears} 기출 ${effectiveLimit}문항 섞어풀기 시작`}
        </AppText>
      </Pressable>
      {error && (
        <AppText variant="xs" className="text-center text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}
      {!compact && (
        <AppText variant="11" className="text-center text-zinc-400 dark:text-zinc-600" pretty>
          풀고 나면 오답노트에 “○월 ○일 섞어풀기”로 남고, 틀린 문제는 과목 오답에 합쳐져요.
        </AppText>
      )}
    </View>
  );
}

// 급수·연도·문항 수가 함께 쓰는 알약 칩(웹 `rounded-full px-4 py-2 text-sm font-semibold`).
// 켜졌을 때의 색은 자리마다 달라(급수 배지색 / 파랑 / 검정) 호출부가 클래스로 준다.
function Chip({
  active,
  activeClassName,
  activeTextClassName,
  onPress,
  label,
  suffix,
}: {
  active: boolean;
  activeClassName: string;
  activeTextClassName: string;
  onPress: () => void;
  label: string;
  suffix?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={[
        "flex-row items-center gap-1 rounded-full px-4 py-2",
        active
          ? activeClassName
          : "border border-zinc-200 active:border-zinc-400 dark:border-zinc-700 dark:active:border-zinc-600",
      ].join(" ")}
    >
      <AppText
        variant="sm"
        weight="semibold"
        className={active ? activeTextClassName : "text-zinc-600 dark:text-zinc-400"}
      >
        {label}
      </AppText>
      {suffix != null && (
        <AppText
          variant="sm"
          weight="semibold"
          className={[active ? activeTextClassName : "text-zinc-600 dark:text-zinc-400", "opacity-70"].join(" ")}
        >
          {suffix}
        </AppText>
      )}
    </Pressable>
  );
}

// 연도 하나를 고르는 자리. 웹은 <select> 인데 RN 에는 없어 시트 목록으로 둔다 — 20년치가 넘을 수
// 있어 칩으로 늘어놓으면 네 줄을 먹는다(웹이 select 를 고른 것과 같은 이유).
function YearSelect({
  label,
  value,
  years,
  onChange,
}: {
  label: string;
  value: number | null;
  years: number[];
  onChange: (year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="연도를 고를 목록을 엽니다"
        onPress={() => setOpen(true)}
        className="rounded-full border border-zinc-200 bg-white px-3 py-2 active:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:active:bg-zinc-800"
      >
        <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
          {value != null ? `${value}년` : "선택"}
        </AppText>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} maxHeight="60%">
        <ScrollView className="min-h-0 shrink" contentContainerClassName="px-2 py-2">
          {years.map((y) => (
            <Pressable
              key={y}
              accessibilityRole="button"
              accessibilityState={{ selected: y === value }}
              onPress={() => {
                onChange(y);
                setOpen(false);
              }}
              className="rounded-xl px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/60"
            >
              <AppText
                variant="sm"
                weight={y === value ? "bold" : "normal"}
                className={y === value ? "text-blue-600 dark:text-blue-400" : ""}
              >
                {y}년
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}
