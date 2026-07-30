"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { createDueReviewSession, getReviewNudge } from "@/app/mypage/wrong-notes/actions";
import { srsDayIndex } from "@gongmoa/core";

// 스크롤을 내리면 따라오는 "복습 N" 버튼.
//
// 복습은 매일 와야 값이 나는 기능인데, 닿는 길이 오답노트 탭 안의 카드와 홈 모달
// (하루 한 번)뿐이었다. 모달을 닫으면 그날은 사실상 안 보인다. 그렇다고 전역 헤더에
// 항목을 늘리면 헤더가 지저분해지므로, 흔히 "맨 위로"가 놓이는 자리를 대신 쓴다 —
// 그 자리는 이미 "스크롤 중에 눈에 걸리지만 본문을 안 가리는" 위치로 검증돼 있다.
//
// 오늘 할 게 없으면 아예 안 뜬다. 0을 띄우는 배지는 알림이 아니라 잔소리다.

const CACHE_PREFIX = "review-fab:";

function cacheKey(): string {
  // 하루 경계는 복습 스케줄과 같은 KST 04:00.
  return `${CACHE_PREFIX}${srsDayIndex(new Date())}`;
}

// 세션이 채점되면 숫자가 즉시 달라진다. 캐시를 안 지우면 다 풀고도 버튼이 계속
// 따라다닌다 — 끝냈다는 감각을 망치는 가장 확실한 방법이다.
export function clearReviewFabCache(): void {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // 무시: 캐시를 못 지워도 다음 방문에 다시 센다.
  }
}

function readCache(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey());
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeCache(count: number): void {
  try {
    window.sessionStorage.setItem(cacheKey(), String(count));
  } catch {
    // 무시: 캐시가 없으면 탭을 새로 열 때마다 한 번 더 셀 뿐이다.
  }
}

// 이만큼 내려야 뜬다. 첫 화면에서 바로 튀어나오면 본문을 읽기도 전에 방해가 된다.
const SHOW_AFTER_PX = 400;

export function ReviewFab() {
  const router = useRouter();
  const pathname = usePathname();
  // 캐시가 있으면 그 값으로 시작한다. 첫 렌더에서는 scrolled가 false라 아무것도
  // 그리지 않으므로 서버 렌더 결과와 어긋나지 않는다.
  const [count, setCount] = useState<number | null>(readCache);
  const [scrolled, setScrolled] = useState(false);
  const [pending, start] = useTransition();

  // 풀이 화면(CBT·섞어풀기·복습)은 자체 UI로 화면을 꽉 쓰는 몰입형이라 띄우지
  // 않는다. 판별 규칙은 site-header-gate.tsx와 같다.
  const immersive =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");

  useEffect(() => {
    if (immersive || readCache() != null) return;

    // 요약 계산은 이미지 조회까지 도는 무거운 작업이라 탭당 한 번만 부른다
    // (홈 유도 모달이 하루 한 번만 부르는 것과 같은 이유).
    let alive = true;
    getReviewNudge()
      .then((res) => {
        if (!alive) return;
        writeCache(res.todayCount);
        setCount(res.todayCount);
      })
      .catch(() => {
        // 조회 실패는 조용히 넘긴다. 이 버튼이 에러를 띄울 자리는 아니다.
      });
    return () => {
      alive = false;
    };
  }, [immersive]);

  useEffect(() => {
    if (immersive) return;
    function onScroll() {
      setScrolled(window.scrollY > SHOW_AFTER_PX);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [immersive]);

  if (immersive || !count || count <= 0 || !scrolled) return null;

  function startReview() {
    if (pending) return;
    start(async () => {
      const res = await createDueReviewSession();
      if (res.error || !res.sessionId) {
        // 실패하면 오답노트로 보낸다. 거기 카드가 이유(멤버십·오늘치 없음)를 말해준다.
        router.push("/mypage#wrong-notes");
        return;
      }
      clearReviewFabCache();
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  return (
    <button
      type="button"
      onClick={startReview}
      disabled={pending}
      aria-label={`오늘 복습 ${count}문항 풀러 가기`}
      className="animate-modal-fade-in fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-blue-600 py-3 pl-4 pr-4 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 disabled:opacity-70"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <CalendarCheck size={17} />
      <span className="tabular-nums">복습 {count}</span>
    </button>
  );
}
