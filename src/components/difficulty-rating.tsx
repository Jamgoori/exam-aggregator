"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { postRating } from "@/app/papers/actions";

const GUEST_ID_KEY = "exam-aggregator-guest-id";

function getGuestToken() {
  let token = localStorage.getItem(GUEST_ID_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(GUEST_ID_KEY, token);
  }
  return token;
}

export function DifficultyRating({
  paperId,
  averageScore,
  voteCount,
  loggedIn,
}: {
  paperId: string;
  averageScore: number | null;
  voteCount: number;
  loggedIn: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const displayScore = hovered ?? selected ?? 0;

  function vote(score: number) {
    startTransition(async () => {
      const guestToken = loggedIn ? null : getGuestToken();
      const result = await postRating(paperId, score, guestToken);
      if (result.error) {
        setMessage(result.error);
      } else {
        setSelected(score);
        setMessage("평가해주셔서 감사해요.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">체감 난이도</span>
        <span className="text-sm text-zinc-500">
          {averageScore ? `평균 ${averageScore.toFixed(1)} / 5` : "평가 없음"} ·{" "}
          {voteCount}명 참여
        </span>
      </div>
      <div className="flex gap-1" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            disabled={pending || selected !== null}
            onClick={() => vote(score)}
            onMouseEnter={() => setHovered(score)}
            aria-label={`난이도 ${score}점`}
            className={`disabled:cursor-default ${
              score <= displayScore ? "text-amber-400" : "text-zinc-300"
            }`}
          >
            <Star
              size={22}
              fill={score <= displayScore ? "currentColor" : "none"}
            />
          </button>
        ))}
      </div>
      {message && <p className="text-xs text-zinc-500">{message}</p>}
    </div>
  );
}
