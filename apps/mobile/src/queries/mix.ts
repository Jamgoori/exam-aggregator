import {
  isEdgeError,
  isMixCreateHub,
  isMixCreateSession,
  isReviewHistoryList,
  kstDayKey,
  labelMixSessions,
  type MixCreateHubResponse,
  type MixCreateOverviewResponse,
  type MixCreateResponse,
  type MixCreateSessionResponse,
  type MixYearRange,
} from "@gongmoa/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useRef } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { useAuth } from "../providers/auth-provider";
import type { MixSessionCard } from "../components/mix/mix-session-list";

// 기출 섞어풀기 — EF `mix-create`(§6.7 #14). 허브(`/mix`)·시작 화면(`/subjects/[slug]/mix`)·
// 세션 생성·재도전이 전부 이 함수 하나를 지난다. 멤버십 게이트는 없다(웹에서도 무료 — §8.3).
//
// **hub·overview 는 로그인 없이도 부른다** — EF 가 그 둘만 인증 앞에 두기 때문이고(공개 통계),
// 그래서 화면도 웹처럼 게스트에게 목록·시작 패널을 그대로 그린 뒤 "시작"에서만 로그인으로
// 보낸다. 반대로 아래 useMixSessions·useRecentMixSessions 는 본인 기록이라 로그인 전에는 조회
// 자체를 걸지 않는다 — 게스트에게 401 이 돌아오면 handleEdgeError 가 로컬 signOut + 캐시
// 초기화 + /login 이동을 하는데, 애초에 세션이 없는 사람에게는 엉뚱한 반응이다.
//
// hub·overview 는 과목 수십 개 × 문제지 수백 장을 훑는 계산이라 Edge 안에서 60초 메모를 두고
// 있다. 앱에서도 카탈로그 등급(5분)으로 잡아 탭을 오갈 때마다 다시 세지 않게 한다. 다만 ['edge',…]
// 접두라 디스크에는 남지 않는다(§6.5).

export const mixHubKey = ["edge", "mix-create", "hub"] as const;
export const mixOverviewKey = (slug: string) => ["edge", "mix-create", "overview", slug] as const;

