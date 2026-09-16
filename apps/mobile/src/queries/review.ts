import {
  isEdgeError,
  isReviewHistoryList,
  type ReviewHistoryDetailResponse,
  type ReviewItemRequestRef,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useRef } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";

// 복습 세션(`/mypage/wrong-notes/[slug]/review/[sessionId]`, 설계서 §5 행 · §6.2 "복습·섞어풀기").
// review_sessions·review_session_items 는 RLS 정책이 하나도 없어 클라이언트가 직접 못 읽는다 —
// 조회(review-history)·채점(review-submit)·생성(review-create) 전부 Edge 를 지난다.
//
// 세션 항목은 제출 전·후 **메모리 캐시에만** 둔다(meta.persist:false — §6.5 (3), AGENTS.md
// 금지선). 채점된 correctChoice 가 디스크에 남으면 admin 전용 paper_answers 가 기기에 남는다.

export type ReviewSessionDetail = ReviewHistoryDetailResponse;
// 계약의 항목 타입(rules/review-session.ts ReviewResultItem). 앱은 응답 타입에서 끌어 쓴다 —
// 규칙 모듈을 직접 import 하지 않는다(@gongmoa/core/server 금지선).
export type ReviewItem = ReviewSessionDetail["items"][number];

export function reviewSessionKey(sessionId: string, userId: string | null) {
  return ["edge", "review-history", sessionId, userId ?? "anon"] as const;
}

// 400·403·404 는 다시 물어도 같은 답이다(없는 세션·남의 세션·잘못된 id). 5xx·네트워크만 한 번 더.
function retryEdge(failureCount: number, error: unknown): boolean {
  if (isEdgeError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

// 세션 상세. includeUnsubmitted 로 **채점 전 세션도** 답·정답·출처 없이 받아 이어 푼다
// (§6.7 #10 — 웹에서 만든 세션을 앱에서 이어 푸는 경로).
export function useReviewSession(sessionId: string, userId: string | null) {
  return useQuery<ReviewSessionDetail>({
    queryKey: reviewSessionKey(sessionId, userId),
    queryFn: async () => {
      const res = await callEdge("review-history", { sessionId, includeUnsubmitted: true });
      // 계약상 { sessionId } 요청에 목록이 오지는 않는다 — 타입을 좁히기 위한 가드.
      if (isReviewHistoryList(res)) throw new Error("세션을 찾을 수 없어요.");
      return res;
    },
    enabled: sessionId.length > 0 && !!userId,
    staleTime: STALE.edge,
    gcTime: 0,
    // 푸는 동안 세션 내용은 서버에서 바뀌지 않는다(채점하는 곳이 이 화면이다). 포커스·재접속
    // 재조회를 켜두면 방금 받은 채점 결과가 재조회 실패 한 번에 오류 화면으로 바뀐다.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// 서버가 세션 선점에 실패했을 때(이미 채점됨) 주는 문구 — §6.6 "복습 제출 중복",
// rules/review-session.ts. 앱은 이걸 오류로 그리지 않고 채점 뷰를 가져와 결과를 보여준다.
export const ALREADY_SUBMITTED_MESSAGE = "이미 채점된 세션이에요.";

// 채점 성공 후 무효화 지도(§6.3) — **queries/cbt.ts 의 INVALIDATE_AFTER_SUBMIT 와 같은 목록**에
// ['edge','review-history'] 를 더한 것이다. 한쪽만 고치면 웹 revalidatePath 와 어긋나므로 두
// 파일을 항상 함께 고칠 것(공용 모듈로 뽑는 건 cbt.ts 소유자와 같은 PR 에서).
const INVALIDATE_AFTER_SUBMIT = [
  "attempts",
  "wrong-notes",
  "status",
  "attendance",
  "membership",
  "due-summary",
  "diagnosis-eligibility",
  "round-counts",
  "paper",
  "today-study",
  "diagnosis-intro",
  "round-compare",
] as const;

async function submitOrFetchGraded(
  sessionId: string,
  answers: (number | null)[],
): Promise<ReviewSessionDetail> {
  try {
    const res = await callEdge("review-submit", { sessionId, answers });
    // 제출 응답은 상세와 같은 모양 + submitted(계약 ReviewHistoryDetailResponse).
    return { ...res, submitted: true };
  } catch (e) {
    // 이중 제출(다른 기기·연타)은 오류로 보여주지 않는다 — 채점 뷰를 가져와 결과를 그린다(§6.6).
    if (!isEdgeError(e) || e.message !== ALREADY_SUBMITTED_MESSAGE) throw e;
    const res = await callEdge("review-history", { sessionId });
    if (isReviewHistoryList(res)) throw e;
    return res;
  }
}

export function useSubmitReview(sessionId: string, userId: string | null) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Promise<ReviewSessionDetail> | null>(null);
  return useMutation({
    mutationFn: (answers: (number | null)[]) => {
      // single-flight(§6.6): 연타·재시도가 겹쳐도 요청은 하나.
      if (inFlight.current) return inFlight.current;
      const p = submitOrFetchGraded(sessionId, answers).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = p;
      return p;
    },
    onSuccess: (view) => {
      // 결과 화면은 이 캐시 한 곳에서 나온다(웹 setView 자리).
      queryClient.setQueryData(reviewSessionKey(sessionId, userId), view);
      if (!userId) return;
      for (const key of INVALIDATE_AFTER_SUBMIT) {
        void queryClient.invalidateQueries({ queryKey: ["me", userId, key] });
      }
      // 기록 목록·다른 세션은 다시 받아야 하지만, 방금 채점한 세션은 응답으로 이미 갱신했다 —
      // 그 키까지 무효화하면 결과 화면이 뜨자마자 같은 값을 한 번 더 부른다.
      void queryClient.invalidateQueries({
        queryKey: ["edge", "review-history"],
        predicate: (q) => q.queryKey[2] !== sessionId,
      });
    },
  });
}

// 결과 화면 "틀린 N문항만 다시 풀기"(웹 createReviewFromWrong) — items 는 서버가
// filterQuestionsAnsweredByUser 로 "내가 푼 적 있는 문항"만 남긴다(정답 유출 방지).
export function useCreateReviewFromWrong() {
  const requestId = useRef<string | null>(null);
  return useMutation({
    mutationFn: async (items: ReviewItemRequestRef[]) => {
      // 멱등 키(§6.6 "복습 세션 생성 연타"): 같은 시도(네트워크 재시도 포함)는 같은 UUID →
      // 언제나 같은 세션. 성공하면 버려 다음 누름이 새 세션을 만들게 한다.
      requestId.current ??= Crypto.randomUUID();
      const res = await callEdge("review-create", { items, requestId: requestId.current });
      requestId.current = null;
      return res.sessionId;
    },
  });
}
