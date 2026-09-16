import {
  currentCycleStartDate,
  isEdgeError,
  type AiDiagnosisReport,
  type DiagnosisAggregateResponse,
  type DiagnosisConceptCoaching,
  type DiagnosisConceptSelection,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
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
  // ready = report 가 채워졌다 · pending = 요청만 있고 크론을 기다린다.
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

// 리포트가 도착할 때까지 다시 묻는 간격. 웹은 10초지만 웹의 폴링은 **배치 수거까지 겸한다**
// (checkDiagnosisProgress 가 Anthropic 에서 결과를 걷어 온다). 앱은 걷어 올 수 없고 크론이
// 채워 주기를 기다릴 뿐이라, 같은 간격으로 두드려 봐야 DB 조회만 세 배가 된다.
const POLL_MS = 30_000;
// 폴링을 접기까지의 시간. 앱 경로의 리포트는 시간 단위로 걸릴 수 있어서(대기 카드 주석) 끝까지
// 붙잡는 폴링은 배터리만 먹는다 — 여기서 멈추고 "당겨서 새로고침"으로 넘긴다. 상한은 **화면에
// 머문 시간** 기준이라 나갔다 들어오면 다시 20분이 주어진다(어제 넣어 둔 요청을 오늘 열었을 때
// 한 번도 안 묻고 끝나면 안 된다).
const POLL_STOP_MS = 20 * 60_000;

export type DiagnosisReportState = {
  query: UseQueryResult<DiagnosisReportView>;
  // 지금 30초마다 다시 묻고 있는가. false 면 상한에 걸려 접은 것이고(화면이 보이는 동안만
  // 재는 값이다), 대기 카드가 그때 "당겨서 새로고침" 안내로 바뀐다.
  polling: boolean;
};

// 리포트 조회 + 대기 폴링. 폴링은 **이 화면이 포커스를 가진 동안, 포그라운드에서만** 돈다:
//   · `useIsFocused()` 가 false 면 간격을 끈다 → 화면을 떠나면 멈춘다.
//   · TanStack 의 `refetchIntervalInBackground` 기본값이 false 라, 앱이 백그라운드로 내려가면
//     (focusManager ← AppState, lib/query-client.ts) 간격이 스스로 쉰다.
export function useDiagnosisReport(enabled: boolean): DiagnosisReportState {
  const { userId } = useAuth();
  const focused = useIsFocused();
  // "어느 요청을 기다리다 접었는가". 불린이 아니라 요청 시각을 담는 이유는 되돌리기 위해서다 —
  // 다음 주기에 새 요청을 넣으면 requestedAt 이 달라져 이 값이 저절로 어긋나고 폴링이 다시
  // 시작된다(효과 안에서 setState 로 되돌리면 렌더가 연쇄로 돈다).
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const query = useQuery<DiagnosisReportView>({
    queryKey: diagnosisReportKey(userId ?? ""),
    queryFn: () => fetchDiagnosisReport(userId!),
    enabled: enabled && !!userId,
    staleTime: STALE.me,
    refetchInterval: (q) => {
      const cycle = q.state.data?.cycle;
      if (!focused || cycle?.status !== "pending" || stoppedFor === cycle.requestedAt) return false;
      return POLL_MS;
    },
    // 극복법 본문이다 — 디스크에 남기지 않는다(§6.5 (5) · 앱 AGENTS.md 금지선).
    meta: { persist: false },
  });

  const cycle = query.data?.cycle;
  const waitingFor = cycle?.status === "pending" ? cycle.requestedAt : null;
  const stopped = waitingFor != null && stoppedFor === waitingFor;

  useEffect(() => {
    // 대기 중이 아니거나, 화면을 떠났거나, 이미 접었으면 타이머를 두지 않는다.
    if (!waitingFor || !focused || stopped) return;
    const timer = setTimeout(() => setStoppedFor(waitingFor), POLL_STOP_MS);
    return () => clearTimeout(timer);
  }, [waitingFor, focused, stopped]);

  return { query, polling: waitingFor != null && focused && !stopped };
}

// ── 3) 요청(EF `diagnosis-request`) ──────────────────────────────────────────

// "고른 N개 개념으로 극복법 받기". 응답은 요청 행의 상태뿐이다 — 리포트는 웹 크론이 채운다.
//
// 성공 뒤에도 **집계(diagnosis-aggregate)는 무효화하지 않는다.** 요청 한 번으로 달라지는 것은
// 주기 상태(선택창 → 대기 카드)뿐이고 막대그래프는 같은 오답을 그대로 그리는데, 그걸 다시
// 받으려면 60왕복이 또 든다. 화면은 아래 무효화로 되살아나는 요청 행으로 상태를 가른다.
export function useRequestDiagnosis() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (selectedConcepts: DiagnosisConceptSelection[]) =>
      callEdge("diagnosis-request", { selectedConcepts }),
    onSuccess: () => {
      if (!userId) return;
      // 요청 행이 생겼다 — 대기 카드를 그리려면 requested_at·개념 수가 필요하다.
      void queryClient.invalidateQueries({ queryKey: diagnosisReportKey(userId) });
      // 마이페이지 "다음 행동" 카드·홈이 보는 주기 상태(ready/pending)도 방금 바뀌었다.
      void queryClient.invalidateQueries({ queryKey: weeklyDiagnosisKey(userId) });
      void queryClient.invalidateQueries({ queryKey: diagnosisEligibilityKey(userId) });
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
