// 섞어풀기·복습 채점. 규칙 본문은 packages/core/src/rules/review-session.ts#
// submitReviewSessionForUser(웹 actions.ts#submitReviewSession 과 같은 함수) — 세션 선점·
// 정답 조회·채점·문항 상태(source = scope==="mix" ? "mix" : "review")·dedup 되짚기·출석까지
// 전부 거기서 한다. 여기는 요청 파싱과 service_role 클라이언트 주입, 응답 직렬화만 한다.
//
// 세션은 채점 **전에** 선점된다(설계서 §6.6 "복습 제출 중복") — 웹+앱 동시 제출이나 앱
// 타임아웃 재시도가 겹쳐도 한쪽만 채점된다. 나머지는 "이미 채점된 세션이에요."(400)를
// 받는데, 앱은 그 오류를 받으면 review-history {sessionId} 로 채점 뷰를 가져온다.
//
// 응답(추가만): { score, total, items: [{ position, images, choiceCount, selectedChoice,
// correctChoice, isCorrect, paperTitle, questionNumber, guessed, paperId }], sessionId, scope,
// subjectSlug, subjectName, createdAt } — guessed·paperId·scope 이하가 §6.7 #9 로 추가된 필드.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, testOverrides } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { submitReviewSessionForUser, toReviewResultItems } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  let sessionId = "";
  let answers: (number | null)[] = [];
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId ?? "");
    answers = Array.isArray(body?.answers) ? body.answers : [];
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!sessionId || !isUuid(sessionId)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = coreAdmin();
  // now·fuzz 는 계약 테스트 전용 주입(GONGMOA_TEST_HOOKS=1 일 때만 헤더를 읽는다). 평소엔
  // 둘 다 undefined 라 규칙의 기본값(new Date()·Math.random)으로 돈다.
  const test = testOverrides(req);
  const result = await submitReviewSessionForUser(admin, admin, auth.userId, sessionId, answers, {
    now: test.now,
    questionStatus: test.fuzz ? { fuzz: test.fuzz } : undefined,
  });
  if (result.error || !result.view) {
    return json({ error: result.error ?? "채점에 실패했어요." }, result.status ?? 500);
  }

  const view = result.view;
  return json({
    score: view.score ?? 0,
    total: view.total,
    items: toReviewResultItems(view),
    sessionId: view.id,
    scope: view.scope,
    subjectSlug: view.subjectSlug,
    subjectName: view.subjectName,
    createdAt: view.createdAt,
  });
});
