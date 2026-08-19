import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // 출제 빈도(1~3점). 전체 기출에서 이 개념(keyword_title)이 얼마나 자주 나오는지를
  // next-diagnosis.mjs가 코퍼스 빈도로 3분위 눌러 넣는다. "가성비 우선순위"(자주 나오는데
  // 약한 것 먼저)의 근거. 없으면 화면이 빈도 뱃지를 숨긴다.
  frequency?: number | null;
  // 내 정답률(%). 생성기가 계산해 줄 수 있으면 채운다. 없으면 화면이 극복 진행도
  // (resolvedCount/wrongCount)로 대체 표시하므로 지어내지 말 것.
  accuracyPct?: number | null;
};

export type DiagnosisSubjectTrend = {
  subject: string;
  // "up" | "down" | "flat" — 최근 응시 추세.
  trend: "up" | "down" | "flat";
  note: string;
  // 최근 회차 정오율(%) 배열, 오래된→최신. 스파크라인용. 입력(recentScores)을 그대로
  // 실어 준다. 없으면 화면은 추세 화살표만 그린다.
  scores?: number[] | null;
};

// 히어로(오늘의 1분 미션): 한 줄 요약과 시작 버튼 목적지. "지금 당장 뭘 하면 되는지".
export type DiagnosisMission = {
  // 예: "컴퓨터일반 '서브넷 마스크 계산'만 잡으면 예상 점수 +5점". 데이터 근거 한 줄.
  headline: string;
  // 미션 시작 버튼이 섞어풀기를 만들 과목 slug. 없으면 버튼은 오답노트 허브로 보낸다.
  subjectSlug?: string | null;
  // 미션이 겨냥하는 개념명(강조 표시용). 선택.
  concept?: string | null;
};

// AI 오답 패턴(자주 낚이는 선지 유형)을 문장형으로 짚어주는 인사이트. 선택.
export type DiagnosisInsight = {
  subject?: string | null;
  // 예: "정보보호론에서 'MAC과 DAC의 차이'를 묻는 함정 선지에 오답률이 높아요". 한 문장.
  text: string;
  // 오답률(%). 강조 뱃지용. 없으면 숨김.
  wrongRatePct?: number | null;
};

// 개념별 "맞춤 극복법"(AI). 진단받기 시점에 온디맨드 API가 상위 취약 개념들을 한 번에
// 생성해 report에 캐시한다(일 1회 재사용). 표시 방식은 화면 자유 — 데이터만 담아둔다.
export type DiagnosisConceptCoaching = {
  concept: string;
  subject?: string | null;
  subjectSlug?: string | null;
  // 이 개념에서 "주로 어떤 문제를 틀리는지" 한두 문장(데이터 근거 기반).
  weakPattern: string;
  // 어떻게 극복하면 좋을지 실천형 조언 한두 문장.
  howToOvercome: string;
};

export type AiDiagnosisReport = {
  summary: string;
  weakConcepts: DiagnosisWeakConcept[];
  subjectTrends: DiagnosisSubjectTrend[];
  // 아래 필드들은 리뉴얼된 대시보드용(선택). 구버전 리포트엔 없을 수 있어 화면이
  // 있으면 그리고 없으면 대체/숨김 처리한다.
  mission?: DiagnosisMission | null;
  insights?: DiagnosisInsight[] | null;
  // 개념별 맞춤 극복법(AI, 진단받기 때 생성·캐시).
  conceptCoaching?: DiagnosisConceptCoaching[] | null;
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
    // "오답을 더 쌓으라"는 표현은 수험생에게 부담을 주므로, 노력(더 풀기) 기준으로 안내.
    hint = `문제를 조금 더 풀면 진단을 받을 수 있어요 (오답 ${DIAGNOSIS_MIN_WRONG}개 또는 ${DIAGNOSIS_MIN_ATTEMPTS}회 응시).`;
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

  // 쓰기는 service_role 로 한다. ai_diagnoses 에는 insert 정책이 없다 — 예전처럼
  // 클라이언트가 직접 넣을 수 있으면 여기 위의 멤버십·자격 검사를 건너뛰고 요청 행을
  // 만들 수 있고, 생성 배치가 그 행을 유료 리포트로 채워 준다(schema.sql 참고).
  // 이 함수에 닿기 전에 호출부(mypage/actions.ts requestDiagnosis)가 isPremium 을,
  // 바로 위에서 자격(getDiagnosisEligibility)을 이미 확인했다.
  const { error } = await createAdminClient()
    .from("ai_diagnoses")
    .insert({ user_id: userId, diagnosis_date: kstToday(), report: null });
  // 동시에 두 번 눌러 unique 충돌이 나도 "이미 요청됨"으로 본다.
  if (error && error.code !== "23505") {
    return { error: "진단 요청에 실패했어요. 잠시 후 다시 시도해주세요." };
  }
  return { status: "pending" };
}
