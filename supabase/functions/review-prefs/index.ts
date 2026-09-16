// 복습 설정(review_preferences)의 **모든 쓰기**와 설정 화면 읽기(설계서 §6.7 #13, §6.2
// "복습 설정" 행). 규칙 본문은 packages/core/src/rules/review-preferences.ts —
// 웹 mypage/wrong-notes/actions.ts 의 setReviewDailyLimit·toggleReviewSubjectPaused·
// spreadReviewBacklog·restoreSuspendedReview 와 **같은 함수**다. 여기는 요청 파싱·멤버십
// 게이트·응답 직렬화만 한다.
//
//   { action: "get" }            (또는 빈 body) → 설정 화면이 필요한 전부
//   { action: "daily-limit", limit }              하루 문항 수(10/20/40/60)
//   { action: "pause", subjectId, paused }        복습 과목 보류/재개(재개는 재분산 동반)
//   { action: "diagnosis-pause", subjectId, paused } AI 진단에서 뺄 과목
//   { action: "study-phase", phase }              직전 판정 국면 저장(히스테리시스 입력)
//   { action: "spread" }                          밀린 복습 정리하기
//   { action: "restore" }                         접어둔(leech) 문항 되살리기
//
// 응답은 언제나 같은 모양이다(추가만):
//   { premium, dailyLimit, pausedSubjectIds, diagnosisPausedSubjectIds, studyPhase,
//     subjects?, spreadCount?, restoredCount? }
// 쓰기 뒤에도 갱신된 설정을 그대로 실어 보낸다 — 웹의 revalidatePath 에 해당하는 자리라,
// 앱이 토글 직후 같은 함수를 한 번 더 부르지 않아도 된다.
//
// **앱은 이 테이블을 읽기만 한다**(§6.2). RLS 로 직접 쓰게 두면 (1) 멤버십 게이트를 지나치고
// (2) 과목 재개 때 밀린 문항의 srs_due_at 을 다시 뿌리는 서버 전용 처리(respreadResumedSubject)가
// 빠지며 (3) study_phase 히스테리시스가 우회된다. 그래서 쓰기는 전부 여기로 온다.
//
// ── 어느 클라이언트로 쓰나 (웹과 다른 점, 일부러 남긴다) ──────────────────────
// 웹 어댑터(apps/web/src/lib/review-preferences.ts)는 **review_preferences 를 사용자 세션
// 클라이언트(RLS select/insert/update own)** 로 읽고 쓴다 — setDailyLimit·setSubjectPaused·
// setDiagnosisSubjectPaused·saveStudyPhase 의 첫 인자가 그 클라이언트다. user_question_status
// 를 고치는 재분산(setSubjectPaused 의 재예약·spreadOverdueBacklog·restoreSuspendedQuestions)
// 만 admin(service_role)이다(그 테이블에는 쓰기 정책이 없다).
// Edge 는 둘 다 admin 이다(세션 클라이언트가 없다). 규칙은 client 를 주입받으므로 결과 행은
// 같다 — 모든 조회·upsert 가 user_id 를 명시한다.
// review_preferences 의 RLS insert/update 정책을 회수할지는 §13 질문 15 / §12-2 #9 로 **보류**
// (기본값: 지금처럼 웹은 세션 클라이언트, 앱은 이 EF). 회수하기로 하면 웹 어댑터가
// createAdminClient() 를 넘기도록 한 줄만 바꾸면 되고 이 파일은 그대로다.
// 방어선으로 DB check 두 개가 이미 있다(schema.sql: review_preferences_daily_limit_check,
// review_preferences_study_phase_check) — 웹이 세션 클라이언트로 쓰는 한 REST 직접 호출을
// 막는 것은 그 제약뿐이다.
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, testOverrides } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  getDiagnosisPausedSubjectIds,
  getReviewPrefs,
  getReviewSubjectOptions,
  getStoredStudyPhase,
  isPremiumUserFor,
  restoreSuspendedQuestions,
  saveStudyPhase,
  setDailyLimit,
  setDiagnosisSubjectPaused,
  setSubjectPaused,
  spreadOverdueBacklog,
} from "../_shared/core.mjs";

// 웹 actions.ts 의 REVIEW_LOCKED 와 같은 문장.
const REVIEW_LOCKED = "오늘의 복습(간격 반복)은 멤버십 기능이에요.";

type Action =
  | "get"
  | "daily-limit"
  | "pause"
  | "diagnosis-pause"
  | "study-phase"
  | "spread"
  | "restore";

const ACTIONS: Action[] = [
  "get",
  "daily-limit",
  "pause",
  "diagnosis-pause",
  "study-phase",
  "spread",
  "restore",
];

// 웹이 isPremium 뒤에 둔 것과 같은 목록(actions.ts:347-372, 330-341, 375-383).
// study-phase 는 웹에도 게이트가 없다(파생값 저장이라 무료 사용자의 헤드라인도 이걸 쓴다).
// diagnosis-pause 는 AI 진단 화면의 설정이고, 그 기능의 게이트는 진단 화면·diagnosis-request
// 쪽에 있다(§8.3 "AI 약점 진단" 행) — 여기서 한 번 더 막지 않는다(웹 규칙에도 게이트가 없다).
const PREMIUM_ACTIONS: Action[] = ["daily-limit", "pause", "spread", "restore"];

