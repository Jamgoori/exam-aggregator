"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import { createMixSession } from "@/app/mypage/wrong-notes/actions";
import {
  clampMixLimit,
  MIX_DEFAULT_LIMIT,
  MIX_LIMIT_OPTIONS,
  MIX_MAX_LIMIT,
  MIX_MIN_LIMIT,
} from "@gongmoa/core";

// 기출 섞어풀기 시작 패널. 고를 것은 문항 수 하나뿐이다 — 범위(시행처·연도)·순서 같은
// 설정을 늘어놓지 않는다(오답노트 로드맵 UX 원칙 5: 설정을 노출하지 말고 기본값으로
// 흡수). "안 풀어 본 문항 먼저"는 서버가 알아서 하고 여기서는 문구로만 알린다.
//
// 비로그인 사용자도 이 패널까지는 본다. 누르면 로그인으로 보내고, 돌아오면 같은
// 화면이라 다시 누르기만 하면 된다.
export function MixPracticeStarter({
  subjectSlug,
  subjectName,
  questionCount,
  loggedIn,
  compact = false,
}: {
  subjectSlug: string;
  subjectName: string;
  // 출제 가능한 문항 수. 0이면 시작 버튼 대신 준비 중 안내.
  questionCount: number;
  loggedIn: boolean;
  // 과목 오답노트 상단처럼 좁은 자리에 넣을 때: 설명 문구를 줄인다.
  compact?: boolean;
}) {
  const router = useRouter();
  const [limit, setLimit] = useState<number>(MIX_DEFAULT_LIMIT);
  // 칩에 없는 수를 직접 넣는 입력. 비어 있으면 칩 선택값을 쓴다.
  const [custom, setCustom] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const maxForSubject = Math.max(MIX_MIN_LIMIT, Math.min(MIX_MAX_LIMIT, questionCount));
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
      const res = await createMixSession({ subjectSlug, limit: effectiveLimit });
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

  return (
    <div className="flex flex-col gap-3">
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
          고르게 섞여 나와요.
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
          : `${subjectName} 기출 ${effectiveLimit}문항 섞어풀기 시작`}
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
