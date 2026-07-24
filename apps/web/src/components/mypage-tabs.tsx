"use client";

import { useState, type ReactNode } from "react";

const TABS = [
  { key: "wrong-notes", label: "오답노트" },
  { key: "history", label: "내 시험 기록" },
  { key: "bookmarks", label: "즐겨찾기" },
] as const;

export type MyPageTabKey = (typeof TABS)[number]["key"];

// 서버에서 두 탭의 데이터를 이미 한 번에 같이 받아와 두 트리를 전부 렌더링해
// 넘겨받으므로, 탭 전환은 서버 왕복 없이 이 안에서 보이는 것만 바꾼다(예전엔
// 탭 버튼이 /mypage?tab=... 링크라 이미 갖고 있는 데이터를 매번 새로 요청했다).
export function MyPageTabs({
  initialTab,
  bookmarks,
  history,
  wrongNotes,
}: {
  initialTab: MyPageTabKey;
  bookmarks: ReactNode;
  history: ReactNode;
  wrongNotes: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<MyPageTabKey>(initialTab);

  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              activeTab === t.key
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={activeTab === "wrong-notes" ? "contents" : "hidden"}>
        {wrongNotes}
      </div>
      <div className={activeTab === "history" ? "contents" : "hidden"}>
        {history}
      </div>
      <div className={activeTab === "bookmarks" ? "contents" : "hidden"}>
        {bookmarks}
      </div>
    </>
  );
}
