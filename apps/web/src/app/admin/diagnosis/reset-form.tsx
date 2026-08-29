"use client";

import { useActionState } from "react";
import { resetDiagnosisCycle, type ResetDiagnosisState } from "@/app/admin/actions";

const initialState: ResetDiagnosisState = {};

// AI 약점 진단 초기화 폼. 되돌릴 수 없는 삭제라 "무엇을 지우는지"를 버튼 옆이 아니라
// 화면에 그대로 적어 둔다 — 관리자 화면이라도 지운 뒤에 알게 되는 건 똑같이 사고다.
export function ResetDiagnosisForm({ adminEmail }: { adminEmail: string | null }) {
  const [state, action, pending] = useActionState(resetDiagnosisCycle, initialState);

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
          placeholder={adminEmail ? `비우면 내 계정(${adminEmail})` : "비우면 내 계정"}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          비워 두면 로그인한 관리자 계정을 초기화해요.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-zinc-600 dark:text-zinc-400">범위</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="cycle" defaultChecked className="mt-1" />
          <span>
            <b className="font-semibold">이번 주기만</b>
            <span className="block text-xs text-zinc-500 dark:text-zinc-500">
              최근 7일 안에 받은 진단을 지워요. 바로 다시 받을 수 있게 됩니다.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="all" className="mt-1" />
          <span>
            <b className="font-semibold">전체 이력</b>
            <span className="block text-xs text-zinc-500 dark:text-zinc-500">
              그 계정의 진단 기록을 모두 지워요(지난 리포트도 사라집니다).
            </span>
          </span>
        </label>
      </fieldset>

      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
        지우는 것은 <b className="font-semibold">진단 요청·리포트 기록뿐</b>입니다. 오답·응시
        기록은 그대로예요. 만들던 중인 배치가 있으면 그 결과는 버려지고(요금은 이미 나감),
        곧바로 다시 요청하면 같은 분석에 두 번 요금이 나갑니다.
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "초기화하는 중..." : "진단 기록 초기화"}
      </button>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      {state.message && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>
      )}
    </form>
  );
}
