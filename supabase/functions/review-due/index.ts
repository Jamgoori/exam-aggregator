// "오늘의 복습"(간격 반복) — 요약·세션 생성·복습 더하기·결과 화면 일정·홈 넛지를 한
// 함수로 묶는다(설계서 §6.7 #12, §12 Phase 3). 규칙 본문은 packages/core/src/rules/
// review-queue.ts(getDueReviewSummary·collectDueQueueItems·collectExtraQueueItems·
// getSessionSchedule)와 rules/review-session.ts(findUnfinishedDueSession·
// createDueReviewSessionForUser) — 웹 mypage/wrong-notes/actions.ts 의
// createDueReviewSession·createExtraReviewSession·getReviewSchedule·getReviewNudge 와
// **같은 함수**다. 여기는 요청 파싱·멤버십 게이트·응답 직렬화만 한다.
//
//   { action: "summary" }                    → DueReviewSummary 그대로
//   { action: "create", requestId? }          → { sessionId, total, items, scope, subjectSlug,
//                                                subjectName, resumed }
//   { action: "extra", requestId? }           → 같은 모양(resumed 는 언제나 false)
//   { action: "schedule", sessionId }         → { schedule: SessionSchedule | null }
//   { action: "nudge" }                       → { todayCount, subjects: [{ name, count }] }
//
// **전부 프리미엄**(§8.3 "오늘의 복습(생성·추가·설정·복구·일정·넛지)" 행 — 무료는 숫자 없는
// 잠긴 카드). 웹은 액션마다 `isPremium` 뒤에 두고 같은 문구(REVIEW_LOCKED)를 돌려준다.
// 여기서는 다섯 액션 모두 403 + 같은 문구다 — 웹의 읽기 두 개(getReviewNudge 는 빈 값,
// getReviewSchedule 은 { premium:false })는 오류 대신 빈 응답을 주지만, 화면에 보이는 결과는
// 같다(섹션·모달을 그리지 않는다). 앱은 403 을 "잠긴 카드"로 읽는다(§8.3 "앱은 게이트를
// 실행하지 않고 결과를 그린다").
//
// **승격(promotePendingItems)은 세션 생성(create·extra)에서만 일어난다**(§6.6 "SRS") —
// summary·nudge·schedule 은 같은 후보를 읽기만 하므로 배너를 보기만 한 사용자의 진도를
// 건드리지 않는다. buildDueQueue 가 결정적이라 그래도 배너 숫자와 세션 문항 수가 같다.
//
// 앱은 SRS 를 계산하지 않는다 — 여기서 나가는 것은 전부 서버가 정한 결과다.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, testOverrides } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  collectDueQueueItems,
  collectExtraQueueItems,
  createDueReviewSessionForUser,
  findUnfinishedDueSession,
  getDueReviewSummary,
  getReviewSessionView,
  getSessionSchedule,
  isPremiumUserFor,
  toReviewSolveItems,
} from "../_shared/core.mjs";

// 웹 actions.ts 의 REVIEW_LOCKED 와 **같은 문장**(한 글자도 바꾸지 말 것 — 화면에 그대로 뜬다).
const REVIEW_LOCKED = "오늘의 복습(간격 반복)은 멤버십 기능이에요.";

