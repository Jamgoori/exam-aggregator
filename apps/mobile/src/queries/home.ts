import {
  buildExamIndex,
  currentCycleStartDate,
  decodePapers,
  getExamTypeNames,
  type ExamCombo,
  type Subject,
  type TodayStudyAttempt,
} from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCatalog } from "./catalog";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 홈 랜딩(`/`)·진단 소개(`/diagnosis`) 조회 — 웹 lib/landing-data.ts getLandingData 와
// app/page.tsx TodayStudy·app/diagnosis/page.tsx 의 조회부.
//
// 공개 값(시험 색인·과목 추천 목록·시행처 이름)은 카탈로그 쿼리(['catalog','home-data',mode],
// 디스크 퍼시스트)에서 파생한다 — 별도 왕복 없음. 웹 getHomeStats 의 누적 다운로드·응시 RPC
// (total_download_count·total_cbt_attempt_count, anon 허용)는 현재 웹 랜딩이 그리지 않으므로
// 여기서도 부르지 않는다(통계 띠가 생기면 ['catalog','home-stats'] 로 추가).
//
// 본인 데이터(응시 행·오답 수·이번 주기 진단 행)는 ['me', userId, …] 로 직접 읽는다 —
// 마이페이지 스트림(queries/attempts·mypage)에 기대지 않는다.

export type HomeLanding = {
  combos: ExamCombo[];
  // 홈 검색창의 과목 추천 후보 — 자료가 있는 과목만(웹 getSubjectIndex entries 와 같은 기준).
  subjects: Subject[];
  examTypeNames: string[];
};

export function useHomeLanding() {
  const query = useCatalog();
  const data = useMemo<HomeLanding | undefined>(() => {
    if (!query.data) return undefined;
    const papers = decodePapers(query.data);
    const withPapers = new Set(papers.map((p) => p.subject_id));
    return {
      combos: buildExamIndex(papers, query.data.examTypes),
      subjects: query.data.subjects.filter((s) => withPapers.has(s.id)),
      examTypeNames: getExamTypeNames(papers),
    };
  }, [query.data]);
  return { query, data };
}

// ── 오늘의 학습 현황 (웹 page.tsx TodayStudy 의 조회부) ────────────────────────
// 원본 행을 캐시하고 날짜 계산(오늘·이번 주·스트릭)은 화면이 그릴 때 한다 — 퍼시스트된
// 값을 다음 날 복원해도 "오늘"이 어제로 남지 않는다. 점수·문항 수만 있고 정답은 없다.

export type TodayStudyRaw = {
  attempts: TodayStudyAttempt[];
  // 한 번이라도 틀린 문항 수(user_question_status, CBT+섞어풀기 통합).
  wrongCount: number;
};

export const todayStudyKey = (userId: string) => ["me", userId, "today-study"] as const;

async function fetchTodayStudyRaw(userId: string): Promise<TodayStudyRaw> {
  const [{ data: rows, error }, { count: wrongCount }] = await Promise.all([
    supabase.from("cbt_attempts").select("score, total_questions, created_at").eq("user_id", userId),
    supabase
      .from("user_question_status")
      .select("paper_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("wrong_count", 0),
  ]);
  if (error) throw new Error(`학습 현황 조회 실패: ${error.message}`);
  return { attempts: (rows ?? []) as TodayStudyAttempt[], wrongCount: wrongCount ?? 0 };
}

export function useTodayStudy() {
  const { userId } = useAuth();
  return useQuery<TodayStudyRaw>({
    queryKey: todayStudyKey(userId ?? ""),
    queryFn: () => fetchTodayStudyRaw(userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// ── 진단 소개 화면 (웹 app/diagnosis/page.tsx 의 조회부) ───────────────────────
// 자격 카운트(응시 수·오답 수)와 이번 주기 안의 진단 행 날짜만 — 리포트 본문은 읽지 않는다.
// 멤버십 판정은 useAuth().isPremium(membership-get 쿼리가 붙으면 그쪽 값).

export type DiagnosisIntroData = {
  attemptCount: number;
  wrongCount: number;
  // 이번 주기(최근 7일) 안에 받은/요청한 진단의 날짜. 없으면 null(= 지금 새로 받을 수 있다).
  lastDate: string | null;
};

export const diagnosisIntroKey = (userId: string) => ["me", userId, "diagnosis-intro"] as const;

async function fetchDiagnosisIntro(userId: string): Promise<DiagnosisIntroData> {
  const [{ count: attemptCount, error }, { count: wrongCount }, { data: weekly }] = await Promise.all([
    supabase.from("cbt_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("user_question_status")
      .select("paper_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("wrong_count", 0),
    supabase
      .from("ai_diagnoses")
      .select("diagnosis_date")
      .eq("user_id", userId)
      .gte("diagnosis_date", currentCycleStartDate())
      .order("diagnosis_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`진단 자격 조회 실패: ${error.message}`);
  return {
    attemptCount: attemptCount ?? 0,
    wrongCount: wrongCount ?? 0,
    lastDate: (weekly as { diagnosis_date: string } | null)?.diagnosis_date ?? null,
  };
}

export function useDiagnosisIntro() {
  const { userId } = useAuth();
  return useQuery<DiagnosisIntroData>({
    queryKey: diagnosisIntroKey(userId ?? ""),
    queryFn: () => fetchDiagnosisIntro(userId!),
    enabled: !!userId,
    staleTime: STALE.me,
    // 진단 관련 값은 디스크에 남기지 않는다(AGENTS.md — 진단 리포트 본문 금지선의 연장).
    meta: { persist: false },
  });
}
