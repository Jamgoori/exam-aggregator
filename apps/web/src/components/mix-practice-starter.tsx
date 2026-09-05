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

// 기출 섞어풀기 시작 패널. 고를 것은 급수와 문항 수뿐이다 — 시행처·연도·순서 같은
// 설정은 늘어놓지 않는다(오답노트 로드맵 UX 원칙 5: 설정을 노출하지 말고 기본값으로
// 흡수). 급수만 남긴 이유: 9급 준비생에게 7급·5급 문항은 난도가 다른 "다른 시험"이라
// 섞이면 오답률이 실력과 무관하게 뛴다. "안 풀어 본 문항 먼저"·"같은 개념 안 뭉치게"는
// 서버가 알아서 하고 여기서는 문구로만 알린다.
//
// 비로그인 사용자도 이 패널까지는 본다. 누르면 로그인으로 보내고, 돌아오면 같은
// 화면이라 다시 누르기만 하면 된다.
export function MixPracticeStarter({
  subjectSlug,
  subjectName,
  questionCount,
  levelCounts,
  loggedIn,
  compact = false,
}: {
  subjectSlug: string;
  subjectName: string;
  // 출제 가능한 문항 수. 0이면 시작 버튼 대신 준비 중 안내.
  questionCount: number;
  // 급수별 출제 가능 문항 수(급수 없음은 MIX_NO_LEVEL 키). 급수가 둘 이상일 때만 칩을 그린다.
  levelCounts: Record<string, number>;
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

  // 급수 칩 순서: 9급 → 7급 → … 급수 없음은 맨 뒤. 문항이 0인 급수는 애초에 키가 없다.
  const levelKeys = Object.keys(levelCounts).sort((a, b) => {
    if (a === MIX_NO_LEVEL) return 1;
    if (b === MIX_NO_LEVEL) return -1;
    return compareLevels(a, b);
  });
  const showLevels = levelKeys.length > 1;
  const selectedCount =
    levels.size === 0
      ? questionCount
      : [...levels].reduce((sum, l) => sum + (levelCounts[l] ?? 0), 0);

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

  const levelLabel = (key: string) => (key === MIX_NO_LEVEL ? "급수 없음" : key);
  const summaryLevels =
    levels.size === 0 ? "" : ` ${levelKeys.filter((k) => levels.has(k)).map(levelLabel).join("·")}`;

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
            {levelKeys.map((key) => {
              const active = levels.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleLevel(key)}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    active
                      ? key === MIX_NO_LEVEL
                        ? "bg-zinc-500 text-white"
                        : levelColor(key)
                      : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  {levelLabel(key)}{" "}
                  <span className="opacity-70">{levelCounts[key].toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
            여러 급수를 함께 고를 수 있어요. 시험(국가직·지방직 등)은 가리지 않고 섞여요.
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
