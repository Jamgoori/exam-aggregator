"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unblockUser } from "@/app/board/actions";
import type { BlockedUser } from "@/lib/blocks";

// 내 정보 수정의 "차단한 사용자" 절 — 앱 blocked-users-section.tsx 를 웹으로 옮긴 것(앱→웹 1:1,
// 설계서 §12-2 #16). 차단한 사용자의 글·댓글은 어디에도 보이지 않으므로 해제할 자리가 여기밖에
// 없다. 문구는 앱과 같은 문장.
//
// 목록은 서버 컴포넌트(mypage/edit/page.tsx)가 RPC my_blocked_users 로 읽어 넘긴다 — 앱은
// 화면에서 읽어 "불러오는 중…" 을 그리지만 웹은 서버 렌더라 그 상태가 없다(의도적 차이).
// 해제는 서버 액션 unblockUser(RPC unblock_user, 멱등) → 목록에서 즉시 빼고 router.refresh().
export function BlockedUsersSection({
  initialUsers,
  loadError,
}: {
  initialUsers: BlockedUser[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [list, setList] = useState(initialUsers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function unblock(id: string) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await unblockUser(id);
      if (result.error) {
        setError(result.error);
      } else {
        setList((prev) => prev.filter((u) => u.userId !== id));
        router.refresh();
      }
      setBusyId(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        {list.length > 0 ? `차단한 사용자 ${list.length}명` : "차단한 사용자가 없어요."}
      </p>

      {list.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {list.map(({ userId: id, nickname }, i) => (
            <li
              key={id}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""
              }`}
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{nickname}</span>
              <button
                type="button"
                onClick={() => unblock(id)}
                disabled={busyId !== null}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}

      {loadError && !error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
