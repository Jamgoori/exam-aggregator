import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentCycleStartDate,
  kstToday,
  nextDiagnosisDate,
  DIAGNOSIS_LOCKED_HINT,
} from "../data/home";
import { fetchDiagnosisEligibility } from "../data/mypage";
import {
  normalizeConceptSelection,
  type AiDiagnosisReport,
  type DiagnosisConceptSelection,
} from "../diagnosis-report";

// AI 약점 진단 "요청"의 서버 규칙 — 웹 `lib/ai-diagnosis.ts#requestWeeklyDiagnosis` +
// `app/mypage/actions.ts#requestDiagnosis` 의 게이트 부분을 옮긴 것(설계서 §6.7 #21).
//
// **여기서 하는 일은 요청 행 하나를 만드는 것뿐이다.** 리포트를 실제로 만드는 것은
// Vercel 크론 `/api/cron/diagnosis`(시간당, Anthropic Message Batches)이고, 웹 서버 액션과
// Edge `diagnosis-request` 는 둘 다 이 함수를 부른 뒤 자기 몫만 더한다(웹은 배치 제출과
// revalidatePath, Edge 는 없음). 앱·Edge 는 배치를 돌리지 않는다 — 요청 행만 만들고
// `ai_diagnoses` 를 RLS 로 폴링한다.
//
// 게이트가 세 겹인 이유는 전부 요금이다. 이 행이 생기면 크론이 그걸 집어 유료 모델을
// 부르므로, 화면을 우회한 호출 하나가 그대로 청구서가 된다:
//   1) 프리미엄(§8.3 "AI 약점 진단 대시보드·요청" 행)
//   2) 자격(오답 15개 ∨ 응시 3회 — 데이터가 빈약하면 진단이 뻔해져 신뢰를 깎는다)
//   3) 주기 1회(ai_diagnoses 의 unique(user_id, diagnosis_date) + 최근 7일 창)
//
// 쓰기는 반드시 service_role 이다. `ai_diagnoses` 는 insert 가 authenticated 에서 회수돼
// 있고(schema.sql:822-823), 그 회수가 바로 위 세 게이트를 DB 가 지켜 주는 방식이다 —
// 정책을 다시 열지 말 것(무료 계정이 PostgREST 로 요청 행을 직접 만들면 크론이 유료
// 리포트를 채워 준다).

// 자격 판정(응시 수 + 한 번이라도 틀린 문항 수)은 data/mypage.ts 에 있다 — 앱도 "다음 행동"
// 카드에서 같은 조회를 쓴다. Edge 는 서버 진입점(server.ts)만 보므로 여기서 다시 내보낸다.
export { fetchDiagnosisEligibility, type DiagnosisEligibility } from "../data/mypage";
// 주기가 풀리는 날(마지막으로 받은 날 + 7일) — 화면 안내 문구가 쓴다. 같은 이유로 여기서 재노출.
export { nextDiagnosisDate } from "../data/home";

export type WeeklyDiagnosis = {
  status: "ready" | "pending";
  report: AiDiagnosisReport | null;
  date: string;
  // 요청 행 id. 웹 배치 제출 경로가 "방금 만든/기다리던 그 행"을 다시 찾지 않게 실어 준다.
  id: string;
  // 요청할 때 박아 둔 개념 선택. 제출과 생성이 몇 시간 떨어져 있어 **이 값이 정본**이다 —
  // 생성 시점에 다시 집계한 상위 개념은 사용자가 체크한 것과 다르다(schema.sql 주석).
  selectedConcepts: DiagnosisConceptSelection[] | null;
};

