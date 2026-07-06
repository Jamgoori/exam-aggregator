"use client";

import { useState, useTransition } from "react";
import { setDefaultCbtViewMode } from "@/app/actions";

export function CbtViewModeField({
  defaultValue,
}: {
  defaultValue: "full" | "single";
}) {
  const [mode, setMode] = useState(defaultValue);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: "full" | "single") {
    if (next === mode || isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await setDefaultCbtViewMode(next);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setMode(next);
      setMessage("저장했어요.");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-500">
        온라인 응시를 시작할 때 어느 화면으로 열지 선택해요.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleSelect("full")}
          disabled={isPending}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            mode === "full"
              ? "border-blue-600 bg-blue-50 text-blue-600"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          전체보기
        </button>
        <button
          type="button"
          onClick={() => handleSelect("single")}
          disabled={isPending}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            mode === "single"
              ? "border-blue-600 bg-blue-50 text-blue-600"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          문제별 풀기
        </button>
      </div>
      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  );
}
