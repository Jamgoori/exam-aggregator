"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signUpUser } from "@/app/actions";
import { NicknameField } from "@/components/nickname-field";

type FieldErrors = Partial<
  Record<"email" | "nickname" | "password" | "passwordConfirm" | "general", string>
>;

export function SignupForm({
  next,
  turnstileSiteKey,
}: {
  next: string;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, startSubmit] = useTransition();

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  // 실패해도 화면 전체를 새로고침하지 않고 결과만 반환받아, 입력값은 그대로 두고
  // 문제가 된 필드 아래에만 빨간 글씨로 이유를 보여준다.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    const nickname = String(formData.get("nickname") ?? "");
    const captchaToken = String(formData.get("cf-turnstile-response") ?? "");

    startSubmit(async () => {
      const result = await signUpUser({
        email,
        nickname,
        password,
        passwordConfirm,
        next,
        captchaToken,
      });
      if (!result.success) {
        setFieldErrors({ [result.field]: result.error });
        return;
      }
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
          이메일 (로그인 아이디로 사용돼요)
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearFieldError("email");
          }}
          required
          autoComplete="email"
          className={`rounded border px-3 py-2 ${
            fieldErrors.email ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          아이디/비밀번호 찾기에 쓰이니 실제로 받는 이메일을 입력해주세요.
        </p>
        {fieldErrors.email && <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <NicknameField mode="signup" />
        {fieldErrors.nickname && <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.nickname}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-zinc-600 dark:text-zinc-400">
          비밀번호 (8자 이상)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError("password");
          }}
          className={`rounded border px-3 py-2 ${
            fieldErrors.password ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
        {fieldErrors.password && <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.password}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="passwordConfirm" className="text-sm text-zinc-600 dark:text-zinc-400">
          비밀번호 확인
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          minLength={8}
          required
          value={passwordConfirm}
          onChange={(e) => {
            setPasswordConfirm(e.target.value);
            clearFieldError("passwordConfirm");
          }}
          className={`rounded border px-3 py-2 ${
            fieldErrors.passwordConfirm ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
        {fieldErrors.passwordConfirm && (
          <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.passwordConfirm}</p>
        )}
      </div>

      {turnstileSiteKey && <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />}

      {fieldErrors.general && <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.general}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "가입 중..." : "가입하기"}
      </button>
    </form>
  );
}
