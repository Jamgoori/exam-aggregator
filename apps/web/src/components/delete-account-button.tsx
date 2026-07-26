"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 회원 탈퇴. 실제 삭제는 service_role 이 필요해서 Supabase Edge Function(account-delete)이
// 하고, 웹·앱이 같은 함수를 부른다. 되돌릴 수 없는 작업이라 "탈퇴" 문구를 직접 입력받는
// 2단계 확인을 거친다.
const CONFIRM_PHRASE = "탈퇴";

export function DeleteAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: fnError } = await supabase.functions.invoke("account-delete");
      if (fnError) {
        // FunctionsHttpError 면 context 에 원본 Response 가 들어 있어 서버 메시지를 꺼낼 수 있다.
        const context = (fnError as { context?: Response }).context;
        let message: string | null = null;
        if (context && typeof context.json === "function") {
          const body = await context.json().catch(() => null);
          if (body && typeof body.error === "string") message = body.error;
        }
        throw new Error(message ?? "탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
      // 계정이 사라진 뒤라 서버 로그아웃은 실패할 수 있다 — 로컬 세션만 지우면 된다.
      await supabase.auth.signOut().catch(() => {});
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "탈퇴 처리에 실패했어요.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-red-600 underline underline-offset-2 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
      >
        회원 탈퇴
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-red-200 p-4 dark:border-red-900/60">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        탈퇴하면 응시 기록·오답노트·메모·즐겨찾기가 즉시 삭제되고 복구할 수 없어요. 작성한
        댓글은 다른 이용자의 답글이 끊기지 않도록 &lsquo;탈퇴한 회원&rsquo; 이름으로 남습니다.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-500">
          계속하려면 <strong className="text-zinc-800 dark:text-zinc-200">{CONFIRM_PHRASE}</strong>
          를 입력하세요.
        </span>
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          autoComplete="off"
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || phrase.trim() !== CONFIRM_PHRASE}
          className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "탈퇴 처리 중..." : "탈퇴하기"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPhrase("");
            setError(null);
          }}
          disabled={busy}
          className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
