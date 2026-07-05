"use client";

import { useState, useTransition } from "react";
import { checkNicknameAvailable, setNickname } from "@/app/actions";
import { NICKNAME_MAX, NICKNAME_MIN } from "@/lib/nickname";

export function NicknameField({
  defaultValue = "",
  // "edit": 중복확인 통과 시 바로 저장까지 함 (마이페이지 수정 화면, 별도 저장 버튼 없음)
  // "signup": 중복확인만 하고 실제 저장은 회원가입 폼 제출 시 서버에서 한 번 더 검증함
  mode,
}: {
  defaultValue?: string;
  mode: "edit" | "signup";
}) {
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
      if (mode === "signup") {
        setStatus("ok");
        setMessage("사용 가능한 닉네임이에요.");
        return;
      }

      const saveResult = await setNickname(value);
      if (saveResult.error) {
        setStatus("bad");
        setMessage(saveResult.error);
        return;
      }
      setStatus("ok");
      setMessage("닉네임을 변경했어요.");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="nickname" className="text-sm text-zinc-600">
        닉네임
      </label>
      <div className="flex gap-2">
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
          className="flex-1 rounded border border-zinc-300 px-3 py-2"
        />
        <button
          type="button"
          onClick={handleCheck}
          disabled={isPending || !value}
          className="shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          중복확인
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
      </p>
      {message && (
        <p className={`text-sm ${status === "bad" ? "text-red-600" : "text-green-600"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