// 현재 주기(마지막으로 받은 날부터 7일) 안의 진단 행. report가 있으면 ready, 요청만
// 있고 아직 없으면 pending, 주기 안에 행이 없으면 null(= 지금 새로 받을 수 있다).
//
// client 는 본인 행을 읽을 수 있으면 된다 — 웹은 사용자 세션 클라이언트(ai_diagnoses 는
// select own RLS), Edge 는 admin. 조회가 `.eq("user_id", userId)` 를 명시하므로 결과는 같다.
export async function getWeeklyDiagnosis(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyDiagnosis | null> {
  // 7일 전까지 훑고 가장 최근 행을 본다. 같은 날 중복은 unique 가 막으므로 최대 7행.
  const { data } = await client
    .from("ai_diagnoses")
    .select("id, report, diagnosis_date, selected_concepts")
    .eq("user_id", userId)
    .gte("diagnosis_date", currentCycleStartDate(now))
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    report: AiDiagnosisReport | null;
    diagnosis_date: string;
    selected_concepts: DiagnosisConceptSelection[] | null;
  };
  const report = row.report ?? null;
  return {
    status: report ? "ready" : "pending",
    report,
    date: row.diagnosis_date,
    id: row.id,
    selectedConcepts: row.selected_concepts ?? null,
  };
}

// 가장 최근에 생성된(리포트가 있는) 진단. 이번 주기 것이 아직 없을 때 리포트 화면에서
// 지난 진단이라도 보여주기 위한 조회 — 그 사이 화면이 비면 지난주에 받은 것이 사라진
// 줄 안다.
export async function getLatestReadyDiagnosis(
  client: SupabaseClient,
  userId: string,
): Promise<{ report: AiDiagnosisReport; date: string } | null> {
  const { data } = await client
    .from("ai_diagnoses")
    .select("report, diagnosis_date")
    .eq("user_id", userId)
    .not("report", "is", null)
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { report: AiDiagnosisReport | null; diagnosis_date: string } | null;
  if (!row || !row.report) return null;
  return { report: row.report, date: row.diagnosis_date };
}

// 웹 mypage/actions.ts 의 문구와 **같은 문장**(한 글자도 바꾸지 말 것 — 화면에 그대로 뜬다).
export const DIAGNOSIS_LOCKED = "AI 약점 진단은 멤버십 기능이에요.";
const REQUEST_FAILED = "진단 요청에 실패했어요. 잠시 후 다시 시도해주세요.";

export type DiagnosisRequestInput = {
  userId: string;
  // 프리미엄 판정 **결과**를 받는다(판정 자체는 어댑터 몫 — 웹은 세션 클라이언트의
  // rpc("is_admin") + 멤버십, Edge 는 JWT email + core isPremiumUserFor). 규칙이 판정
  // 방법을 고르면 두 어댑터 중 한쪽의 관리자 우대가 사라진다(rules/explanation-access 와 같은 방식).
  premium: boolean;
  // 화면에서 체크한 개념들. 요청 행에 그대로 박아 두고, 생성기가 이 목록만 코칭한다.
  // 빈 배열이면 생성기가 알아서 상위 개념을 고른다(구버전 화면·배치 스크립트 경로 호환).
  selectedConcepts?: DiagnosisConceptSelection[] | null;
};

export type DiagnosisRequestDeps = {
  // 요청 행 insert/update 전용 service_role 팩토리. 웹은 createAdminClient, Edge 는 admin 그대로.
  getAdmin: () => SupabaseClient;
  now?: Date;
};

export type DiagnosisRequestResult =
  | {
      ok: false;
      // premium 403 · not-eligible 400 · insert-failed 500 (Edge 어댑터가 이 값으로 상태를 고른다)
      reason: "premium" | "not-eligible" | "insert-failed";
      error: string;
    }
  | {
      ok: true;
      // ready  — 이번 주기 리포트가 이미 있다(그대로 보여준다)
      // pending— 요청 행이 있다(방금 만들었거나, 생성 대기 중이거나, 실패해 남아 있던 행)
      status: "ready" | "pending";
      // 요청 행 id. 조회에 실패했을 때만 null(그때도 행은 있다 — 다음 크론이 집는다).
      diagnosisId: string | null;
      // 요청 행의 KST 날짜(YYYY-MM-DD).
      date: string;
      // 이 주기가 풀리는 날(= date + 7일). 화면 안내용.
      nextDate: string;
      // 실제로 저장된 개념 선택(상한까지 잘린 뒤). 화면이 "N개 개념으로 만들어요"를 이 수로 말한다.
      selectedConcepts: DiagnosisConceptSelection[];
    };

