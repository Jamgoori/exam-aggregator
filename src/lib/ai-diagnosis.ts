import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// AI 약점 진단(일 1회)의 자격 판정·오늘 진단 조회. 실제 리포트 "생성"은 앱이 하지
// 않는다 — 사용자가 요청하면 report가 null인 행만 만들고(요청 표시), 생성기(Claude
// Code 배치나 온디맨드 API)가 나중에 report를 채운다. 이 파일은 그 요청·조회·자격만 담당.

// 콜드 스타트 문턱: 데이터가 빈약하면 진단이 뻔해져 신뢰를 깎으므로, 최소치를 넘겨야
// 진단을 열어준다. (누적 오답 15개 또는 응시 3회)
export const DIAGNOSIS_MIN_WRONG = 15;
export const DIAGNOSIS_MIN_ATTEMPTS = 3;

// 화면이 안정적으로 그리도록 구조화한 리포트. 생성기는 이 스키마에 맞춰 저장한다.
// 자유 서술 마크다운이 아니라 필드로 받아, UI가 취약 개념→모아보기 딥링크 등으로
// 이어줄 수 있게 한다. 모든 배열/필드는 있는 것만 그린다.
export type DiagnosisWeakConcept = {
  concept: string;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number | null;
  resolvedCount: number | null;
};

export type DiagnosisSubjectTrend = {
  subject: string;
  // "up" | "down" | "flat" — 최근 응시 추세.
  trend: "up" | "down" | "flat";
  note: string;
};

export type AiDiagnosisReport = {
  summary: string;
  weakConcepts: DiagnosisWeakConcept[];
  subjectTrends: DiagnosisSubjectTrend[];
};

export type DiagnosisEligibility = {
  eligible: boolean;
  wrongCount: number;
  attemptCount: number;
  // 자격 미달일 때 "무엇을 더 하면 되는지" 한 줄.
  hint: string | null;
};

// KST 기준 오늘 날짜(YYYY-MM-DD). "일 1회"의 날짜 키. 서버(Node)에서 시간대 변환.
export function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export async function getDiagnosisEligibility(
  supabase: Supabase,
  userId: string,
): Promise<DiagnosisEligibility> {
  const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
    supabase
      .from("cbt_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    // 한 번이라도 틀린 문항 수(user_question_status는 CBT+섞어풀기 통합). 마이그레이션
    // 미적용 등으로 비면 0이 되고, 그때는 응시 수 기준으로만 자격을 판정한다.
    supabase
      .from("user_question_status")
      .select("paper_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("wrong_count", 0),
  ]);

  const attempts = attemptCount ?? 0;
  const wrongs = wrongCount ?? 0;
  const eligible = wrongs >= DIAGNOSIS_MIN_WRONG || attempts >= DIAGNOSIS_MIN_ATTEMPTS;

  let hint: string | null = null;
  if (!eligible) {
    const needWrong = DIAGNOSIS_MIN_WRONG - wrongs;
    hint =
      needWrong > 0
        ? `오답 ${needWrong}개를 더 쌓거나 ${Math.max(0, DIAGNOSIS_MIN_ATTEMPTS - attempts)}회 더 응시하면 진단을 받을 수 있어요.`
        : `${Math.max(0, DIAGNOSIS_MIN_ATTEMPTS - attempts)}회 더 응시하면 진단을 받을 수 있어요.`;
  }

  return { eligible, wrongCount: wrongs, attemptCount: attempts, hint };
}

export type TodayDiagnosis = {
  status: "ready" | "pending";
  report: AiDiagnosisReport | null;
  date: string;
};

// 오늘(KST) 진단 행을 조회한다. report가 있으면 ready, 요청만 있고 아직 없으면 pending,
// 행이 없으면 null.
export async function getTodayDiagnosis(
  supabase: Supabase,
  userId: string,
): Promise<TodayDiagnosis | null> {
  const date = kstToday();
  const { data } = await supabase
    .from("ai_diagnoses")
    .select("report")
    .eq("user_id", userId)
    .eq("diagnosis_date", date)
    .maybeSingle();
  if (!data) return null;
  const report = (data.report as AiDiagnosisReport | null) ?? null;
  return { status: report ? "ready" : "pending", report, date };
}

// 가장 최근에 생성된(리포트가 있는) 진단. 오늘 것이 아직 없을 때 리포트 페이지에서
// 지난 진단이라도 보여주기 위한 조회.
export async function getLatestReadyDiagnosis(
  supabase: Supabase,
  userId: string,
): Promise<{ report: AiDiagnosisReport; date: string } | null> {
  const { data } = await supabase
    .from("ai_diagnoses")
    .select("report, diagnosis_date")
    .eq("user_id", userId)
    .not("report", "is", null)
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || !data.report) return null;
  return {
    report: data.report as AiDiagnosisReport,
    date: data.diagnosis_date as string,
  };
}

// "오늘 진단 요청" 생성: 자격을 확인하고, 오늘 행이 없으면 report=null로 만든다.
// 이미 있으면(요청/완료) 그대로 둔다("일 1회"). 리포트 생성은 별도(생성기)가 한다.
export async function requestTodayDiagnosis(
  supabase: Supabase,
  userId: string,
): Promise<{ error?: string; status?: "ready" | "pending" }> {
  const existing = await getTodayDiagnosis(supabase, userId);
  if (existing) return { status: existing.status };

  const eligibility = await getDiagnosisEligibility(supabase, userId);
  if (!eligibility.eligible) {
    return { error: eligibility.hint ?? "아직 진단을 받을 수 있는 조건이 아니에요." };
  }

  const { error } = await supabase
    .from("ai_diagnoses")
    .insert({ user_id: userId, diagnosis_date: kstToday(), report: null });
  // 동시에 두 번 눌러 unique 충돌이 나도 "이미 요청됨"으로 본다.
  if (error && error.code !== "23505") {
    return { error: "진단 요청에 실패했어요. 잠시 후 다시 시도해주세요." };
  }
  return { status: "pending" };
}
