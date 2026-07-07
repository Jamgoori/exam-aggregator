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
  // 우리가 마지막으로 push한 값을 기억해뒀다가, 그 push가 반영되어 initialQuery가
  // 똑같은 값으로 내려오면 "내가 이미 반영한 echo"로 보고 무시한다. 이 구분이 없으면
  // 디바운스 후 페이지가 재렌더될 때마다 value를 initialQuery로 덮어써서, 그 사이에
  // 사용자가 이어서 입력한 글자가 사라지거나 IME 조합 중인 글자가 씹히는 문제가 생긴다.
  const lastPushedRef = useRef(initialQuery ?? "");

  useEffect(() => {
    if ((initialQuery ?? "") !== lastPushedRef.current) {
      setValue(initialQuery ?? "");
      lastPushedRef.current = initialQuery ?? "";
    }
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
      lastPushedRef.current = next;
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      params.delete("page");
      router.push(`/?${params.toString()}`);
    }, DEBOUNCE_MS);
  }

  return (
    // 596px는 위 소개 문단("국가직·지방직·서울시 ... 정리했어요.")이 한 줄로
    // 렌더링됐을 때 폭과 맞춘 값이라, 그 줄 끝과 오른쪽 끝이 나란해 보인다.
    <div className="flex w-full max-w-[596px] items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 shadow-sm transition-colors focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
      <Search size={22} className="shrink-0 text-blue-400" />
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="과목명으로 검색..."
        className="w-full text-base outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}
