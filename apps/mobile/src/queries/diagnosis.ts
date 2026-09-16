import {
  currentCycleStartDate,
  isEdgeError,
  type AiDiagnosisReport,
  type DiagnosisAggregateResponse,
  type DiagnosisCollectResponse,
  type DiagnosisConceptCoaching,
  type DiagnosisConceptSelection,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { diagnosisEligibilityKey, weeklyDiagnosisKey } from "./mypage";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// AI 약점 진단 대시보드(`/mypage/diagnosis`, 설계서 §5 행 · §6.7 #21 · §12 Phase 4).
//
// 화면이 쓰는 값은 두 갈래로 오고, **섞지 않는다**:
//   1) 무AI 집계(막대그래프·과목 탭·선택창·자격) → EF `diagnosis-aggregate`
//   2) 리포트 본문(맞춤 극복법)                  → `ai_diagnoses` 를 RLS(select own)로 직접
// 2를 Edge 계약에 싣지 않은 이유가 그대로 여기서의 규칙이다: 진단 본문은 메모리 쿼리캐시에만
// 둔다(앱 AGENTS.md 금지선 · §6.5 (5)). 아래 report 쿼리의 `meta.persist:false` 가 빠지면
// 극복법 전문이 기기 디스크에 남는다.
//
// 기다리는 동안 두드리는 곳은 세 번째 갈래다: EF `diagnosis-collect`. 그 함수가 내 배치가
// 끝났는지 보고 **끝났으면 그 자리에서 결과를 수거해** `ai_diagnoses.report` 를 채운다.
// 예전에는 제출·수거를 모두 웹 크론이 시간당 한 번 해서 앱은 행이 채워지기를 기다리는 것밖에
// 할 수 없었고(최악 "제출 대기 1시간 + 배치 + 수거 대기 1시간"), 그래서 여기 폴링도
// `ai_diagnoses` 를 다시 읽는 것뿐이었다. 지금은 요청이 그 자리에서 배치를 내고 이 폴링이
// 수거를 부르므로, 남는 대기는 배치 자체의 처리 시간뿐이다(대부분 1시간 안, 최대 24시간).
//
// 규칙은 전부 서버에 있다 — 자격·주기 잠금·개념 상한(10)은 core `rules/diagnosis-request.ts`
// 가 판정하고 앱은 결과를 그릴 뿐이다. 여기에 문턱 숫자를 복사하지 말 것.

// 400·403 은 다시 물어도 같은 답이다(멤버십 잠금·잘못된 입력). 5xx·네트워크만 한 번 더.
// 타임아웃(code "aborted")도 다시 묻지 않는다 — 아래 집계는 한 번이 최대 60왕복이라, 오래
// 걸려 끊긴 요청을 자동으로 한 번 더 보내면 서버가 같은 계정의 같은 계산을 두 배로 돌고
// 사용자는 두 배로 기다린 끝에 같은 오류를 본다. 재시도는 InlineAlert 의 버튼으로 사람이 한다.
function retryEdge(failureCount: number, error: unknown): boolean {
  if (isEdgeError(error) && (error.code === "aborted" || (error.status >= 400 && error.status < 500))) {
    return false;
  }
  return failureCount < 1;
}

// ── 1) 집계(EF `diagnosis-aggregate`) ────────────────────────────────────────

// 기간 칩마다 다른 데이터라 키에 칩을 넣는다(웹은 `?range=` 서버 왕복으로 같은 일을 한다).
export const diagnosisBoardKey = (userId: string, rangeKey: string) =>
  ["edge", "diagnosis-aggregate", userId, rangeKey] as const;

// 이 조회는 **비싸다**: 계정 전체 응시 이력 → 기간 안 응답 → 문항·해설·개념 → 개념별 기출 수로
// 최대 60왕복이고, 웹이 그 위에 덮어 둔 `'use cache'`(30초)에 해당하는 계층이 Edge 에는 없다
// (docs/agents/edge-core-bundle.md "Edge 에는 캐시 계층이 없다").
//
// 그래서 화면 진입·기간 칩 전환·당겨서 새로고침에만 돈다:
//   · staleTime 30초 — 웹 `'use cache'` 와 같은 폭.
//   · 포커스·재접속 재조회 끔 — 앱을 몇 번 오가는 것만으로 60왕복이 반복되면 안 된다.
//   · gcTime 도 30초 — 기간 칩마다 쿼리 키가 갈리므로 gcTime 0 이면 "7일 → 30일 → 7일"이
//     세 번의 60왕복이 된다(웹은 같은 왕복을 `'use cache'` 30초가 받아 준다). 화면을 떠난
//     뒤에도 최대 30초만 메모리에 남고, 그 사본은 어차피 신선한(stale 하지 않은) 값이다.
//     디스크에는 절대 안 남는다(`meta.persist:false` + `['edge', …]` 접두, §6.5).
//   · 타임아웃 60초 — 기본 20초(§6.9)는 이 호출에 안 맞는다. "전체 기간" 칩 + 응시가 많은
//     계정이면 계정 전체 이력을 훑는 데 그보다 오래 걸리고, 그때 20초에서 끊으면 무거운
//     계정일수록 화면이 영영 안 뜬다(CBT 제출이 60초를 받은 것과 같은 이유의 예외다).
// **리포트 대기 폴링에 이 쿼리를 쓰지 말 것** — 폴링은 아래 `useDiagnosisReport` 다(인덱스 한 방).
export function useDiagnosisBoard(rangeKey: string, days: number | null, enabled: boolean) {
  const { userId } = useAuth();
  return useQuery<DiagnosisAggregateResponse>({
    queryKey: diagnosisBoardKey(userId ?? "", rangeKey),
    queryFn: () => callEdge("diagnosis-aggregate", { days }, { timeoutMs: 60_000 }),
    enabled: enabled && !!userId,
    staleTime: STALE.me,
    gcTime: STALE.me,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryEdge,
    meta: { persist: false },
  });
}

// ── 2) 리포트(`ai_diagnoses` RLS 직접 읽기) ──────────────────────────────────

export const diagnosisReportKey = (userId: string) => ["me", userId, "diagnosis-report"] as const;

// 이번 주기 요청 행. 화면은 "요청 → 대기 → 완료" 세 상태를 이 값 하나로 가른다.
export type DiagnosisCycleRow = {
  // KST YYYY-MM-DD. 주기 잠금의 축이자 `nextDiagnosisDate` 의 입력.
  date: string;
  // ready = report 가 채워졌다 · pending = 요청 행만 있다(배치가 도는 중이거나, 아직 제출 전).
  status: "ready" | "pending";
  // 요청 시각(ISO). 대기 카드가 "N분 지났어요"를 잰다.
  requestedAt: string;
  // 요청할 때 박아 둔 개념 수. `ai_diagnosis_batches` 는 앱이 못 읽으므로(정책 0개, revoke all)
  // "몇 개를 만들고 있는지"는 집계의 `generating` 이 오기 전까지 이 값으로 그린다.
  conceptCount: number;
};

export type DiagnosisReportView = {
  cycle: DiagnosisCycleRow | null;
  // 화면에 그릴 맞춤 극복법. 이번 주기 것이 없으면 지난 완료 리포트에서 가져온다.
  coaching: DiagnosisConceptCoaching[];
  // 그 극복법을 받은 날. 언제 것인지 밝히지 않으면 오늘 푼 문제까지 반영된 줄 안다.
  coachingDate: string | null;
};

type DiagnosisRow = {
  diagnosis_date: string;
  report: AiDiagnosisReport | null;
  requested_at: string;
  selected_concepts: DiagnosisConceptSelection[] | null;
};

// 웹 `page.tsx` 와 **같은 순서**: 이번 주기 행을 보고, 거기에 극복법이 없으면 지난 완료 리포트의
// conceptCoaching 을 가져온다(주기가 풀린 뒤에도 지난 진단은 계속 보인다 — 그 사이 화면이 비면
// 지난주에 받은 것이 사라진 줄 안다).
async function fetchDiagnosisReport(userId: string): Promise<DiagnosisReportView> {
  // core `getWeeklyDiagnosis`(rules/diagnosis-request.ts)와 같은 조회다. 그 함수는 서버 진입점
  // (@gongmoa/core/server)에 있어 앱이 import 할 수 없으므로(AGENTS.md 금지선) 같은 where 를
  // 여기서 쓰되, 주기 경계만은 core 상수(currentCycleStartDate)를 그대로 부른다 — 경계가 갈리면
  // 서버는 "이번 주기"라는데 앱은 아니라고 하는 화면이 된다.
  const { data, error } = await supabase
    .from("ai_diagnoses")
    .select("diagnosis_date, report, requested_at, selected_concepts")
    .eq("user_id", userId)
    .gte("diagnosis_date", currentCycleStartDate())
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = (data as DiagnosisRow | null) ?? null;
  const cycle: DiagnosisCycleRow | null = row
    ? {
        date: row.diagnosis_date,
        status: row.report ? "ready" : "pending",
        requestedAt: row.requested_at,
        conceptCount: row.selected_concepts?.length ?? 0,
      }
    : null;

  let coaching = row?.report?.conceptCoaching ?? null;
  let coachingDate = coaching && coaching.length > 0 ? row!.diagnosis_date : null;
  if (!coaching || coaching.length === 0) {
    const { data: latest } = await supabase
      .from("ai_diagnoses")
      .select("diagnosis_date, report")
      .eq("user_id", userId)
      .not("report", "is", null)
      .order("diagnosis_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prev = latest as { diagnosis_date: string; report: AiDiagnosisReport | null } | null;
    coaching = prev?.report?.conceptCoaching ?? null;
    coachingDate = (coaching ?? []).length > 0 ? (prev?.diagnosis_date ?? null) : null;
  }

  return { cycle, coaching: coaching ?? [], coachingDate };
}

export const diagnosisCollectKey = (userId: string) => ["edge", "diagnosis-collect", userId] as const;

// 수거를 다시 부르는 간격. 요청 직후 얼마간은 촘촘히 묻는다 — 개념 한두 개짜리 배치는 몇 분
// 만에 끝나기도 해서, 그때 30초 간격이면 다 된 리포트를 눈앞에 두고 기다리게 된다.
const POLL_FAST_MS = 15_000;
const POLL_FAST_WINDOW_MS = 2 * 60_000;
const POLL_SLOW_MS = 30_000;
// **바닥은 언제나 서버가 정한다.** 응답의 `recheckSeconds`(지금 20초)보다 이르게 부르면 서버는
// Anthropic 을 두드리지 않고 pending 만 돌려준다 — 그 왕복은 통째로 버리는 것이라, 위 간격이
// 그보다 짧으면 서버 값으로 늘린다(아래 Math.max). 앱에 20 을 상수로 박지 않는 이유가 같은
// 규칙이다: 요금과 레이트리밋이 걸린 판정은 서버 한 곳에만 둔다.

// 폴링을 접기까지의 시간. 배치는 대부분 1시간 안에 끝나지만 보장은 24시간이라, 끝까지 붙잡는
// 폴링은 배터리만 먹는다 — 여기서 멈추고 "앱을 닫아도 계속 만들어진다 · 당겨서 새로고침"으로
// 넘긴다. 상한은 **화면에 머문 시간** 기준이라 나갔다 들어오면 다시 10분이 주어진다(어제 넣어
// 둔 요청을 오늘 열었을 때 한 번도 안 묻고 끝나면 안 된다).
const POLL_STOP_MS = 10 * 60_000;

// 수거가 실패로 닫혔는데 사유가 비어 있을 때의 문구. 서버는 사유를 실어 주지만(개념별 실패
// 목록·"배치를 찾을 수 없어요." 등) 없는 응답에 스피너를 계속 돌리지 않으려는 마지막 자리다.
const COLLECT_FAILED_FALLBACK = "극복법을 만들지 못했어요.";

export type DiagnosisReportState = {
  query: UseQueryResult<DiagnosisReportView>;
  // 지금도 수거를 다시 부르고 있는가. false 면 상한에 걸려 접었거나(화면이 보이는 동안만 재는
  // 값이다) 실패로 닫힌 것이고, 대기 카드가 그때 안내를 바꾼다.
  polling: boolean;
  // 수거가 본 이번 배치(제출 시각·개념 수). 집계 응답의 `generating` 은 화면에 들어온 뒤 다시
  // 받지 않으므로(60왕복) 요청 직후에는 비어 있다 — 이 값이 그 자리를 메운다.
  batch: { requestedAt: string; conceptCount: number } | null;
  // 이 주기 배치가 실패로 닫혔을 때의 사유(그대로 화면에 올린다). 아니면 null.
  failure: string | null;
  // 요청 행은 있는데 **배치가 아직 나가지 않았다**(수거가 pending 인데 제출 시각이 없다).
  // 제출이 막혔다는 뜻이다 — 키 미설정·제출 오류·만들 게 없음. 여기서 스피너를 계속 돌리면
  // 영원히 안 오는 것을 기다리게 되므로 화면은 다른 카드를 그린다.
  awaitingSubmit: boolean;
  // 당겨서 새로고침. 리포트 재조회 + (기다리는 중이면) 수거 한 번 — 폴링을 접은 뒤에는 이것이
  // 유일한 길이라 `enabled` 와 무관하게 도는 refetch 를 쓴다.
  refresh: () => void;
};

// 리포트 조회 + 대기 폴링. 폴링은 **이 화면이 포커스를 가진 동안, 포그라운드에서만** 돈다:
//   · `useIsFocused()` 가 false 면 간격을 끈다 → 화면을 떠나면 멈춘다.
//   · TanStack 의 `refetchIntervalInBackground` 기본값이 false 라, 앱이 백그라운드로 내려가면
//     (focusManager ← AppState, lib/query-client.ts) 간격이 스스로 쉰다.
//   · 오프라인이면 `onlineManager` 가 쿼리를 멈춰 세운다(networkMode 기본값).
//
// 리포트 쿼리 자체에는 간격을 두지 않는다. 행을 다시 읽어야 하는 순간은 **수거가 ready 를
// 말한 그때 한 번**뿐이라, 두 쿼리가 각자 돌면 같은 대기 동안 조회가 두 배가 된다.
export function useDiagnosisReport(enabled: boolean): DiagnosisReportState {
  const { userId } = useAuth();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  // "어느 대기를 기다리다 접었는가". 불린이 아니라 시각을 담는 이유는 되돌리기 위해서다 —
  // 새 배치가 나가면 그 시각이 달라져 이 값이 저절로 어긋나고 폴링이 다시 시작된다(효과 안에서
  // setState 로 되돌리면 렌더가 연쇄로 돈다).
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const query = useQuery<DiagnosisReportView>({
    queryKey: diagnosisReportKey(userId ?? ""),
    queryFn: () => fetchDiagnosisReport(userId!),
    enabled: enabled && !!userId,
    staleTime: STALE.me,
    // 극복법 본문이다 — 디스크에 남기지 않는다(§6.5 (5) · 앱 AGENTS.md 금지선).
    meta: { persist: false },
  });

  const cycle = query.data?.cycle;
  const waitingFor = cycle?.status === "pending" ? cycle.requestedAt : null;

  // 수거 응답은 아래 useQuery 가 돌려주지만, `enabled` 는 옵션을 만드는 그 자리에서 값이
  // 필요하다(콜백이 아니다) — 그래서 같은 값을 캐시에서 먼저 읽는다. 같은 키를 보는 쿼리가
  // 갱신되면 이 컴포넌트가 다시 렌더되므로 두 값은 언제나 같은 것을 가리킨다.
  const collected =
    queryClient.getQueryData<DiagnosisCollectResponse>(diagnosisCollectKey(userId ?? "")) ?? null;
  // 폴링을 멈추는 두 가지. 실패로 닫힌 뒤에도 계속 부르면 같은 실패를 20초마다 다시 받아 올
  // 뿐이다(사용자가 할 일은 "다시 요청"이지 기다리는 것이 아니다).
  const failed = collected?.status === "failed";
  // 상한을 재는 축. 배치가 실제로 나간 시각이 있으면 그것을(재시도로 새 배치가 나가면 값이
  // 달라져 상한이 저절로 풀린다), 아직 없으면 요청 행 시각을 쓴다.
  const waitKey = collected?.requestedAt ?? waitingFor;
  const stopped = waitKey != null && stoppedFor === waitKey;
  const pollable = enabled && !!userId && waitingFor != null && focused && !stopped && !failed;

  const collect = useQuery<DiagnosisCollectResponse>({
    queryKey: diagnosisCollectKey(userId ?? ""),
    queryFn: () => callEdge("diagnosis-collect", {}),
    enabled: pollable,
    refetchInterval: () => {
      if (!pollable || waitingFor == null) return false;
      const floor = (collected?.recheckSeconds ?? 0) * 1000;
      const elapsed = Date.now() - Date.parse(waitingFor);
      const base = Number.isNaN(elapsed) || elapsed > POLL_FAST_WINDOW_MS ? POLL_SLOW_MS : POLL_FAST_MS;
      return Math.max(base, floor);
    },
    staleTime: STALE.edge,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // 한 번 실패해도 여기서 다시 보내지 않는다 — 다음 간격이 어차피 같은 일을 한다.
    retry: false,
    meta: { persist: false },
  });

  useEffect(() => {
    // 대기 중이 아니거나, 화면을 떠났거나, 이미 접었거나 실패로 끝났으면 타이머를 두지 않는다.
    if (!waitKey || !focused || stopped || failed) return;
    const timer = setTimeout(() => setStoppedFor(waitKey), POLL_STOP_MS);
    return () => clearTimeout(timer);
  }, [waitKey, focused, stopped, failed]);

  // 수거가 리포트를 채웠다 — 그때 딱 한 번 행을 다시 읽는다(본문은 여전히 RLS 직접 조회다).
  // 마이페이지 "다음 행동" 카드·홈이 보는 주기 상태도 방금 바뀌었다.
  const collectStatus = collected?.status ?? null;
  useEffect(() => {
    if (collectStatus !== "ready" || !userId) return;
    void queryClient.invalidateQueries({ queryKey: diagnosisReportKey(userId) });
    void queryClient.invalidateQueries({ queryKey: weeklyDiagnosisKey(userId) });
  }, [collectStatus, userId, queryClient]);

  const refetchReport = query.refetch;
  const refetchCollect = collect.refetch;
  const refresh = useCallback(() => {
    void refetchReport();
    // 기다리는 중이 아니면 부르지 않는다(수거할 것이 없는데 Edge 를 깨우지 않는다).
    if (waitingFor != null) void refetchCollect();
  }, [refetchReport, refetchCollect, waitingFor]);

  return {
    query,
    polling: pollable,
    // **pending 일 때만** 실어 준다. 수거가 ready 로 끝난 응답에도 배치 시각이 들어 있어서,
    // 그대로 넘기면 리포트가 도착한 뒤에도 대기 카드가 계속 그려진다.
    batch:
      collected?.status === "pending" && collected.requestedAt
        ? { requestedAt: collected.requestedAt, conceptCount: collected.conceptCount }
        : null,
    failure: failed ? (collected?.error ?? COLLECT_FAILED_FALLBACK) : null,
    awaitingSubmit: collected?.status === "pending" && collected.requestedAt == null,
    refresh,
  };
}

// ── 3) 요청(EF `diagnosis-request`) ──────────────────────────────────────────

// "고른 N개 개념으로 극복법 받기". **이 호출 안에서 배치까지 나간다**(서버가 요청 행을 만든
// 직후 submitPendingDiagnoses 를 부른다) — 응답의 `submitted`·`generating`·`submitError` 가
// 그 결과다. 제출이 실패해도 200 이고 요청 행은 남으므로, 화면은 `submitError` 를 그대로
// 보여주고 시간당 웹 크론이 안전망으로 다시 집는다.
//
// 성공 뒤에도 **집계(diagnosis-aggregate)는 무효화하지 않는다.** 요청 한 번으로 달라지는 것은
// 주기 상태(선택창 → 대기 카드)뿐이고 막대그래프는 같은 오답을 그대로 그리는데, 그걸 다시
// 받으려면 60왕복이 또 든다. 화면은 아래 무효화로 되살아나는 요청 행으로 상태를 가른다.
//
// 인자가 빈 배열이면 서버는 요청 행의 개념 선택을 **그대로 둔다**(덮어쓰지 않는다) — 실패한
// 진단을 같은 개념으로 다시 내는 재시도 버튼이 그 경로를 쓴다.
export function useRequestDiagnosis() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (selectedConcepts: DiagnosisConceptSelection[]) =>
      callEdge("diagnosis-request", { selectedConcepts }),
    onSuccess: (res) => {
      if (!userId) return;
      // 마이페이지 "다음 행동" 카드·홈이 보는 주기 상태(ready/pending)도 방금 바뀌었다.
      void queryClient.invalidateQueries({ queryKey: weeklyDiagnosisKey(userId) });
      void queryClient.invalidateQueries({ queryKey: diagnosisEligibilityKey(userId) });
      // 지난 수거 결과는 버린다. invalidate 가 아니라 remove 인 이유: 실패로 닫힌 응답이
      // 남아 있으면 폴링이 꺼진 채라 무효화해도 다시 묻지 않는다(disabled 쿼리는 refetch
      // 대상이 아니다). 값을 지우면 실패 상태가 풀려 새 배치를 곧바로 따라간다.
      queryClient.removeQueries({ queryKey: diagnosisCollectKey(userId) });
      // **제출까지 갔을 때만** 요청 행을 다시 읽는다. 요청 행이 캐시에 들어오는 순간 화면은
      // 선택창을 닫고 대기 카드로 바꾸는데(diagnosis-board.tsx), 제출이 막힌 경우
      // (submitError — 고른 개념에 오답이 없다 등)에는 그게 **사유가 사라진 스피너**가 된다.
      // 그대로 두면 선택창이 남아 사유를 보여주고 개념을 다시 골라 누를 수 있다.
      if (res.generating || !res.submitError) {
        void queryClient.invalidateQueries({ queryKey: diagnosisReportKey(userId) });
      }
    },
  });
}

// ── 4) 같은 개념 기출 풀기(EF `review-create`) ───────────────────────────────

// 극복법 카드의 "같은 개념 기출 5문제". 내 오답이 아니라 **기출 전체**에서 같은 개념 문항을 뽑아
// 세션을 만든다(웹 createReviewFromConcept 와 같은 규칙 — 서버가 프리미엄을 다시 본다).
// 멱등 키를 두지 않는 것도 웹과 같다: 연타는 버튼의 pending 이 막고, 세션은 언제든 새로 만들 수
// 있는 값이라 재시도가 두 개를 만들어도 잃는 것이 없다.
export function useCreateConceptReview() {
  return useMutation({
    mutationFn: async (input: {
      concept: string;
      conceptId: string | null;
      subjectSlug: string;
      limit?: number;
    }) => {
      const res = await callEdge("review-create", {
        concept: input.concept,
        conceptId: input.conceptId,
        subjectSlug: input.subjectSlug,
        limit: input.limit ?? 5,
      });
      return res.sessionId;
    },
  });
}
