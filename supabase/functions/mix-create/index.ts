// 기출 섞어풀기 — 허브(/mix)·시작 화면·세션 생성·재도전(설계서 §6.7 #14, §12 Phase 3).
// 규칙 본문은 packages/core/src/rules/mix-practice.ts(buildMixPool·toMixOverview·
// buildMixHubIndex·fetchPlayableQuestionCounts·createMixSessionForUser·
// createRetryFromMixSession) — 웹 lib/mix-practice.ts·mypage/wrong-notes/actions.ts 의
// createMixSession·createRetryFromMix 와 **같은 함수**다.
//
//   { action: "hub" }                                   → MixHubIndex(급수 탭·과목 목록·단위)
//   { action: "overview", subjectSlug }                 → MixOverview(cells·levelGroups·연도 범위)
//   { action: "create", subjectSlug, levels?, yearRange?, limit?, requestId? }
//                                                       → { sessionId, total, items, scope,
//                                                           subjectSlug, subjectName,
//                                                           unseenCount, coveredAll }
//   { action: "retry", sessionId, requestId? }           → 같은 모양(unseenCount/coveredAll 없음)
//
// hub·overview 는 **로그인과 무관한 공개 통계**다(정답을 싣지 않는다). create·retry 만 사용자
// 행을 만든다. 멤버십 게이트는 없다 — 섞어풀기는 웹에서도 무료다(§8.3 첫 줄). 다만 세션
// 테이블은 정책이 0이라 생성·조회는 언제나 service_role 이다.
//
// `retry` 는 Phase 2 가 일부러 남겨 둔 자리다(섞어풀기 기록·결과 화면의 "틀린 N문항만 다시
// 풀기"). 문항 목록은 서버가 세션에서 직접 읽는다 — 클라이언트가 (문제지, 문항)을 보내면
// 채점 응답에 실리는 공식 정답이 통째로 새어 나간다(rules/review-session.ts 머리말).
//
// ── buildMixPool 의 비용 (설계서 §6.2·review-history 머리말의 경고) ────────────
// 웹은 getMixPool 을 `'use cache'`(1시간, 태그 home-data)로 감싸지만 **Edge 에는 캐시 계층이
// 없다**. 한 과목의 풀은 문제지 수백 장 × 문항 수십 개를 훑는다(exam_papers 페이지네이션 →
// paper_answers(voided) → questions!inner(question_images) 25장씩 → question_explanations
// 200문항씩). 그래서 여기서는 두 가지로 줄였다:
//   1. overview 는 `includeConcepts:false` 로 개념 조회(문항 200개당 1왕복)를 통째로 뺀다 —
//      개념은 출제 분산(pickMixQuestions)에만 쓰이고 화면 요약에는 안 쓰인다. 문항 3,000개
//      과목에서 왕복 15회가 사라진다. create 는 그대로 전체 풀을 쓴다(분산이 필요하다).
//   2. hub 는 애초에 풀을 만들지 않는다 — 목록 조회 한 번 + 집계 RPC 한 번이다(그 설계가
//      buildMixHubIndex 가 존재하는 이유). 남는 비용은 dedup 신호 조회뿐이다.
// 그래도 create 는 요청마다 과목 풀 한 벌을 만든다 — 남은 비용이고, 캐시를 규칙에 넣지 않는
// 선택의 대가다(§6.2). 아래 PUBLIC_CACHE 는 **이 어댑터 안의** 짧은 메모라 규칙은 캐시를
// 모른다. 아이솔레이트마다 따로 있고 언제든 사라질 수 있는 최선노력 캐시다(멱등 판정 같은
// 정합성에는 절대 쓰지 말 것 — §6.6 "복습 세션 생성 연타" 참고).
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, type CoreClient } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  buildMixHubIndex,
  buildMixPool,
  collapseDuplicatePapers,
  collidingPaperIds,
  createMixSessionForUser,
  createRetryFromMixSession,
  fetchExamPaperRows,
  fetchPaperIdentitySignals,
  fetchPlayableQuestionCounts,
  getReviewSessionView,
  getSubjectBySlug,
  toMixOverview,
  toReviewSolveItems,
} from "../_shared/core.mjs";

// 공개 통계(hub·overview)만 담는 아이솔레이트 지역 메모. 사용자 행은 절대 넣지 않는다.
// 웹은 같은 값을 1시간 캐시하므로 이 정도는 보수적이다.
const PUBLIC_TTL_MS = 60_000;
const publicCache = new Map<string, { at: number; value: unknown }>();

async function cachedPublic<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = publicCache.get(key);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.value as T;
  const value = await load();
  publicCache.set(key, { at: Date.now(), value });
  // 과목 수십 개 + 허브 하나. 그래도 아이솔레이트가 오래 살면 무한정 늘지 않게 잘라 둔다.
  if (publicCache.size > 64) {
    for (const [k, v] of publicCache) {
      if (Date.now() - v.at >= PUBLIC_TTL_MS) publicCache.delete(k);
    }
  }
  return value;
}

