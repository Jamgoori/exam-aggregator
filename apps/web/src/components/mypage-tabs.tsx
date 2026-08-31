"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

// 순서는 쓰는 빈도순(오답노트 → 시험기록 → 출석체크 → 즐겨찾기).
// 라벨은 전부 네 글자로 맞춰 뒀다 — 좁은 폰 화면에서도 네 개가 한 줄에 들어가야
// 가로 스크롤 없이 탭 전체가 보인다("내 시험 기록"이 길어서 줄이 넘어갔었다).
const TABS = [
  { key: "wrong-notes", label: "오답노트" },
  { key: "history", label: "시험기록" },
  { key: "attendance", label: "출석체크" },
  { key: "bookmarks", label: "즐겨찾기" },
] as const;

export type MyPageTabKey = (typeof TABS)[number]["key"];

const TAB_KEYS: readonly string[] = TABS.map((t) => t.key);

function toTabKey(value: string | null | undefined): MyPageTabKey | null {
  return TAB_KEYS.includes(value ?? "") ? (value as MyPageTabKey) : null;
}

// 서버에서 두 탭의 데이터를 이미 한 번에 같이 받아와 두 트리를 전부 렌더링해
// 넘겨받으므로, 탭 전환은 서버 왕복 없이 이 안에서 보이는 것만 바꾼다(예전엔
// 탭 버튼이 /mypage?tab=... 링크라 이미 갖고 있는 데이터를 매번 새로 요청했다).
//
// 그런데 열린 탭을 state 로만 들고 있으면 계정 메뉴의 "내 시험 기록"·"즐겨찾기"
// (/mypage?tab=... 링크)가 마이페이지 안에서는 먹지 않는다 — 경로가 /mypage 그대로라
// 이 컴포넌트가 다시 마운트되지 않아서, 주소창의 tab 만 바뀌고 화면은 그대로 남는다.
// 그래서 진짜 정본은 URL 의 ?tab= 으로 두고, state 는 그 값을 따라간다.
export function MyPageTabs({
  initialTab,
  attendance,
  bookmarks,
  history,
  wrongNotes,
}: {
  initialTab: MyPageTabKey;
  // null 이면 출석체크 탭 자체를 그리지 않는다(전면 무료 이벤트 동안 기능이 닫혀
  // 있다 — core 의 isAttendanceOpen). 탭만 남기고 안을 비우면 눌러도 아무것도 없는
  // 칸이 되고, 라벨을 지우는 것보다 그게 더 고장처럼 보인다.
  attendance: ReactNode | null;
  bookmarks: ReactNode;
  history: ReactNode;
  wrongNotes: ReactNode;
}) {
  // 지금 실제로 그릴 탭들. 출석체크가 닫혀 있으면(attendance === null) 목록에서 뺀다.
  const tabs = TABS.filter((t) => t.key !== "attendance" || attendance !== null);
  const searchParams = useSearchParams();
  // 주소에 tab 이 없으면(그냥 /mypage) 서버가 고른 기본 탭을 쓴다. 닫힌 탭을 가리키는
  // 주소(?tab=attendance)로 들어온 경우에도 서버가 이미 기본 탭으로 떨어뜨려 보내지만,
  // 클라이언트에서 주소만 바뀌는 경로가 있어 여기서도 한 번 더 거른다.
  const urlTab = toTabKey(searchParams.get("tab"));
  const tabFromUrl =
    urlTab && tabs.some((t) => t.key === urlTab) ? urlTab : initialTab;

  const [activeTab, setActiveTab] = useState<MyPageTabKey>(tabFromUrl);
  // 렌더 중에 이전 값과 비교해 맞춘다(리액트가 권장하는 "prop 이 바뀌면 state 를
  // 맞춘다" 패턴 — search-input.tsx 와 같은 방식). useEffect 로 하면 한 프레임 늦게
  // 바뀌어서, 메뉴에서 넘어온 순간 이전 탭이 한 번 번쩍인다.
  const [prevTabFromUrl, setPrevTabFromUrl] = useState(tabFromUrl);
  if (prevTabFromUrl !== tabFromUrl) {
    setPrevTabFromUrl(tabFromUrl);
    setActiveTab(tabFromUrl);
  }

  // 탭 버튼도 주소를 같이 고쳐둔다 — 새로고침하거나 주소를 복사해 열어도 보고 있던
  // 탭 그대로 열린다. 서버를 다시 부를 일이 없으므로 라우터 대신 history API 를
  // 쓴다(home-exam-browser.tsx 와 같은 이유).
  //
  // prevTabFromUrl 은 건드리지 않는다 — 그 값은 "마지막으로 본 URL 의 tab" 이지
  // "마지막으로 고른 탭" 이 아니다. 여기서 같이 밀어두면, 주소만 바뀌고
  // useSearchParams 가 따라오지 않는 경우에 방금 고른 탭이 도로 튕겨 나간다.
  function selectTab(key: MyPageTabKey) {
    setActiveTab(key);
    const usp = new URLSearchParams(searchParams.toString());
    usp.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${usp}`);
  }

  return (
    <>
      {/* 모바일에서는 칸을 같은 너비로 나눠 한 줄에 넣고(줄바꿈·가로 스크롤 없음),
          넓은 화면에서는 글자 길이만큼만 차지하는 알약 모양으로 돌아간다. */}
      <div className="flex gap-1 border-b border-zinc-200 pb-3 sm:gap-2 dark:border-zinc-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTab(t.key)}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={`min-w-0 flex-1 rounded-full px-2 py-1.5 text-xs font-medium whitespace-nowrap sm:flex-none sm:px-4 sm:text-sm ${
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
      {attendance !== null && (
        <div className={activeTab === "attendance" ? "contents" : "hidden"}>
          {attendance}
        </div>
      )}
      <div className={activeTab === "bookmarks" ? "contents" : "hidden"}>
        {bookmarks}
      </div>
    </>
  );
}