// 규칙이 돌려주는 거절 문구 중 "입력이 틀렸다"(400)인 것. 나머지 저장 실패는 500.
const BAD_REQUEST_ERRORS = new Set(["고를 수 없는 값이에요.", "잘못된 접근입니다."]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  // 빈 body 는 읽기로 본다 — 앱이 설정 화면을 열 때 `{}` 만 보내면 된다.
  const action = (typeof body?.action === "string" && body.action ? body.action : "get") as Action;
  if (!ACTIONS.includes(action)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = coreAdmin();
  const now = testOverrides(req).now ?? new Date();
  // 멤버십 판정에는 주입된 시각을 쓰지 않는다(review-due 와 같은 이유 — 시각으로 잠금을
  // 여닫는 자리를 만들지 않는다). 주입된 시각은 설정 저장의 updated_at·재분산 기준일에만.
  const premium = await isPremiumUserFor(admin, auth);
  if (PREMIUM_ACTIONS.includes(action) && !premium) {
    return json({ error: REVIEW_LOCKED }, 403);
  }

  // 액션별 추가 결과(밀린 복습 정리·되살리기의 건수). 나머지는 아래 공통 응답이 실어 보낸다.
  const extra: { spreadCount?: number; restoredCount?: number } = {};

  if (action === "daily-limit") {
    // 값 검증(DAILY_LIMIT_OPTIONS)은 규칙이 한다 — Edge 에 목록을 복사하지 않는다.
    const res = await setDailyLimit(admin, userId, Number(body?.limit), now);
    if (res.error) return json({ error: res.error }, BAD_REQUEST_ERRORS.has(res.error) ? 400 : 500);
  } else if (action === "pause" || action === "diagnosis-pause") {
    const subjectId = typeof body?.subjectId === "string" ? body.subjectId : "";
    if (!subjectId) return json({ error: "잘못된 접근입니다." }, 400);
    const paused = body?.paused === true;
    const res =
      action === "pause"
        ? // 재개(paused=false)면 규칙이 밀린 문항의 srs_due_at 을 며칠에 걸쳐 다시 뿌린다
          // (service_role 쓰기). 이게 앱이 이 테이블을 직접 못 쓰는 가장 큰 이유다.
          await setSubjectPaused(admin, admin, userId, subjectId, paused, now)
        : await setDiagnosisSubjectPaused(admin, userId, subjectId, paused, now);
    if (res.error) return json({ error: res.error }, 500);
  } else if (action === "study-phase") {
    // 국면은 core study-phase.ts 가 판정하고(웹·앱 공유 순수 함수) 여기는 그 결과를 저장만
    // 한다 — 히스테리시스의 입력이라 직전 값이 남아야 한다. 모르는 값은 받지 않는다
    // (DB 에도 review_preferences_study_phase_check 가 같은 두 값만 허용한다).
    const phase = body?.phase;
    if (phase !== "expanding" && phase !== "settling") {
      return json({ error: "잘못된 접근입니다." }, 400);
    }
    await saveStudyPhase(admin, userId, phase, now);
  } else if (action === "spread") {
    const res = await spreadOverdueBacklog(admin, admin, userId, now);
    if (res.error) return json({ error: res.error }, 500);
    extra.spreadCount = res.spreadCount ?? 0;
  } else if (action === "restore") {
    const res = await restoreSuspendedQuestions(admin, admin, userId, now);
    if (res.error) return json({ error: res.error }, 500);
    extra.restoredCount = res.restoredCount ?? 0;
  }

  // ── 공통 응답 ──────────────────────────────────────────────────────────────
  // 설정 화면의 과목 목록(scheduledCount·pendingCount)은 action:"get" 에서만, 그것도
  // 프리미엄에게만 센다 — 무료는 숫자 없는 잠긴 카드다(§8.3 "오늘의 복습" 행). 무료에게는
  // 빈 배열이 가고 premium:false 가 잠금을 말한다. 읽기 자체는 막지 않는다:
  // dailyLimit·studyPhase 는 무료 사용자의 헤드라인에도 필요하고 복습 내용이 아니다.
  const [prefs, diagnosisPaused, studyPhase, subjects] = await Promise.all([
    getReviewPrefs(admin, userId),
    getDiagnosisPausedSubjectIds(admin, userId),
    getStoredStudyPhase(admin, userId),
    action === "get" && premium ? getReviewSubjectOptions(admin, userId) : Promise.resolve(null),
  ]);

  return json({
    premium,
    dailyLimit: prefs.dailyLimit,
    pausedSubjectIds: [...prefs.pausedSubjectIds],
    diagnosisPausedSubjectIds: [...diagnosisPaused],
    studyPhase,
    ...(action === "get" ? { subjects: subjects ?? [] } : {}),
    ...extra,
  });
});
