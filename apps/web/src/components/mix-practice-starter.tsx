"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import { createMixSession } from "@/app/mypage/wrong-notes/actions";
import { compareLevels, levelColor } from "@/lib/level-colors";
import {
  clampMixLimit,
  normalizeYearRange,
  recentYearRange,
  MIX_ALL_YEARS,
  MIX_DEFAULT_LIMIT,
  MIX_LIMIT_OPTIONS,
  MIX_MAX_LIMIT,
  MIX_MIN_LIMIT,
  MIX_NO_LEVEL,
  MIX_RECENT_YEAR_OPTIONS,
  type MixYearRange,
} from "@gongmoa/core";
import type { MixCountCell, MixLevelGroup } from "@/lib/mix-practice";

// 기출 섞어풀기 시작 패널. 고를 것은 급수·연도·문항 수 셋이다 — 시행처·순서 같은
// 나머지 설정은 늘어놓지 않는다(오답노트 로드맵 UX 원칙 5: 설정을 노출하지 말고
// 기본값으로 흡수). 셋만 남긴 이유: 9급 준비생에게 7급·5급 문항은 난도가 다른 "다른
// 시험"이고, 연도는 법·제도가 바뀌면 옛 문제가 현행과 어긋나거나 출제 경향이 달라져
// 둘 다 "지금 내가 풀 문제인가"를 가르는 축이기 때문이다. 연도는 기본이 전체이고
// 칩(최근 3·5·10년) 하나로 좁히거나 직접 구간을 고른다.
// "안 풀어 본 문항 먼저"·"같은 개념 안 뭉치게"는 서버가 알아서 하고 문구로만 알린다.
//
// 급수가 없는 시행처(경찰·소방·해경·계리직)는 서버가 난도 등급으로 환산해 보낸다
// (exam-level-tier.ts). 그 등급이 섞인 칩은 "9급"이 아니라 "9급 수준"으로 부른다 —
// 순경 준비생에게 "9급"은 자기 시험이 아니라는 신호로 읽혀 아예 안 누른다.
//
// 비로그인 사용자도 이 패널까지는 본다. 누르면 로그인으로 보내고, 돌아오면 같은
// 화면이라 다시 누르기만 하면 된다.
export function MixPracticeStarter({
  subjectSlug,
  subjectName,
  questionCount,
  levelGroups,
  initialLevel,
  cells,
  minYear,
  maxYear,
  loggedIn,
  compact = false,
}: {
  subjectSlug: string;
  subjectName: string;
  // 출제 가능한 문항 수. 0이면 시작 버튼 대신 준비 중 안내.
  questionCount: number;
  // 난도 등급별 문항 수(어느 등급에도 안 묶인 것은 MIX_NO_LEVEL). 둘 이상일 때만 칩을 그린다.
  levelGroups: MixLevelGroup[];
  // 허브에서 고르고 들어온 급수(?level=). 이 과목에 없는 등급이면 무시하고 전체로 둔다.
  initialLevel?: string | null;
  // (등급, 연도) 교차 문항 수. 두 필터를 함께 걸었을 때 남는 수를 여기서 센다.
  cells: MixCountCell[];
  // 자료가 있는 연도 구간. 없으면 연도 칩을 그리지 않는다.
  minYear: number | null;
  maxYear: number | null;
  loggedIn: boolean;
  // 과목 오답노트 상단처럼 좁은 자리에 넣을 때: 설명 문구를 줄인다.
  compact?: boolean;
}) {
  const router = useRouter();
  const [limit, setLimit] = useState<number>(MIX_DEFAULT_LIMIT);
  // 칩에 없는 수를 직접 넣는 입력. 비어 있으면 칩 선택값을 쓴다.
  const [custom, setCustom] = useState("");
  // 고른 급수(다중 선택). 비어 있으면 전체 — 9급+7급처럼 둘을 같이 준비하는 사람도 있다.
  // 허브에서 급수를 고르고 왔으면 그걸로 시작한다(이 과목에 없는 등급이면 전체).
  const [levels, setLevels] = useState<Set<string>>(() =>
    initialLevel && levelGroups.some((g) => g.key === initialLevel)
      ? new Set([initialLevel])
      : new Set(),
  );
  // 연도 범위. 기본은 전체다 — 기출은 오래된 것도 그대로 출제 자산이라, 처음부터
  // 최근 N년으로 좁혀 두면 사용자가 모르는 채 모수를 잃는다.
  const [year, setYear] = useState<MixYearRange>(MIX_ALL_YEARS);
  // 직접 구간 고르기를 펼쳤는지. 칩으로 끝내는 사람이 대부분이라 접어 둔다.
  const [customYear, setCustomYear] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
  const setYearRange = (next: MixYearRange) =>
    setYear(normalizeYearRange(next, { min: minYear, max: maxYear }));
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
  const effectiveLimit = Math.min(
    maxForSubject,
    custom.trim() ? clampMixLimit(custom) : limit,
  );
  const isCustomActive = custom.trim().length > 0;

  function begin() {
    if (pending) return;
    setError(null);
    if (!loggedIn) {
      router.push(
        `/login?next=${encodeURIComponent(`/subjects/${subjectSlug}/mix`)}&error=${encodeURIComponent("로그인 후 섞어풀기를 시작할 수 있어요")}`,
      );
      return;
    }
    start(async () => {
      const res = await createMixSession({
        subjectSlug,
        limit: effectiveLimit,
        levels: [...levels],
        yearFrom: year.from,
        yearTo: year.to,
      });
      if (res.login) {
        router.push(`/login?next=${encodeURIComponent(`/subjects/${subjectSlug}/mix`)}`);
        return;
      }
      if (res.error || !res.sessionId) {
        setError(res.error ?? "섞어풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  if (questionCount === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 px-4 py-3 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
        {subjectName}은(는) 아직 섞어풀기를 준비 중이에요. 문항 이미지와 정답이 등록된
        문제지가 생기면 바로 열려요.
      </p>
    );
  }

  // 라벨: 환산된 문제지가 섞인 등급은 "9급 수준"(사실이 아닌 걸 사실처럼 부르지 않는다),
  // 실제 급수만 있는 등급은 그대로 "9급". 어느 등급에도 안 묶인 묶음은 "기타".
  const labelOf = (g: MixLevelGroup) =>
    g.key === MIX_NO_LEVEL ? "기타" : g.approx ? `${g.key} 수준` : g.key;
  const labelByKey = new Map(groups.map((g) => [g.key, labelOf(g)]));
  const levelLabel = (key: string) => labelByKey.get(key) ?? key;
  const summaryLevels =
    levels.size === 0 ? "" : ` ${levelKeys.filter((k) => levels.has(k)).map(levelLabel).join("·")}`;
  const hasApprox = groups.some((g) => g.approx);
  const summaryYears = isAllYears
    ? ""
    : ` ${year.from ?? minYear}~${year.to ?? maxYear}년`;

  return (
    <div className="flex flex-col gap-3">
      {showLevels && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500">급수</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLevels(new Set())}
              aria-pressed={levels.size === 0}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                levels.size === 0
                  ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              전체{" "}
              <span className="opacity-70">
                {countFor(new Set(), year).toLocaleString()}
              </span>
            </button>
            {groups.map((g) => {
              const active = levels.has(g.key);
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => toggleLevel(g.key)}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    active
                      ? g.key === MIX_NO_LEVEL
                        ? "bg-zinc-500 text-white"
                        : levelColor(g.key)
                      : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  {labelOf(g)}{" "}
                  <span className="opacity-70">
                    {countFor(new Set([g.key]), year).toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
            여러 급수를 함께 고를 수 있어요. 시험(국가직·지방직 등)은 가리지 않고 섞여요.
            {hasApprox
              ? " 경찰·소방·해경·계리직처럼 급수가 없는 시험은 난도가 비슷한 급수에 함께 묶여요(간부후보는 7급 수준, 승진시험은 기타)."
              : ""}
          </p>
        </div>
      )}

      {showYears && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500">연도</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setYear(MIX_ALL_YEARS);
                setCustomYear(false);
              }}
              aria-pressed={isAllYears}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                isAllYears
                  ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              전체 <span className="opacity-70">{minYear}~{maxYear}</span>
            </button>
            {MIX_RECENT_YEAR_OPTIONS.filter(
              // 자료 전체를 덮는 "최근 N년"은 전체 칩과 같아 두 개가 동시에 켜진 것처럼 보인다.
              (n) => maxYear != null && minYear != null && maxYear - n + 1 > minYear,
            ).map((n) => {
              const active = activeRecent === n && !customYear;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setYearRange(recentYearRange(n, maxYear));
                    setCustomYear(false);
                  }}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    active
                      ? "bg-blue-600 text-white"
                      : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
                  }`}
                >
                  최근 {n}년
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomYear((v) => !v)}
              aria-pressed={customYear}
              aria-expanded={customYear}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                customYear
                  ? "bg-blue-600 text-white"
                  : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
              }`}
            >
              직접 고르기
            </button>
          </div>

          {customYear && (
            <div className="flex flex-wrap items-center gap-2">
              <YearSelect
                label="시작 연도"
                value={year.from ?? minYear}
                years={years}
                onChange={(v) => setYearRange({ from: v, to: year.to ?? maxYear })}
              />
              <span className="text-sm text-zinc-400 dark:text-zinc-600">~</span>
              <YearSelect
                label="끝 연도"
                value={year.to ?? maxYear}
                years={years}
                onChange={(v) => setYearRange({ from: year.from ?? minYear, to: v })}
              />
            </div>
          )}

          <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
            {isAllYears
              ? "기본은 전체예요. 법·제도가 바뀐 과목이면 최근 몇 년으로 좁혀서 풀어보세요."
              : `${year.from ?? minYear}~${year.to ?? maxYear}년 문제만 나와요. 지금 조건으로 풀 수 있는 문항 ${selectedCount.toLocaleString()}개.`}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500">문항 수</span>
        <div className="flex flex-wrap items-center gap-2">
          {MIX_LIMIT_OPTIONS.filter((n) => n <= maxForSubject || n === MIX_LIMIT_OPTIONS[0]).map(
            (n) => {
              const active = !isCustomActive && limit === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setLimit(n);
                    setCustom("");
                  }}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    active
                      ? "bg-blue-600 text-white"
                      : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
                  }`}
                >
                  {n}문항
                </button>
              );
            },
          )}
          <label className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            <input
              type="number"
              inputMode="numeric"
              min={MIX_MIN_LIMIT}
              max={maxForSubject}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="직접"
              aria-label="문항 수 직접 입력"
              className={`w-20 rounded-full border px-3 py-2 text-center text-sm font-semibold outline-none focus:border-blue-400 dark:bg-zinc-900 ${
                isCustomActive
                  ? "border-blue-500 text-blue-700 dark:text-blue-300"
                  : "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            />
            문항
          </label>
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
          {MIX_MIN_LIMIT}~{maxForSubject}문항까지. 아직 안 풀어 본 문제를 먼저, 여러 시험·연도가
          고르게 섞이고 같은 개념이 몰리지 않게 골라요.
        </p>
      </div>

      <button
        type="button"
        onClick={begin}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Shuffle size={16} />
        {pending
          ? "문제를 섞는 중..."
          : `${subjectName}${summaryLevels}${summaryYears} 기출 ${effectiveLimit}문항 섞어풀기 시작`}
      </button>
      {error && (
        <p className="text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      {!compact && (
        <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-600">
          풀고 나면 오답노트에 &ldquo;○월 ○일 섞어풀기&rdquo;로 남고, 틀린 문제는 과목
          오답에 합쳐져요.
        </p>
      )}
    </div>
  );
}

// 연도 하나를 고르는 셀렉트. 목록이 20년치를 넘길 수 있어 칩 대신 셀렉트로 둔다
// (좁은 폰 화면에서 칩 20개는 네 줄을 먹는다).
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
  return (
    <label className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
    </label>
  );
}
