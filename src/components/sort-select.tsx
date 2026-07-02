"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "latest", label: "최신순" },
  { value: "downloads", label: "다운로드순" },
];

export function SortSelect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("sort") ?? "latest";

  return (
    <select
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("sort", e.target.value);
        params.delete("page");
        router.push(`/?${params.toString()}`);
      }}
      className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600"
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