type Action = "summary" | "create" | "extra" | "schedule" | "nudge";
const ACTIONS: Action[] = ["summary", "create", "extra", "schedule", "nudge"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const action = (typeof body?.action === "string" ? body.action : "") as Action;
  if (!ACTIONS.includes(action)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = coreAdmin();
  // 규칙은 "본인 행을 읽는 클라이언트"와 "service_role 팩토리"를 나눠 받는다. 웹은 앞에
  // 사용자 세션(RLS select own)을, Edge 는 admin 을 넣는다 — 규칙의 모든 조회가
  // .eq("user_id", userId) 를 명시하므로 결과 행은 같다(웹 어댑터 lib/review-queue.ts 참고).
  const adminFactory = () => admin;
  // 계약 테스트 전용 시각 주입(GONGMOA_TEST_HOOKS=1 일 때만). 평소엔 undefined.
  const now = testOverrides(req).now ?? new Date();

  // 멤버십 판정만은 **주입된 시각을 쓰지 않는다** — 해설(explanations-get)과 같은 이유다
  // (docs/agents/contract-tests.md "#9 의 제약"). 시각을 바꿔 잠금을 여닫을 수 있는 자리를
  // 만들지 않으려는 것이고, 계약 테스트의 CLOCK 은 FREE_UNTIL 뒤라 그대로 넣으면 체험이
  // 만료된 것으로 잡혀 모든 케이스가 403 이 된다. 주입된 시각은 큐·스케줄 계산에만 쓴다.
  if (!(await isPremiumUserFor(admin, auth))) {
    return json({ error: REVIEW_LOCKED }, 403);
  }

  if (action === "summary") {
    return json(await getDueReviewSummary(admin, userId, now, adminFactory));
  }

  if (action === "nudge") {
    // 웹 getReviewNudge 와 같은 값만 잘라 보낸다 — 홈 모달은 "오늘 N문항 · 과목별 몇 개"만
    // 그리므로 예보·대기 재고까지 실어 보내지 않는다(모달이 하루 한 번 뜨는 값싼 조회여야 한다).
    const summary = await getDueReviewSummary(admin, userId, now, adminFactory);
    return json({
      todayCount: summary.todayCount,
      subjects: summary.subjects.map((s: { name: string; count: number }) => ({
        name: s.name,
        count: s.count,
      })),
    });
  }

  if (action === "schedule") {
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId || !isUuid(sessionId)) return json({ error: "잘못된 접근입니다." }, 400);
    // 남의 세션·채점 전 세션은 규칙 안에서 null 이 된다(웹과 같다). 없음은 오류가 아니라
    // "그릴 일정이 없다"라서 200 + null 이다.
    const schedule = await getSessionSchedule(admin, userId, sessionId, now, adminFactory);
    return json({ schedule: schedule ?? null });
  }

  // ── 세션 생성(create·extra) ────────────────────────────────────────────────
  // requestId 멱등은 review-create 와 같은 방식이다(§6.6 "복습 세션 생성 연타"):
  // review_sessions.request_id + 부분 유니크 인덱스로 DB 가 판정한다. UUID 가 아니면
  // 무시(null)한다 — 웹도 null 이라 그때는 예전과 같은 동작이다.
  const requestId =
    typeof body?.requestId === "string" && isUuid(body.requestId) ? body.requestId : null;

  let sessionId: string | null = null;
  let resumed = false;

  if (action === "create") {
    // 두고 나온 세션이 있으면 새로 만들지 않고 그리로 보낸다(웹 createDueReviewSession 과
    // 같은 순서·같은 24시간 창). 새로 만들면 기기에 저장해 둔 답이 안 붙고(세션 id 로 키를
    // 잡는다) 미제출 세션만 쌓인다. requestId 보다 **먼저** 본다 — 웹과 같은 판정이어야
    // 한 계정이 웹·앱에서 같은 세션을 이어 푼다.
    const resumable = await findUnfinishedDueSession(admin, userId, now);
    if (resumable) {
      sessionId = resumable.sessionId;
      resumed = true;
    } else {
      const items = await collectDueQueueItems(admin, userId, now, adminFactory);
      const created = await createDueReviewSessionForUser(admin, userId, items, { requestId });
      if (created.error || !created.sessionId) {
        const message = created.error ?? "세션 생성에 실패했어요.";
        return json({ error: message }, message === "세션 생성에 실패했어요." ? 500 : 400);
      }
      sessionId = created.sessionId;
    }
  } else {
    // "복습 더하기" — 오늘치를 끝낸 사람이 대기 풀에서 한 묶음 더 당겨 푼다. 오늘 큐에
    // 남은 것이 있으면 규칙이 거절한다(웹 createExtraReviewSession 과 같다).
    const { items, error } = await collectExtraQueueItems(admin, userId, now, adminFactory);
    if (error) return json({ error }, 400);
    const created = await createDueReviewSessionForUser(admin, userId, items, { requestId });
    if (created.error || !created.sessionId) {
      const message = created.error ?? "세션 생성에 실패했어요.";
      return json({ error: message }, message === "세션 생성에 실패했어요." ? 500 : 400);
    }
    sessionId = created.sessionId;
  }

  // 풀이 화면이 바로 시작할 수 있게 review-create 와 **같은 모양**으로 문항을 싣는다
  // (정답·출처는 toReviewSolveItems 가 걷어낸다 — 계약 테스트 #13).
  const view = await getReviewSessionView(admin, admin, userId, sessionId);
  if (!view) return json({ error: "세션 생성에 실패했어요." }, 500);
  return json({
    sessionId: view.id,
    total: view.total,
    items: toReviewSolveItems(view),
    scope: view.scope,
    subjectSlug: view.subjectSlug,
    subjectName: view.subjectName,
    // 두고 나온 세션을 이어 받은 것인지. 앱은 이 값으로 "이어서 풀기" 안내를 그린다.
    resumed,
  });
});
