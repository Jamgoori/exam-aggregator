"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkUsernameAvailable, signUpUser } from "@/app/actions";
import { NicknameField } from "@/components/nickname-field";
import { USERNAME_MAX, USERNAME_MIN } from "@/lib/username";

type FieldErrors = Partial<
  Record<"username" | "nickname" | "password" | "passwordConfirm" | "general", string>
>;

export function SignupForm({
  next,
  turnstileSiteKey,
}: {
  next: string;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "ok" | "bad">("idle");
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isCheckingUsername, startUsernameCheck] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();
  const isPending = isCheckingUsername || isSubmitting;

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function handleUsernameCheck() {
    setUsernameMessage(null);
    startUsernameCheck(async () => {
      const result = await checkUsernameAvailable(username);
      if (result.error) {
        setUsernameStatus("bad");
        setUsernameMessage(result.error);
        return;
      }
      if (!result.available) {
        setUsernameStatus("bad");
        setUsernameMessage("이미 사용 중인 아이디예요.");
        return;
      }
      setUsernameStatus("ok");
      setUsernameMessage("사용 가능한 아이디예요.");
    });
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
        username,
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
        <label htmlFor="username" className="text-sm text-zinc-600">
          아이디
        </label>
        <input
          id="username"
          name="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setUsernameStatus("idle");
            setUsernameMessage(null);
            clearFieldError("username");
          }}
          required
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          pattern="[a-zA-Z0-9_]+"
          title="영문 소문자, 숫자, _만 사용할 수 있어요"
          autoComplete="username"
          className={`rounded border px-3 py-2 ${
            fieldErrors.username ? "border-red-400" : "border-zinc-300"
          }`}
        />
        <button
          type="button"
          onClick={handleUsernameCheck}
          disabled={isPending || !username}
          className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          중복확인
        </button>
        <p className="text-xs text-zinc-400">
          영문 소문자, 숫자, _ 조합 {USERNAME_MIN}~{USERNAME_MAX}자
        </p>
        {usernameMessage && (
          <p
            className={`text-sm ${usernameStatus === "bad" ? "text-red-600" : "text-green-600"}`}
          >
            {usernameMessage}
          </p>
        )}
        {fieldErrors.username && <p className="text-sm text-red-600">{fieldErrors.username}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <NicknameField mode="signup" />
        {fieldErrors.nickname && <p className="text-sm text-red-600">{fieldErrors.nickname}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-zinc-600">
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
            fieldErrors.password ? "border-red-400" : "border-zinc-300"
          }`}
        />
        {fieldErrors.password && <p className="text-sm text-red-600">{fieldErrors.password}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="passwordConfirm" className="text-sm text-zinc-600">
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
            fieldErrors.passwordConfirm ? "border-red-400" : "border-zinc-300"
          }`}
        />
        {fieldErrors.passwordConfirm && (
          <p className="text-sm text-red-600">{fieldErrors.passwordConfirm}</p>
        )}
      </div>

      {turnstileSiteKey && <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />}

      {fieldErrors.general && <p className="text-sm text-red-600">{fieldErrors.general}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "가입 중..." : "가입하기"}
      </button>
    </form>
  );
}