// 웹 lib/mix-practice.ts#getMixHubIndex 와 같은 조립(그쪽은 'use cache' 로 감싼다).
// 문제지 목록은 웹 all-papers.ts 와 같은 정렬·같은 dedup 통합을 거쳐야 허브 숫자가 같다 —
// 접지 않으면 직류만 다른 형제 문제지가 두 번 세어진다.
async function loadHubIndex(admin: CoreClient) {
  const [{ rows, examTypes }, subjectRes, playable] = await Promise.all([
    fetchExamPaperRows(admin),
    admin.from("subjects").select("id, slug, name"),
    fetchPlayableQuestionCounts(admin),
  ]);
  const signals = await fetchPaperIdentitySignals(admin, collidingPaperIds(rows), admin);
  return buildMixHubIndex({
    papers: collapseDuplicatePapers(rows, signals),
    examTypes,
    subjects: (subjectRes.data ?? []) as { id: string; slug: string; name: string }[],
    playable,
  });
}

type Action = "hub" | "overview" | "create" | "retry";
const ACTIONS: Action[] = ["hub", "overview", "create", "retry"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const action = (typeof body?.action === "string" ? body.action : "") as Action;
  if (!ACTIONS.includes(action)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = coreAdmin();

  if (action === "hub") {
    return json(await cachedPublic("hub", () => loadHubIndex(admin)));
  }

  if (action === "overview") {
    const slug = typeof body?.subjectSlug === "string" ? body.subjectSlug.trim() : "";
    if (!slug) return json({ error: "잘못된 접근입니다." }, 400);
    const overview = await cachedPublic(`overview:${slug}`, async () => {
      const subject = await getSubjectBySlug(admin, slug);
      if (!subject) return null;
      // 개념 없이 만든 풀 — 요약에는 쓰이지 않는다(위 머리말 1번). 이 풀을
      // createMixSessionForUser 에 넘기지 말 것.
      return toMixOverview(subject, await buildMixPool(admin, admin, subject.id, {
        includeConcepts: false,
      }));
    });
    if (!overview) return json({ error: "과목을 찾을 수 없어요." }, 404);
    return json(overview);
  }

  // 멱등 키(UUID). review-create 와 같은 방식 — review_sessions.request_id + 부분 유니크
  // 인덱스로 DB 가 판정한다(§6.6). UUID 가 아니면 무시(null): 웹도 null 이다.
  const requestId =
    typeof body?.requestId === "string" && isUuid(body.requestId) ? body.requestId : null;

  let created: { sessionId?: string; error?: string; unseenCount?: number; coveredAll?: boolean };

  if (action === "create") {
    const slug = typeof body?.subjectSlug === "string" ? body.subjectSlug.trim() : "";
    if (!slug) return json({ error: "잘못된 접근입니다." }, 400);
    // 웹 서버 액션과 같은 입력 정리: 문자열만·20자 이하·10개까지. 실제로 있는 급수인지는
    // 규칙이 풀의 levelGroups 로 다시 거른다.
    const levels = Array.isArray(body?.levels)
      ? (body.levels as unknown[])
          .filter((l): l is string => typeof l === "string" && l.length <= 20)
          .slice(0, 10)
      : [];
    const yr = body?.yearRange;
    const year = {
      from: Number.isInteger(yr?.from) ? (yr.from as number) : null,
      to: Number.isInteger(yr?.to) ? (yr.to as number) : null,
    };
    created = await createMixSessionForUser(
      admin,
      admin,
      userId,
      { subjectSlug: slug, limit: Number(body?.limit), levels, year, requestId },
      // 출제에는 개념이 필요하므로 전체 풀이다(위 머리말 1번). 캐시하지 않는다 —
      // candidates 수천 개를 아이솔레이트 메모리에 쌓을 이유가 없다.
      { getMixPool: (subjectId: string) => buildMixPool(admin, admin, subjectId) },
    );
  } else {
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId || !isUuid(sessionId)) return json({ error: "잘못된 접근입니다." }, 400);
    // 소유자·채점 여부 확인은 규칙 안에서 한다(남의 세션이면 "세션을 찾을 수 없어요.").
    created = await createRetryFromMixSession(admin, userId, sessionId, { requestId });
  }

  if (created.error || !created.sessionId) {
    const message = created.error ?? "세션 생성에 실패했어요.";
    return json({ error: message }, message === "세션 생성에 실패했어요." ? 500 : 400);
  }

  // 풀이 화면이 바로 시작할 수 있게 review-create 와 같은 모양으로 문항을 싣는다
  // (정답·출처는 toReviewSolveItems 가 걷어낸다 — 계약 테스트 #13).
  const view = await getReviewSessionView(admin, admin, userId, created.sessionId);
  if (!view) return json({ error: "세션 생성에 실패했어요." }, 500);
  return json({
    sessionId: view.id,
    total: view.total,
    items: toReviewSolveItems(view),
    scope: view.scope,
    subjectSlug: view.subjectSlug,
    subjectName: view.subjectName,
    // create 에서만. "처음 보는 문항 N개" 안내와 "이 과목 기출을 한 바퀴 돌았다" 배지.
    ...(action === "create"
      ? { unseenCount: created.unseenCount ?? 0, coveredAll: created.coveredAll === true }
      : {}),
  });
});
