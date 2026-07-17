"use client";

import { useState, useTransition, type FormEvent } from "react";
import { requestPasswordReset } from "@/app/actions";

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ error?: string; sent?: boolean } | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const formData = new FormData(e.currentTarget);
    const captchaToken = String(formData.get("cf-turnstile-response") ?? "");

    startSubmit(async () => {
      const res = await requestPasswordReset({ email, captchaToken });
      setResult(res.error ? { error: res.error } : { sent: true });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setResult(null);
          }}
          required
          autoComplete="email"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
      </div>

      {turnstileSiteKey && <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />}

      {result?.error && <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>}
      {result?.sent && (
        <p className="text-sm text-green-600 dark:text-green-400">
          입력하신 이메일로 재설정 링크를 보냈어요. 가입 내역이 있다면 메일함(스팸함 포함)을
          확인해주세요.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "요청 중..." : "재설정 링크 받기"}
      </button>
    </form>
  );
}
