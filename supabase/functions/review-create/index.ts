// 섞어풀기·복습 세션 생성. 규칙 본문은 packages/core/src/rules/review-session.ts —
// 웹 mypage/wrong-notes/actions.ts 의 createReviewSession/createReviewAll/
// createReviewFromPapers/createReviewFromWrong/createReviewFromConcept 과 같은 함수를
// 부른다(설계서 §6.7 #8). 예전 v1 은 "user_question_status wrong_count>0" 만 보는 단순화
// 포팅이라 dedup 대표 접기·삭제 마크·복습 쿨다운이 빠져 있었고, 30분 안에 만든 미제출
// 세션을 그대로 돌려주는 재사용(REUSE_WINDOW_MINUTES)이 있었다 — 둘 다 없앴다. 연타
// 멱등은 요청의 requestId(앱이 생성마다 새 UUID)로만 한다(§6.6 "복습 세션 생성 연타").
//
// 요청(전부 optional — 아무것도 없으면 예전과 같은 "전 과목 미극복 오답 20문항"):
//   subjectSlug        과목 섞어풀기(웹 createReviewSession). onlyUnresolved·onlyDue·limit·strategy
//   paperIds[]         시험지별 틀린 문제 다시 풀기(웹 createReviewFromPapers)
//   items[]            결과 화면 "틀린 문항만 다시 풀기"(웹 createReviewFromWrong) —
//                      서버가 filterQuestionsAnsweredByUser 로 "내가 푼 문항"만 남긴다
//   conceptId/concept  같은개념 기출(웹 createReviewFromConcept, 유료)
//   (없음)             전 과목(웹 createReviewAll). onlyDue·includeResolved·strategy·limit
//   onlyDue            복습(간격 반복 lite) — 유료. 웹과 같은 멤버십 확인.
//   requestId          멱등 키(UUID). 같은 값이면 언제나 같은 세션.
//
// 응답: { sessionId, total, items: [{ position, images, choiceCount }], scope, subjectSlug,
// subjectName } — 정답·출처(paperId/correctChoice/paperTitle/questionNumber)는 절대 싣지
// 않는다(toReviewSolveItems, 계약 테스트 13번). scope 이하는 추가 필드.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  createAllReviewSessionForUser,
  createConceptReviewSessionForUser,
  createPaperReviewSessionForUser,
  createReviewSessionForUser,
  createReviewSessionFromItems,
  filterQuestionsAnsweredByUser,
  getReviewSessionView,
  isPremiumUserFor,
  toReviewSolveItems,
  type ReviewPickStrategy,
} from "../_shared/core.mjs";

// 앱의 기본 문항 수. 웹 전 과목판은 50(REVIEW_SESSION_MAX_LIMIT)까지 담지만 앱은 예전
// v1 부터 20 이었다 — 요청에 limit 이 없으면 그대로 20.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 웹 actions.ts 와 같은 문구·같은 기준: 섞어풀기는 무료, 복습(onlyDue)·같은개념 기출은 멤버십.
const REVIEW_LOCKED = "오늘의 복습(간격 반복)은 멤버십 기능이에요.";

type Body = {
  subjectSlug?: unknown;
  onlyUnresolved?: unknown;
  includeResolved?: unknown;
  onlyDue?: unknown;
  paperIds?: unknown;
  items?: unknown;
  conceptId?: unknown;
  concept?: unknown;
  limit?: unknown;
  strategy?: unknown;
  requestId?: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body: Body = await req.json().catch(() => ({}));
  const onlyUnresolved = typeof body.onlyUnresolved === "boolean" ? body.onlyUnresolved : true;
  const onlyDue = body.onlyDue === true;
  const includeResolved =
    typeof body.includeResolved === "boolean" ? body.includeResolved : !onlyUnresolved;
  const limit = Number.isInteger(body.limit)
    ? Math.min(Math.max(1, body.limit as number), MAX_LIMIT)
    : DEFAULT_LIMIT;
  // 뽑기 방식. 클라이언트가 보내는 값이라 모르는 값은 기본값으로 떨어뜨린다.
  const strategy: ReviewPickStrategy = body.strategy === "random" ? "random" : "weighted";
  const requestId = typeof body.requestId === "string" && isUuid(body.requestId) ? body.requestId : null;
  const subjectSlug = typeof body.subjectSlug === "string" ? body.subjectSlug.trim() : "";
  const paperIds = Array.isArray(body.paperIds)
    ? (body.paperIds as unknown[]).filter((id): id is string => typeof id === "string" && isUuid(id))
    : [];
  const items = Array.isArray(body.items)
    ? (body.items as { paperId?: unknown; questionNumber?: unknown }[]).map((it) => ({
        paperId: String(it?.paperId ?? ""),
        questionNumber: Number(it?.questionNumber),
      }))
    : [];
  const conceptId = typeof body.conceptId === "string" && body.conceptId ? body.conceptId : null;
  const concept = typeof body.concept === "string" ? body.concept.trim() : "";

  const admin = coreAdmin();

  // 멤버십: 섞어풀기(내 오답 다시 풀기)는 무료 — 웹의 같은 기능도 열려 있다. 복습(onlyDue)과
  // 같은개념 기출만 웹 서버 액션과 같은 기준으로 잠근다.
  if (onlyDue || conceptId || concept) {
    if (!(await isPremiumUserFor(admin, { userId, email: auth.email }))) {
      return json({ error: REVIEW_LOCKED }, 403);
    }
  }

  let created: { sessionId?: string; error?: string };
  if (paperIds.length > 0) {
    created = await createPaperReviewSessionForUser(admin, admin, userId, paperIds, { requestId });
  } else if (items.length > 0) {
    const mine = await filterQuestionsAnsweredByUser(admin, items, userId);
    created =
      mine.length === 0
        ? { error: "다시 풀 문항이 없어요." }
        : await createReviewSessionFromItems(admin, userId, mine, MAX_LIMIT, { requestId });
  } else if (conceptId || concept) {
    created = await createConceptReviewSessionForUser(admin, admin, userId, {
      concept,
      conceptId,
      subjectSlug: subjectSlug || null,
      limit: Number.isInteger(body.limit) ? limit : 5,
      requestId,
    });
  } else if (subjectSlug) {
    created = await createReviewSessionForUser(admin, admin, userId, {
      subjectSlug,
      onlyUnresolved,
      onlyDue,
      limit,
      strategy,
      requestId,
    });
  } else {
    created = await createAllReviewSessionForUser(admin, admin, userId, {
      onlyDue,
      includeResolved,
      strategy,
      limit,
      requestId,
    });
  }

  if (created.error || !created.sessionId) {
    const message = created.error ?? "세션 생성에 실패했어요.";
    return json({ error: message }, message === "세션 생성에 실패했어요." ? 500 : 400);
  }

  const view = await getReviewSessionView(admin, admin, userId, created.sessionId);
  if (!view) return json({ error: "세션 생성에 실패했어요." }, 500);

  return json({
    sessionId: view.id,
    total: view.total,
    items: toReviewSolveItems(view),
    scope: view.scope,
    subjectSlug: view.subjectSlug,
    subjectName: view.subjectName,
  });
});
