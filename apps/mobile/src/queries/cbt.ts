import {
  fetchQuestionMedia,
  getPaperSlug,
  isPaperUuid,
  normalizePaperSlugParam,
  recoverAttempt,
  type CbtSubmitResponse,
  type ExamPaper,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { publicUrl } from "../lib/storage";
import { supabase } from "../lib/supabase";

// `/papers/[id]/cbt` 데이터(설계서 §5 행, §6.2 카탈로그·문항 이미지·CBT 시작/제출).
// 웹 cbt/page.tsx 가 서버에서 하던 조회를 그대로: 문제지 메타 + has_cbt_answers + 문항 이미지·
// 선지 수(core fetchQuestionMedia). 전부 공개 데이터라 ['catalog', …] 로 디스크 퍼시스트한다.
// 정답·채점 결과는 여기 없다(Edge 응답은 컴포넌트 상태에만).

export type CbtPaperData = {
  paper: ExamPaper;
  hasCbtAnswers: boolean;
  fileUrl: string;
  // 문항별 크롭 이미지(공개 URL). 아직 크롭을 안 올린 문제지는 빈 객체 → 문제별 탭 비활성.
  questionImages: Record<number, string[]>;
  questionChoiceCounts: Record<number, number>;
};

export function cbtPaperKey(param: string) {
  return ["catalog", "cbt-paper", param] as const;
}

// 주소 조각(slug 또는 옛 UUID) → id. slug 는 제목에서 계산되는 값이라 되돌릴 수 없어 표를
// 만들어야 하는데(웹 lib/paper-slug-map.ts), 여기서는 slug 첫 조각(연도)으로 후보를 좁혀
// 그 행들의 slug 만 계산한다(문제지 전체 3,800행을 받지 않는다). 카탈로그 쿼리의 slugMap
// (core data/paper-slug-map.ts, 다른 화면이 퍼시스트)이 붙으면 그쪽을 먼저 보도록 바꾼다.
async function resolvePaperIdFromParam(param: string): Promise<string | null> {
  const slug = normalizePaperSlugParam(param);
  if (isPaperUuid(slug)) return slug;
  const year = /^\d{4}/.exec(slug)?.[0];
  let query = supabase.from("exam_papers").select("id, title, round, track");
  query = year ? query.ilike("title", `${year}%`) : query.limit(1000);
  const { data } = await query;
  for (const row of (data ?? []) as { id: string; title: string; round: number; track: string | null }[]) {
    if (getPaperSlug(row.title, row.round, row.track) === slug) return row.id;
  }
  return null;
}

// 문제지가 없으면 null(라우트가 +not-found 를 그린다).
async function fetchCbtPaper(param: string): Promise<CbtPaperData | null> {
  const id = await resolvePaperIdFromParam(param);
  if (!id) return null;

  const [{ data: paper }, { data: hasAnswers }, media] = await Promise.all([
    supabase.from("exam_papers").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("has_cbt_answers", { target_paper_id: id }),
    fetchQuestionMedia(supabase, [id]),
  ]);
  if (!paper) return null;
  const typed = paper as ExamPaper;

  const questionImages: Record<number, string[]> = {};
  const questionChoiceCounts: Record<number, number> = {};
  for (const [number, entry] of media.get(id) ?? []) {
    if (entry.images.length === 0) continue;
    questionImages[number] = entry.images;
    if (entry.choiceCount != null) questionChoiceCounts[number] = entry.choiceCount;
  }

  return {
    paper: typed,
    hasCbtAnswers: !!hasAnswers,
    fileUrl: publicUrl(typed.file_path),
    questionImages,
    questionChoiceCounts,
  };
}

export function useCbtPaper(param: string) {
  return useQuery({
    queryKey: cbtPaperKey(param),
    queryFn: () => fetchCbtPaper(param),
    staleTime: STALE.catalog,
    enabled: param.length > 0,
  });
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
// cbt-start 는 (user_id, paper_id) upsert 라 재호출이 started_at 을 덮는다(§6.6). 응답의
// startedAt 만이 타이머 기준이다 — 클라이언트 시계로 먼저 재지 않는다.
export function useStartCbt(paperId: string) {
  const inFlight = useRef<Promise<{ startedAt: string }> | null>(null);
  return useMutation({
    mutationFn: () => {
      // single-flight: 카운트다운 효과·재시도 링크가 겹쳐도 요청은 하나.
      if (inFlight.current) return inFlight.current;
      const p = callEdge("cbt-start", { paperId })
        .then((res) => ({ startedAt: res.startedAt }))
        .finally(() => {
          inFlight.current = null;
        });
      inFlight.current = p;
      return p;
    },
  });
}

// ── 제출 ─────────────────────────────────────────────────────────────────────
export const ALREADY_GRADED_MESSAGE = "다른 기기에서 이미 채점됐어요";
// 서버가 시작 행을 못 찾았을 때 주는 문구(rules/cbt-attempt.ts) — 앱은 "이미 채점됨"으로 해석.
const START_ROW_GONE_MESSAGE = "새로고침 후 다시 시작해주세요.";

export type CbtSubmitInput = { answers: (number | null)[]; startedAt: string };

// 응답을 못 받았거나(타임아웃) 시작 행이 이미 회수된 경우 재제출하지 않고 recoverAttempt 로
// 복원한다(§6.6). 복원 결과는 voidedQuestions 를 모르므로 [] 로, diagnosisProgress 는 null.
async function submitOrRecover(
  paperId: string,
  userId: string,
  { answers, startedAt }: CbtSubmitInput,
): Promise<CbtSubmitResponse> {
  try {
    return await callEdge("cbt-submit", { paperId, answers }, { timeoutMs: 60_000 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const code = (e as { code?: string }).code;
    const shouldRecover = message === START_ROW_GONE_MESSAGE || code === "aborted";
    if (!shouldRecover) throw e;
    const recovered = await recoverAttempt(supabase, userId, paperId, startedAt).catch(() => null);
    if (!recovered) throw new Error(code === "aborted" ? message : ALREADY_GRADED_MESSAGE);
    return {
      success: true,
      attemptId: recovered.attemptId,
      score: recovered.score,
      totalQuestions: recovered.totalQuestions,
      durationSeconds: recovered.durationSeconds,
      voidedQuestions: [],
      questionResults: recovered.questionResults,
      diagnosisProgress: null,
    };
  }
}

// 채점 성공 후 무효화 지도(§6.3): 응시 목록·오답노트·상태·출석·멤버십·복습 요약·진단 자격.
const INVALIDATE_AFTER_SUBMIT = [
  "attempts",
  "wrong-notes",
  "status",
  "attendance",
  "membership",
  "due-summary",
  "diagnosis-eligibility",
] as const;

export function useSubmitCbt(paperId: string, userId: string | null) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Promise<CbtSubmitResponse> | null>(null);
  return useMutation({
    mutationFn: (input: CbtSubmitInput) => {
      // single-flight(§6.6 "CBT 이중 제출"): 연타·재시도가 겹쳐도 요청은 하나.
      if (inFlight.current) return inFlight.current;
      const p = submitOrRecover(paperId, userId ?? "", input).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = p;
      return p;
    },
    onSuccess: () => {
      if (!userId) return;
      for (const key of INVALIDATE_AFTER_SUBMIT) {
        void queryClient.invalidateQueries({ queryKey: ["me", userId, key] });
      }
    },
  });
}
