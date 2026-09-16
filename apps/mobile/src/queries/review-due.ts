import {
  isEdgeError,
  isReviewDueSchedule,
  isReviewDueSession,
  isReviewDueSummary,
  type ReviewDueNudgeResponse,
  type ReviewDueSessionResponse,
  type ReviewDueSummaryResponse,
  type ReviewPrefsResponse,
  type SessionSchedule,
  srsDayIndex,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useRef } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { useAuth } from "../providers/auth-provider";

// "오늘의 복습"(간격 반복)과 복습 설정 — EF `review-due`(§6.7 #12)·`review-prefs`(#13)·
// `review-guessed`(#11). 규칙은 전부 서버에 있고 앱은 결과만 그린다(AGENTS.md 금지선:
// `srs_*` 는 앱이 계산·기록하지 않는다).
//
// **키는 ['me', userId, …] 인데 둘 다 메모리 전용(meta.persist:false)** 이다. 접두만 보면
// 디스크로 내려가는 등급이라 명시가 필요하다: `review-prefs` 응답에는 최종 멤버십 판정
// (premium)이 실려 있고(§6.5 "멤버십을 디스크에 남기지 말 것"), 요약은 Edge 결과라 오프라인
// 에서 되살릴 값이 아니다 — 어제 숫자를 오늘 "오늘 복습할 N문항"으로 보여주면 그 자리의 뜻이
// 통째로 거짓이 된다.

export const dueSummaryKey = (userId: string) => ["me", userId, "due-summary"] as const;
export const reviewPrefsKey = (userId: string) => ["me", userId, "review-prefs"] as const;

// 서버(EF review-due·review-prefs)가 무료 회원에게 돌려주는 잠금 문구. 앱은 이것을 오류로
// 그리지 않고 "잠긴 카드"로 읽는다(§8.3 — 게이트를 앱에서 실행하지 않고 결과를 그린다).
export const REVIEW_LOCKED_MESSAGE = "오늘의 복습(간격 반복)은 멤버십 기능이에요.";

function isLockedError(e: unknown): boolean {
  return isEdgeError(e) && e.status === 403;
}