// 진단 요청 생성: 프리미엄·자격을 확인하고, 현재 주기 안에 행이 없으면 report=null 로
// 만든다. 이미 있으면 그대로 둔다(주기 잠금).
export async function requestDiagnosisForUser(
  client: SupabaseClient,
  input: DiagnosisRequestInput,
  deps: DiagnosisRequestDeps,
): Promise<DiagnosisRequestResult> {
  const now = deps.now ?? new Date();
  const { userId } = input;

  // 진단은 멤버십 기능이다. 배너를 숨기는 것과 별개로 여기서도 막는다 — 생성이 실제로
  // 도는 경로라, 화면을 우회해 부르면 그대로 비용이 나간다.
  if (!input.premium) return { ok: false, reason: "premium", error: DIAGNOSIS_LOCKED };

  // 선택은 여기서 상한(COACH_MAX_TOTAL)으로 자른다 — 개념 하나가 곧 프롬프트 한 덩이다.
  const selected = normalizeConceptSelection(input.selectedConcepts ?? []);

  const existing = await getWeeklyDiagnosis(client, userId, now);
  if (existing) {
    // 생성이 실패해 pending 으로 남은 요청을 다시 누른 경우다. 그 사이 사용자가 개념을
    // 다시 골랐다면 그 선택으로 갈아 준다 — 체크박스를 고쳐 놓고 눌렀는데 예전 선택으로
    // 만들어지면 화면이 거짓말을 한 것이 된다. 이미 완료된(ready) 리포트는 건드리지 않는다.
    if (existing.status === "pending" && selected.length > 0) {
      await deps
        .getAdmin()
        .from("ai_diagnoses")
        .update({ selected_concepts: selected })
        .eq("user_id", userId)
        .eq("diagnosis_date", existing.date)
        .is("report", null);
    }
    return {
      ok: true,
      status: existing.status,
      diagnosisId: existing.id,
      date: existing.date,
      nextDate: nextDiagnosisDate(existing.date),
      // 이번에 고른 것이 있으면 그것(위에서 행에 갈아 넣었다), 없으면 행에 남아 있던 선택.
      // 호출부(웹 즉시 생성 경로)가 "요청 행에 실제로 박힌 목록"으로 생성기를 부른다.
      selectedConcepts: selected.length > 0 ? selected : (existing.selectedConcepts ?? []),
    };
  }

  // 콜드 스타트 문턱. 둘 중 하나만 넘기면 열린다(오답 15 ∨ 응시 3).
  const eligibility = await fetchDiagnosisEligibility(client, userId);
  if (!eligibility.eligible) {
    return { ok: false, reason: "not-eligible", error: DIAGNOSIS_LOCKED_HINT };
  }

  const date = kstToday(now);
  const { data, error } = await deps
    .getAdmin()
    .from("ai_diagnoses")
    .insert({
      user_id: userId,
      diagnosis_date: date,
      report: null,
      selected_concepts: selected.length > 0 ? selected : null,
    })
    .select("id")
    .maybeSingle();

  // 동시에 두 번 눌러 unique(user_id, diagnosis_date) 충돌이 나도 "이미 요청됨"으로 본다 —
  // 그 행은 방금 다른 요청이 만든 같은 요청이다. 다만 id 는 insert 가 안 돌려주므로 다시
  // 읽는다(호출부가 그 행을 배치에 실어야 한다 — 못 찾으면 다음 크론이 집는다).
  if (error) {
    if (error.code !== "23505") {
      return { ok: false, reason: "insert-failed", error: REQUEST_FAILED };
    }
    const raced = await getWeeklyDiagnosis(client, userId, now);
    return {
      ok: true,
      status: raced?.status ?? "pending",
      diagnosisId: raced?.id ?? null,
      date: raced?.date ?? date,
      nextDate: nextDiagnosisDate(raced?.date ?? date),
      selectedConcepts: selected,
    };
  }

  return {
    ok: true,
    status: "pending",
    diagnosisId: (data as { id: string } | null)?.id ?? null,
    date,
    nextDate: nextDiagnosisDate(date),
    selectedConcepts: selected,
  };
}
