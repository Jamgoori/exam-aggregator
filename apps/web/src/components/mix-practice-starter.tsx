"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import { createMixSession } from "@/app/mypage/wrong-notes/actions";
import { compareLevels, levelColor } from "@/lib/level-colors";
import {
  clampMixLimit,
  MIX_DEFAULT_LIMIT,
  MIX_LIMIT_OPTIONS,
  MIX_MAX_LIMIT,
  MIX_MIN_LIMIT,
  MIX_NO_LEVEL,
} from "@gongmoa/core";
import type { MixLevelGroup } from "@/lib/mix-practice";

// 기출 섞어풀기 시작 패널. 고를 것은 급수와 문항 수뿐이다 — 시행처·연도·순서 같은
// 설정은 늘어놓지 않는다(오답노트 로드맵 UX 원칙 5: 설정을 노출하지 말고 기본값으로
// 흡수). 급수만 남긴 이유: 9급 준비생에게 7급·5급 문항은 난도가 다른 "다른 시험"이라
// 섞이면 오답률이 실력과 무관하게 뛴다. "안 풀어 본 문항 먼저"·"같은 개념 안 뭉치게"는
// 서버가 알아서 하고 여기서는 문구로만 알린다.
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
  loggedIn,
  compact = false,
}: {
  subjectSlug: string;
  subjectName: string;
  // 출제 가능한 문항 수. 0이면 시작 버튼 대신 준비 중 안내.
  questionCount: number;
  // 난도 등급별 문항 수(어느 등급에도 안 묶인 것은 MIX_NO_LEVEL). 둘 이상일 때만 칩을 그린다.
  levelGroups: MixLevelGroup[];
  loggedIn: boolean;
  // 과목 오답노트 상단처럼 좁은 자리에 넣을 때: 설명 문구를 줄인다.
  compact?: boolean;
}) {
  const router = useRouter();
  const [limit, setLimit] = useState<number>(MIX_DEFAULT_LIMIT);
  // 칩에 없는 수를 직접 넣는 입력. 비어 있으면 칩 선택값을 쓴다.
  const [custom, setCustom] = useState("");
  // 고른 급수(다중 선택). 비어 있으면 전체 — 9급+7급처럼 둘을 같이 준비하는 사람도 있다.
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 칩 순서: 9급 → 7급 → … "기타"는 맨 뒤. 문항이 0인 등급은 애초에 오지 않는다.
  const groups = [...levelGroups].sort((a, b) => {
    if (a.key === MIX_NO_LEVEL) return 1;
    if (b.key === MIX_NO_LEVEL) return -1;
    return compareLevels(a.key, b.key);
  });
  const countByKey = new Map(groups.map((g) => [g.key, g.count]));
  const levelKeys = groups.map((g) => g.key);
  const showLevels = groups.length > 1;
  const selectedCount =
    levels.size === 0
      ? questionCount
      : [...levels].reduce((sum, l) => sum + (countByKey.get(l) ?? 0), 0);

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
              전체 <span className="opacity-70">{questionCount.toLocaleString()}</span>
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
                  {labelOf(g)} <span className="opacity-70">{g.count.toLocaleString()}</span>
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
          : `${subjectName}${summaryLevels} 기출 ${effectiveLimit}문항 섞어풀기 시작`}
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
