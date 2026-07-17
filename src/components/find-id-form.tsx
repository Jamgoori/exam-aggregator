"use client";

import { useState, useTransition, type FormEvent } from "react";
import { findEmailHintByNickname } from "@/app/actions";

export function FindIdForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [nickname, setNickname] = useState("");
  const [result, setResult] = useState<{ maskedEmail?: string; error?: string } | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const formData = new FormData(e.currentTarget);
    const captchaToken = String(formData.get("cf-turnstile-response") ?? "");

    startSubmit(async () => {
      const res = await findEmailHintByNickname({ nickname, captchaToken });
      setResult(res);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="nickname" className="text-sm text-zinc-600 dark:text-zinc-400">
          닉네임
        </label>
        <input
          id="nickname"
          name="nickname"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            setResult(null);
          }}
          required
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
      </div>

      {turnstileSiteKey && <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />}

      {result?.error && <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>}
      {result?.maskedEmail && (
        <p className="text-sm text-green-600 dark:text-green-400">
          가입한 이메일: {result.maskedEmail}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "확인 중..." : "이메일 찾기"}
      </button>
    </form>
  );
}
