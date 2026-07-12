"use client";

import { Printer } from "lucide-react";

// 전체 해설 페이지의 "인쇄 / PDF 저장" 버튼. 서버에서 PDF를 따로 조판하는 대신
// 브라우저 인쇄 기능을 쓴다 — 한글/이미지/레이아웃이 화면 그대로 나오고, 해설이
// 갱신되면 자동 반영된다. (인쇄 시 화면 요소들은 print:hidden으로 숨긴다.)
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 print:hidden dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
    >
      <Printer size={13} />
      인쇄 / PDF 저장
    </button>
  );
}
