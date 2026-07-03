"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { postRating } from "@/app/papers/actions";

const SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// 별점(=품질 평가) 느낌이 아니라 "쉬움 → 어려움"으로 읽히도록 초록~빨강 그라데이션을 쓴다.
function colorForScore(score: number) {
  if (score <= 1.5) return "bg-emerald-400";
  if (score <= 2.5) return "bg-lime-400";
  if (score <= 3.5) return "bg-yellow-400";
  if (score <= 4.5) return "bg-orange-500";
  return "bg-red-500";
}

function labelForScore(score: number) {
  if (score <= 1.5) return "매우 쉬움";
  if (score <= 2.5) return "쉬움";
  if (score <= 3.5) return "보통";
  if (score <= 4.5) return "어려움";
  return "매우 어려움";
}

export function DifficultyRating({
  paperId,
  averageScore,
  voteCount,
  loggedIn,
  initialMyScore = null,
}: {
  paperId: string;
  averageScore: number | null;
  voteCount: number;
  loggedIn: boolean;
  initialMyScore?: number | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  // 막대를 누른 시점엔 아직 서버로 전송하지 않고 "선택만" 해두고, 별도 제출 버튼을 눌러야
  // 실제로 투표된다 (클릭 한 번에 바로 확정되던 기존 방식이 어색하다는 피드백 반영).
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // 서버에서 내려준 "이미 투표한 점수"로 초기화한다. 이게 없으면 이미 투표한 사용자도
  // 페이지를 새로 열 때마다 아직 투표 안 한 것처럼 회색 막대가 다시 클릭 가능해 보였다.
  const [myScore, setMyScore] = useState<number | null>(initialMyScore);
  const [avg, setAvg] = useState(averageScore);
  const [count, setCount] = useState(voteCount);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();

  const voted = myScore !== null;
  const activeScore = myScore ?? hovered ?? selected ?? 0;

  function submit() {
    if (selected === null || !loggedIn) return;
    startTransition(async () => {
      const result = await postRating(paperId, selected);
      if (result.error) {
        setMessage(result.error);
      } else {
        setMyScore(selected);
        if (typeof result.voteCount === "number") setCount(result.voteCount);
        if (result.averageScore !== undefined) setAvg(result.averageScore);
        setMessage("평가해주셔서 감사해요.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4">
      {/* 로그인 여부와 상관없이 제목은 항상 그대로 보여줘서, 블러 처리된 영역이
          "난이도 평가 칸"이라는 걸 알 수 있게 한다. 평균/참여자 수는 집계 데이터라
          비로그인 사용자에게는 블러 영역 안에 숨긴다. */}
      <span className="text-sm font-medium">체감 난이도</span>

      <div className="relative">
        <div
          className={`flex flex-col gap-3 ${
            loggedIn ? "" : "pointer-events-none select-none blur-sm"
          }`}
          aria-hidden={!loggedIn}
        >
          <p className="text-sm text-zinc-500">
            {avg ? `평균 ${avg.toFixed(1)} / 5` : "평가 없음"} · {count}명 참여
          </p>

          <div className="flex flex-col gap-1">
            <div className="flex items-end gap-1" onMouseLeave={() => setHovered(null)}>
              {SCORES.map((score, i) => (
                <button
                  key={score}
                  type="button"
                  disabled={pending || voted}
                  onClick={() => setSelected(score)}
                  onMouseEnter={() => setHovered(score)}
                  aria-label={`난이도 ${score}점`}
                  aria-pressed={selected === score}
                  style={{ height: `${14 + i * 3}px` }}
                  className={`flex-1 rounded-sm transition-colors disabled:cursor-default ${
                    score <= activeScore ? colorForScore(score) : "bg-zinc-200"
                  }`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>쉬움</span>
              <span>매우 어려움</span>
            </div>
          </div>

          <p className="text-xs text-zinc-600">
            {voted
              ? `내가 준 점수: ${myScore} · ${labelForScore(myScore as number)}`
              : selected !== null
                ? `${selected} · ${labelForScore(selected)}`
                : "막대를 눌러 체감 난이도를 선택해주세요."}
          </p>

          {!voted && (
            <button
              type="button"
              disabled={pending || selected === null}
              onClick={submit}
              className="self-start rounded bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "제출 중..." : "평가 제출하기"}
            </button>
          )}

          {message && <p className="text-xs text-zinc-500">{message}</p>}
        </div>

        {!loggedIn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-white/70">
            <p className="text-sm font-medium text-zinc-700">
              난이도 평가는 로그인 후 참여할 수 있어요
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/")}`}
              className="rounded bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
            >
              로그인하기
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
