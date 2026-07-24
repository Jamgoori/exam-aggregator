"use client";

import { useState, useTransition } from "react";
import { checkNicknameAvailable, setNickname } from "@/app/actions";
import { NICKNAME_MAX, NICKNAME_MIN } from "@gongmoa/core";

// 마이페이지 수정 화면용: 중복확인은 확인만 하고, "적용" 버튼을 눌러야 실제로 저장된다.
// (최초 닉네임은 소셜 로그인 후 /onboarding/nickname의 폼 제출로 받는다.)
export function NicknameField({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<"idle" | "ok" | "bad">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCheck() {
    setMessage(null);
    startTransition(async () => {
      const result = await checkNicknameAvailable(value);
      if (result.error) {
        setStatus("bad");
        setMessage(result.error);
        return;
      }
      if (!result.available) {
        setStatus("bad");
        setMessage("이미 사용 중인 닉네임이에요.");
        return;
      }
      setStatus("ok");
      setMessage("사용 가능한 닉네임이에요.");
    });
  }

  function handleApply() {
    if (status !== "ok") {
      setMessage("먼저 중복확인을 해주세요.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await setNickname(value);
      if (result.error) {
        setStatus("bad");
        setMessage(result.error);
        return;
      }
      setStatus("ok");
      setMessage("닉네임을 변경했어요.");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="nickname" className="text-sm text-zinc-600 dark:text-zinc-400">
        닉네임
      </label>
      <input
        id="nickname"
        name="nickname"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("idle");
          setMessage(null);
        }}
        required
        minLength={NICKNAME_MIN}
        maxLength={NICKNAME_MAX}
        className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
      />
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={isPending || !value}
          className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
        >
          중복확인
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={isPending || !value || status !== "ok"}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          적용
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
      </p>
      {message && (
        <p className={`text-sm ${status === "bad" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
