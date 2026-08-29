import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { COACH_MAX_TOTAL } from "@/lib/diagnosis-limits";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// AI 약점 진단(주 1회)의 자격 판정·이번 주 진단 조회. 실제 리포트 "생성"은 앱이 하지
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
// 생성해 report에 캐시한다(주 1회 재사용). 표시 방식은 화면 자유 — 데이터만 담아둔다.
export type DiagnosisConceptCoaching = {
  concept: string;
  subject?: string | null;
  subjectSlug?: string | null;
  // 이 개념에서 "주로 어떤 문제를 틀리는지" 한두 문장(데이터 근거 기반).
  weakPattern: string;
  // 어떻게 극복하면 좋을지 실천형 조언 한두 문장.
  howToOvercome: string;
};

// 사용자가 이번 진단에서 고른 개념. 화면의 체크박스가 그대로 이 배열이 된다.
// conceptId 는 정본 개념 id(없는 개념이면 null이고 표기로만 식별한다) —
// diagnosis-limits 의 conceptSelectionKey 와 짝이다.
export type DiagnosisConceptSelection = {
  conceptId: string | null;
  concept: string;
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

// KST 기준 오늘 날짜(YYYY-MM-DD). 해설 열람 제한 등 "일 1회" 규칙의 날짜 키.
export function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 진단 주기(일). 마지막으로 진단을 받은 날로부터 이만큼 지나야 다시 받을 수 있다.
export const DIAGNOSIS_CYCLE_DAYS = 7;

// 분석 창의 상한(일). 오래 쉬었다 돌아온 사람의 몇 달치를 통째로 긁으면 프롬프트가
// 그만큼 커져 요금이 뛴다. 2주를 넘겨 거슬러 올라가지 않는다 — 그보다 오래된 오답은
// "지금 무엇을 틀리고 있나"의 근거로도 약하다.
export const DIAGNOSIS_MAX_WINDOW_DAYS = 14;

// 진단 화면 그래프의 기본 기간 하한(일). 분석 창(analysisWindowDays)을 그대로 쓰면,
// 진단을 받은 다음 날 들어온 사람의 창이 1일이 된다 — 일주일을 푼 사람 화면에 어제
// 틀린 몇 문항만 남는다. 자동 확장 사다리는 그 창에 오답이 **하나도 없을 때만** 넓히므로
// 어제 한 문제라도 틀렸으면 1일에 갇힌다. 그래서 그래프만 최소 7일을 보장한다.
// 분석 창(요금이 걸린 쪽)은 이 값과 무관하게 analysisWindowDays 그대로다.
export const GRAPH_MIN_WINDOW_DAYS = 7;

// 이번 분석이 훑을 기간(일). 마지막 진단일부터 오늘까지, 최대 2주.
//  - 9일 전에 받았으면 9일치
//  - 4주 동안 안 받았어도 14일치까지만
//  - 받은 적이 없으면 14일치
export function analysisWindowDays(lastDiagnosisDate: string | null): number {
  if (!lastDiagnosisDate) return DIAGNOSIS_MAX_WINDOW_DAYS;
  const from = Date.parse(`${lastDiagnosisDate}T00:00:00Z`);
  const to = Date.parse(`${kstToday()}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return DIAGNOSIS_MAX_WINDOW_DAYS;
  const days = Math.round((to - from) / 86_400_000);
  return Math.min(DIAGNOSIS_MAX_WINDOW_DAYS, Math.max(1, days));
}

// 마지막으로 리포트가 만들어진 날짜(YYYY-MM-DD). 분석 창의 시작점 — 그 뒤로 쌓인
// 오답만 새로 본다. 없으면 null(처음 받는 사람).
export async function getLastAnalyzedDate(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  const latest = await getLatestReadyDiagnosis(supabase, userId);
  return latest?.date ?? null;
}

// 진단 주기는 달력 주(월~일)가 아니라 **본인이 마지막으로 받은 날 기준 7일**이다.
// 달력 주로 끊으면 금요일에 처음 받은 사람이 이틀 뒤 월요일에 또 받게 되고, 반대로
// 월요일에 받은 사람은 6일을 기다린다 — 같은 "주 1회"인데 사람마다 실제 간격이 다르다.
// diagnosis_date 에는 받은 날짜를 그대로 넣고(기존 unique 가 같은 날 중복만 막는다),
// 잠금은 아래 조회가 "최근 7일 안에 행이 있는지"로 판정한다.
function kstDaysAgo(days: number): string {
  const d = new Date(`${kstToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// 주기가 풀리는 날(YYYY-MM-DD) — 마지막으로 받은 날 + 7일. 화면 안내용.
export function nextDiagnosisDate(lastDate: string): string {
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAGNOSIS_CYCLE_DAYS);
  return d.toISOString().slice(0, 10);
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

export type WeeklyDiagnosis = {
  status: "ready" | "pending";
  report: AiDiagnosisReport | null;
  date: string;
};

// 현재 주기(마지막으로 받은 날부터 7일) 안의 진단 행. report가 있으면 ready, 요청만
// 있고 아직 없으면 pending, 주기 안에 행이 없으면 null(= 지금 새로 받을 수 있다).
export async function getWeeklyDiagnosis(
  supabase: Supabase,
  userId: string,
): Promise<WeeklyDiagnosis | null> {
  // 7일 전까지 훑고 가장 최근 행을 본다. 같은 날 중복은 unique 가 막으므로 최대 7행.
  const { data } = await supabase
    .from("ai_diagnoses")
    .select("report, diagnosis_date")
    .eq("user_id", userId)
    .gte("diagnosis_date", kstDaysAgo(DIAGNOSIS_CYCLE_DAYS - 1))
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const report = (data.report as AiDiagnosisReport | null) ?? null;
  return {
    status: report ? "ready" : "pending",
    report,
    date: data.diagnosis_date as string,
  };
}

// 가장 최근에 생성된(리포트가 있는) 진단. 이번 주 것이 아직 없을 때 리포트 페이지에서
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

// 진단 요청 생성: 자격을 확인하고, 현재 주기(마지막으로 받은 날부터 7일) 안에 행이
// 없으면 report=null 로 만든다. 이미 있으면 그대로 둔다. 리포트 생성은 생성기가 한다.
// nextDate 는 주기가 걸려 있을 때 "언제부터 다시 받을 수 있는지"(화면 안내용).
export async function requestWeeklyDiagnosis(
  supabase: Supabase,
  userId: string,
  // 화면에서 체크한 개념들. 요청 행에 그대로 박아 두고, 생성기(즉시·배치)가 이 목록만
  // 코칭한다. 빈 배열이면 예전처럼 생성기가 알아서 상위 개념을 고른다(구버전 화면·
  // 배치 스크립트 경로 호환).
  selectedConcepts: DiagnosisConceptSelection[] = [],
): Promise<{ error?: string; status?: "ready" | "pending"; nextDate?: string }> {
  // 선택은 여기서도 상한으로 자른다. 개념 하나가 곧 프롬프트 한 덩이이자 요금이라,
  // 화면을 우회해 200개를 실어 보내는 요청이 그대로 청구서가 되면 안 된다.
  const selected = normalizeConceptSelection(selectedConcepts);

  const existing = await getWeeklyDiagnosis(supabase, userId);
  if (existing) {
    // 생성이 실패해 pending 으로 남은 요청을 다시 누른 경우다. 그 사이 사용자가 개념을
    // 다시 골랐다면 그 선택으로 갈아 준다 — 체크박스를 고쳐 놓고 눌렀는데 예전 선택으로
    // 만들어지면 화면이 거짓말을 한 것이 된다. 이미 완료된(ready) 리포트는 건드리지 않는다.
    if (existing.status === "pending" && selected.length > 0) {
      await createAdminClient()
        .from("ai_diagnoses")
        .update({ selected_concepts: selected })
        .eq("user_id", userId)
        .eq("diagnosis_date", existing.date)
        .is("report", null);
    }
    return { status: existing.status, nextDate: nextDiagnosisDate(existing.date) };
  }

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
    .insert({
      user_id: userId,
      diagnosis_date: kstToday(),
      report: null,
      selected_concepts: selected.length > 0 ? selected : null,
    });
  // 동시에 두 번 눌러 unique 충돌이 나도 "이미 요청됨"으로 본다.
  if (error && error.code !== "23505") {
    return { error: "진단 요청에 실패했어요. 잠시 후 다시 시도해주세요." };
  }
  return { status: "pending" };
}

// 클라이언트가 보낸 개념 선택을 믿을 수 있는 모양으로 정리한다: 문자열만 남기고,
// 같은 개념 중복을 없애고, 전체 상한(COACH_MAX_TOTAL)까지 자른다.
export function normalizeConceptSelection(
  input: DiagnosisConceptSelection[] | null | undefined,
): DiagnosisConceptSelection[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: DiagnosisConceptSelection[] = [];
  for (const raw of input) {
    const concept = typeof raw?.concept === "string" ? raw.concept.trim() : "";
    if (!concept) continue;
    const conceptId = typeof raw?.conceptId === "string" && raw.conceptId ? raw.conceptId : null;
    const key = conceptId ?? `kw:${concept}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ conceptId, concept });
    if (out.length >= COACH_MAX_TOTAL) break;
  }
  return out;
}