// 400·403·404 는 다시 물어도 같은 답이다. 5xx·네트워크만 한 번 더(queries/review.ts 와 같은 규칙).
function retryEdge(failureCount: number, error: unknown): boolean {
  if (isEdgeError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

// 오늘의 복습 요약. **잠긴 상태는 오류가 아니라 `null`** 이다 — 무료 회원에게 붉은 오류 띠를
// 띄우면 "고장"으로 읽힌다. 프리미엄이 아닌 계정은 애초에 부르지 않지만(enabled), 조회 도중
// 멤버십이 끝난 경우까지 여기서 받는다.
//
// 승격(대기 풀 → 오늘 큐)은 서버가 세션 생성에서만 한다 — 이 조회는 읽기 전용이라 카드를
// 보기만 한 사람의 진도를 건드리지 않는다(§6.6 "SRS").
export function useDueSummary(enabled = true) {
  const { userId, isPremium } = useAuth();
  return useQuery<ReviewDueSummaryResponse | null>({
    queryKey: dueSummaryKey(userId ?? ""),
    queryFn: async () => {
      try {
        const res = await callEdge("review-due", { action: "summary" });
        return isReviewDueSummary(res) ? res : null;
      } catch (e) {
        if (isLockedError(e)) return null;
        throw e;
      }
    },
    enabled: enabled && !!userId && isPremium,
    staleTime: STALE.me,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// 설정 화면이 한 번에 읽는 것(하루 문항 수·과목 목록·접어둔 문항…). 쓰기 응답도 같은 모양이라
// 토글 직후 다시 부르지 않고 이 캐시를 갈아끼운다(웹 router.refresh() 자리).
export function useReviewPrefs(enabled = true) {
  const { userId } = useAuth();
  return useQuery<ReviewPrefsResponse>({
    queryKey: reviewPrefsKey(userId ?? ""),
    queryFn: () => callEdge("review-prefs", { action: "get" }),
    enabled: enabled && !!userId,
    staleTime: STALE.me,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// 설정을 바꾼 뒤 다시 세어야 하는 것들. 과목 보류·하루 상한·밀린 복습 정리·복구는 전부 오늘
// 큐와 예보를 바꾼다. 오답노트 집계(wrong-notes)는 복구가 접어둔 문항을 되살릴 때만 달라지지만,
// 목록 하나 더 무효화하는 값이 진실과 어긋난 화면보다 싸다.
const INVALIDATE_AFTER_PREFS = ["due-summary", "wrong-notes"] as const;

function useApplyPrefs() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return (next: ReviewPrefsResponse) => {
    if (!userId) return;
    // 쓰기 응답이 갱신된 설정을 그대로 싣고 온다(계약 §6.7 #13) — 그대로 캐시에 넣는다.
    //
    // 다만 `subjects`(과목별 예약·대기 수)는 action:"get" 에서만 온다. 없다고 통째로 버리면
    // 설정 시트의 과목 목록이 토글 한 번에 사라지므로 이미 있는 목록을 잇되, **보류 여부는
    // 새 `pausedSubjectIds` 로 다시 매긴다** — 옛 목록을 그대로 두면 방금 끈 과목의 스위치가
    // 도로 켜진 채로 남는다(그 행만 저장이 안 된 것처럼 보인다).
    queryClient.setQueryData<ReviewPrefsResponse>(reviewPrefsKey(userId), (prev) => {
      if (next.subjects) return next;
      const paused = new Set(next.pausedSubjectIds);
      return {
        ...next,
        subjects: prev?.subjects?.map((s) => ({ ...s, paused: paused.has(s.id) })),
      };
    });
    for (const key of INVALIDATE_AFTER_PREFS) {
      void queryClient.invalidateQueries({ queryKey: ["me", userId, key] });
    }
  };
}

// 하루에 풀 문항 수(10/20/40/60). 값 검증은 서버가 한다 — 앱에 목록을 복사하지 않는다.
export function useSetDailyLimit() {
  const apply = useApplyPrefs();
  return useMutation({
    mutationFn: (limit: number) => callEdge("review-prefs", { action: "daily-limit", limit }),
    onSuccess: apply,
  });
}

// 복습 과목 보류/재개. 재개면 서버가 밀린 문항의 `srs_due_at` 을 며칠에 걸쳐 다시 뿌린다.
export function useToggleSubjectPaused() {
  const apply = useApplyPrefs();
  return useMutation({
    mutationFn: ({ subjectId, paused }: { subjectId: string; paused: boolean }) =>
      callEdge("review-prefs", { action: "pause", subjectId, paused }),
    onSuccess: apply,
  });
}

// "밀린 복습 정리하기" — 연체분을 오늘부터 며칠에 걸쳐 다시 뿌린다.
export function useSpreadBacklog() {
  const apply = useApplyPrefs();
  return useMutation({
    mutationFn: () => callEdge("review-prefs", { action: "spread" }),
    onSuccess: apply,
  });
}

// 접어둔(여덟 번 넘게 무너진) 문항 되살리기.
export function useRestoreSuspended() {
  const apply = useApplyPrefs();
  return useMutation({
    mutationFn: () => callEdge("review-prefs", { action: "restore" }),
    onSuccess: apply,
  });
}

// 세션이 생기면 오늘 숫자가 즉시 달라진다 — 요약·FAB·홈 넛지가 같은 캐시를 본다.
function useInvalidateDue() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: dueSummaryKey(userId) });
  };
}

// 오늘의 복습 시작("복습 더하기"는 extra). 서버가 24시간 안에 두고 나온 세션을 먼저 보고
// 있으면 그것을 돌려준다(resumed) — 새로 만들면 기기에 저장해 둔 답이 안 붙는다.
//
// requestId 는 재시도 멱등 키(§6.6 "복습 세션 생성 연타"): 같은 시도는 같은 UUID 라 언제나
// 같은 세션이고, 성공하면 버려 다음 누름이 새 세션을 만들게 한다.
export function useStartDueSession(action: "create" | "extra" = "create") {
  const requestId = useRef<string | null>(null);
  const invalidate = useInvalidateDue();
  return useMutation<ReviewDueSessionResponse>({
    mutationFn: async () => {
      requestId.current ??= Crypto.randomUUID();
      const res = await callEdge("review-due", { action, requestId: requestId.current });
      if (!isReviewDueSession(res)) throw new Error("세션을 시작하지 못했어요.");
      requestId.current = null;
      return res;
    },
    onSuccess: invalidate,
  });
}

// 채점 결과 화면의 "다음 복습" 섹션. 무료 회원(403)·남의 세션·채점 전 세션은 전부 `null` 이고
// **오류를 그리지 않는다** — 스케줄을 못 불러와도 채점 결과는 멀쩡해야 한다(웹과 같은 판단).
export function useReviewSchedule(sessionId: string) {
  const { userId, isPremium } = useAuth();
  return useQuery<SessionSchedule | null>({
    queryKey: ["edge", "review-due", "schedule", sessionId, userId ?? "anon"],
    queryFn: async () => {
      try {
        const res = await callEdge("review-due", { action: "schedule", sessionId });
        return isReviewDueSchedule(res) ? res.schedule : null;
      } catch (e) {
        if (isLockedError(e)) return null;
        throw e;
      }
    },
    enabled: sessionId.length > 0 && !!userId && isPremium,
    staleTime: STALE.edge,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// 홈 유도 모달·FAB 이 쓰는 값. 훅이 아니라 함수인 이유: 둘 다 렌더 밖(팝업 슬라이더의 resolve,
// FAB 의 하루 한 번 조회)에서 부른다. 실패·잠금은 전부 null — 이 자리는 오류를 띄우지 않는다.
export async function fetchReviewNudge(): Promise<ReviewDueNudgeResponse | null> {
  try {
    const res = await callEdge("review-due", { action: "nudge" });
    // 넛지 응답만 `todayCount` + `subjects` 를 함께 갖는다(요약은 forecast 로 갈린다).
    if (isReviewDueSummary(res) || isReviewDueSession(res) || isReviewDueSchedule(res)) return null;
    return res;
  } catch {
    return null;
  }
}

// "찍었어요" — 맞힌 문항의 복습 스케줄만 되돌린다. 단방향·멱등이라 되돌리는 요청은 없고,
// 실패해도 화면을 되돌리지 않는다(웹과 같은 판단: 최악이 "간격이 그대로 유지된다"이고,
// 눌린 표시를 되돌리는 쪽이 더 혼란스럽다).
export function useMarkGuessed() {
  return useMutation({
    mutationFn: ({ sessionId, position }: { sessionId: string; position: number }) =>
      callEdge("review-guessed", { sessionId, position }),
  });
}

// FAB·홈 넛지가 함께 쓰는 "오늘 몇 문항" 조회. 키에 srsDayIndex 를 넣어 **하루 한 번만** 센다 —
// 요약 계산은 이미지 조회까지 도는 무거운 작업이라 화면을 옮길 때마다 부르면 안 된다(웹이
// sessionStorage 로 탭당 한 번으로 묶어 둔 자리).
//
// 접두가 `['me', userId, 'due-summary', …]` 인 것은 의도다: 채점 뒤 무효화 목록
// (queries/cbt.ts·review.ts 의 INVALIDATE_AFTER_SUBMIT 'due-summary')이 접두 일치로 이 키까지
// 함께 지운다 — 안 그러면 다 풀고도 버튼이 계속 따라다닌다(끝냈다는 감각을 망치는 가장 확실한
// 방법이다). 메모리 전용(§6.5).
export const dueNudgeKey = (userId: string, dayIndex: number) =>
  ["me", userId, "due-summary", "nudge", dayIndex] as const;

export function useReviewNudgeCount(): number {
  const { userId, isPremium } = useAuth();
  // 하루 경계는 복습 스케줄과 같은 KST 04:00(core srsDayIndex) — 자정 기준이면 새벽 3시에 푼
  // 사람에게 두 시간 뒤 같은 안내가 다시 뜬다.
  const day = srsDayIndex(new Date());
  const { data } = useQuery<ReviewDueNudgeResponse | null>({
    queryKey: dueNudgeKey(userId ?? "", day),
    queryFn: fetchReviewNudge,
    enabled: !!userId && isPremium,
    // 하루짜리 값이다. 포커스마다 다시 세지 않고, 채점 뒤 무효화로만 갱신된다.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    meta: { persist: false },
  });
  return data?.todayCount ?? 0;
}