function retryEdge(failureCount: number, error: unknown): boolean {
  if (isEdgeError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

// hub·overview 전용 호출. **401 은 상태를 떼어 평범한 오류로 낮춘다** — 이 둘은 인증 앞에 있어
// 401 이 올 자리가 아니고, 그래도 온다면 배포된 Edge 가 아직 옛 판(hub 까지 `requireUser` 뒤)
// 이라는 뜻이다. 앱 배포와 Edge 재배포는 별개 절차라 그 창이 실제로 생긴다.
// 상태를 단 채로 흘리면 화면의 QueryState 가 handleEdgeError 에 넘기고, 그쪽은 401 을 "세션이
// 죽었다"로 받아 로컬 signOut + 캐시 초기화(문항 이미지 디스크 캐시까지) + /login 이동을 한다 —
// 지울 세션이 없는 게스트에게는 보던 화면만 빼앗는 반응이다(패널의 begin() 이 게스트의 create
// 호출을 아예 막는 것과 같은 이유). 서버 문구는 그대로 두므로 자리에는 안내만 남는다.
async function callPublicMix(
  body: { action: "hub" } | { action: "overview"; subjectSlug: string },
): Promise<MixCreateResponse> {
  try {
    return await callEdge("mix-create", body);
  } catch (e) {
    throw isEdgeError(e) && e.status === 401 ? new Error(e.message) : e;
  }
}

// 허브의 급수 탭·과목 목록. 단위(unit)는 집계 RPC 가 없는 환경에서 문제지 수로 떨어진다.
export function useMixHub() {
  return useQuery<MixCreateHubResponse>({
    queryKey: mixHubKey,
    queryFn: async () => {
      const res = await callPublicMix({ action: "hub" });
      if (!isMixCreateHub(res)) throw new Error("과목 목록을 불러오지 못했어요.");
      return res;
    },
    staleTime: STALE.catalog,
    retry: retryEdge,
  });
}

// 시작 화면 요약(급수·연도 교차 문항 수). 없는 과목이면 404 → 화면이 "없는 과목" 자리를 그린다.
export function useMixOverview(slug: string) {
  return useQuery<MixCreateOverviewResponse>({
    queryKey: mixOverviewKey(slug),
    queryFn: async () => {
      const res = await callPublicMix({ action: "overview", subjectSlug: slug });
      if (isMixCreateHub(res) || isMixCreateSession(res)) throw new Error("과목을 찾을 수 없어요.");
      return res;
    },
    enabled: slug.length > 0,
    staleTime: STALE.catalog,
    retry: retryEdge,
  });
}

export type MixCreateInput = {
  subjectSlug: string;
  levels: string[];
  yearRange: MixYearRange;
  limit: number;
};

// 세션 생성. levels·yearRange·limit 은 서버가 다시 정리한다(풀에 실제로 있는 급수만, 자료가
// 있는 연도 구간 안으로, clampMixLimit) — 앱의 화면 상태를 그대로 믿지 않는다.
//
// requestId 는 멱등 키(§6.6 "복습 세션 생성 연타"): 같은 시도(네트워크 재시도 포함)는 같은
// UUID 라 언제나 같은 세션이고, 성공하면 버려 다음 누름이 새 세션을 만들게 한다.
export function useCreateMixSession() {
  const requestId = useRef<string | null>(null);
  return useMutation<MixCreateSessionResponse, Error, MixCreateInput>({
    mutationFn: async ({ subjectSlug, levels, yearRange, limit }) => {
      requestId.current ??= Crypto.randomUUID();
      const res = await callEdge("mix-create", {
        action: "create",
        subjectSlug,
        levels,
        yearRange: { from: yearRange.from, to: yearRange.to },
        limit,
        requestId: requestId.current,
      });
      if (!isMixCreateSession(res)) throw new Error("섞어풀기를 시작하지 못했어요.");
      requestId.current = null;
      return res;
    },
  });
}

// 기록·결과 화면의 "틀린 N문항만 다시 풀기". **문항 목록은 보내지 않는다** — 서버가 세션에서
// 직접 읽는다(클라이언트가 (문제지, 문항)을 보내면 채점 응답의 공식 정답이 새어 나가고,
// 섞어풀기 세션은 dedup 대표 문제지 id 로 저장돼 "내가 푼 적 있는 문항" 필터에도 걸린다 —
// Phase 2 가 이 버튼을 미룬 이유가 정확히 이것이다).
export function useCreateMixRetry() {
  const requestId = useRef<string | null>(null);
  return useMutation<MixCreateSessionResponse, Error, string>({
    mutationFn: async (sessionId) => {
      requestId.current ??= Crypto.randomUUID();
      const res = await callEdge("mix-create", {
        action: "retry",
        sessionId,
        requestId: requestId.current,
      });
      if (!isMixCreateSession(res)) throw new Error("다시 풀기를 시작하지 못했어요.");
      requestId.current = null;
      return res;
    },
  });
}

// ── 섞어풀기 기록 목록 (EF review-history) ───────────────────────────────────
// 목록은 mix-create 가 아니라 `review-history` 가 준다(§6.7 #10). `scope:"mix"` + `subjectSlug`
// 로 물어야 각 항목에 title·wrongCount·resolvedCount 가 함께 실린다 — 극복 판정이 그 과목의
// dedup 대표 매핑을 쓰기 때문에 과목을 특정해야 계산할 수 있다(Phase 2 가 이 세 값이 없어
// 앱 MixSessionList 를 미뤘다).

export const mixSessionsKey = (userId: string, subjectSlug: string) =>
  ["me", userId, "wrong-notes", "mix-sessions", subjectSlug] as const;
export const recentMixSessionsKey = (userId: string) =>
  ["me", userId, "wrong-notes", "mix-recent"] as const;

// 과목별 섞어풀기 기록(최신순). 카드에 필요한 세 값이 없는 항목은 그리지 않는다 — 서버가
// 과목을 못 찾았거나(과목 삭제) 계산을 건너뛴 경우라, 0으로 채우면 "전부 맞혔어요"라는 거짓이
// 된다.
export function useMixSessions(subjectSlug: string) {
  const { userId } = useAuth();
  return useQuery<MixSessionCard[]>({
    queryKey: mixSessionsKey(userId ?? "", subjectSlug),
    queryFn: async () => {
      const res = await callEdge("review-history", { scope: "mix", subjectSlug, limit: 50 });
      if (!isReviewHistoryList(res)) return [];
      return res.sessions.flatMap((s) =>
        s.title == null || s.wrongCount == null || s.resolvedCount == null
          ? []
          : [
              {
                id: s.sessionId,
                title: s.title,
                createdAt: s.createdAt,
                score: s.score ?? 0,
                total: s.total,
                wrongCount: s.wrongCount,
                resolvedCount: s.resolvedCount,
              },
            ],
      );
    },
    enabled: subjectSlug.length > 0 && !!userId,
    staleTime: STALE.me,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// 허브의 "최근 섞어풀기" 줄. 과목을 가리지 않으므로 극복 진행률은 오지 않는다(그 계산은 과목별
// 출제 풀 조회가 붙어 허브에는 무겁다 — 웹 listRecentMixSessions 와 같은 판단). 제목의 같은 날
// 순번("(2)")은 그날 만든 세션 전체를 알아야 매길 수 있어, 화면에 보일 개수보다 넉넉히 받아
// core labelMixSessions 로 이름을 붙인 뒤 자른다(웹 toMixSessionBriefs 와 같은 함수).
export type MixSessionBriefRow = {
  id: string;
  title: string;
  createdAt: string;
  score: number;
  total: number;
  subjectSlug: string;
  subjectName: string;
};

export function useRecentMixSessions(limit = 5) {
  const { userId } = useAuth();
  return useQuery<MixSessionBriefRow[]>({
    queryKey: recentMixSessionsKey(userId ?? ""),
    queryFn: async () => {
      const res = await callEdge("review-history", { scope: "mix", limit: 100 });
      if (!isReviewHistoryList(res)) return [];
      // 과목이 지워졌으면(세션은 남는다 — subject_id 는 on delete set null) 링크를 만들 수 없다.
      const usable = res.sessions.flatMap((s) =>
        s.subjectSlug && s.subjectName
          ? [{ ...s, subjectSlug: s.subjectSlug, subjectName: s.subjectName }]
          : [],
      );
      const titles = labelMixSessions(
        usable.map((s) => ({ id: s.sessionId, createdAt: s.createdAt })),
        kstDayKey,
      );
      return usable.slice(0, limit).map((s) => ({
        id: s.sessionId,
        title: titles.get(s.sessionId) ?? "섞어풀기",
        createdAt: s.createdAt,
        score: s.score ?? 0,
        total: s.total,
        subjectSlug: s.subjectSlug,
        subjectName: s.subjectName,
      }));
    },
    enabled: !!userId,
    staleTime: STALE.me,
    retry: retryEdge,
    meta: { persist: false },
  });
}
