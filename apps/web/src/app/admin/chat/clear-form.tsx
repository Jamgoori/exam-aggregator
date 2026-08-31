"use client";

import { useActionState } from "react";
import { CHAT_CLEAR_CONFIRM_TEXT } from "@gongmoa/core";
import { clearChatHistory, type ClearChatState } from "@/app/admin/actions";

const initialState: ClearChatState = {};

// 채팅 기록 초기화 폼. 되돌릴 수 없는 삭제라 "무엇을 지우는지"를 화면에 그대로 적어 두고,
// 방 전체를 비울 때는 확인 문구를 받는다(진단 초기화 폼과 같은 이유 — 관리자 화면이라도
// 지운 뒤에 알게 되는 건 똑같이 사고다).
export function ClearChatForm() {
  const [state, action, pending] = useActionState(clearChatHistory, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
          대상 계정 이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          placeholder="비우면 채팅방 전체"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          이메일을 넣으면 그 계정이 남긴 메시지만 지워요(도배·비방 정리용). 비워 두면 채팅방
          전체를 비웁니다.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirm" className="text-sm text-zinc-600 dark:text-zinc-400">
          확인 문구
        </label>
        <input
          id="confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          placeholder={CHAT_CLEAR_CONFIRM_TEXT}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          채팅방 전체를 비울 때만 필요해요. <b className="font-semibold">{CHAT_CLEAR_CONFIRM_TEXT}</b>
          를 그대로 입력하세요.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
        지운 메시지는 <b className="font-semibold">되돌릴 수 없어요.</b> 채팅방을 열어 둔 사람의
        화면에서도 바로 사라집니다. 댓글·해설 등 다른 글은 건드리지 않아요.
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "초기화하는 중..." : "채팅 기록 초기화"}
      </button>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.message && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>
      )}
    </form>
  );
}
