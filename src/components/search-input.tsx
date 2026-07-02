"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

const DEBOUNCE_MS = 300;

export function SearchInput({ initialQuery }: { initialQuery?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initialQuery ?? "");
  }, [initialQuery]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      params.delete("page");
      router.push(`/?${params.toString()}`);
    }, DEBOUNCE_MS);
  }

  return (
    <div className="flex w-full max-w-2xl items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 shadow-sm transition-colors focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
      <Search size={22} className="shrink-0 text-blue-400" />
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="과목명, 시험 종류, 연도로 검색..."
        className="w-full text-base outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}
