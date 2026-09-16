// "찍었어요" — 채점 결과 화면에서 맞힌 문항의 복습 스케줄만 되돌린다(설계서 §6.7 #11).
// 규칙 본문은 packages/core/src/rules/review-session.ts#markReviewItemGuessed — 웹
// mypage/wrong-notes/actions.ts#markReviewGuessed 와 **같은 함수**다. 여기는 요청 파싱과
// service_role 클라이언트 주입, 응답 직렬화만 한다.
//
//   { sessionId, position } → { ok: true }
//
// **RPC 로 만들지 않은 이유**(§6.7 #11, docs/agents/mobile-parity.md "EF 인가 RPC 인가"):
// 이 동작의 핵심은 `srsGuessed(...)` 가 정하는 다음 복습 시각(SRS_RELEARN_DELAY_HOURS = 3)
// 이다. SQL 안에 `now() + interval '3 hours'` 를 적으면 SRS 상수가 packages/core/src/srs.ts
// 밖의 **세 번째 장소**에 생기고(웹·core.mjs 번들에 이어), `bundle-edge:check` 는 SQL 을
// 검사하지 못해 어긋나도 CI 가 못 잡는다(AGENTS.md "SRS 상수" 금지선). 게다가 RPC 로 열면
// authenticated 에 열린 유일한 `user_question_status` 쓰기 경로가 되어 "이 테이블에는 쓰기
// 정책이 없다"는 원칙에 예외가 생긴다.
//
// 멤버십으로 막지 않는다(§8.3 "찍었어요" 행 — 무료·프리미엄 모두 ✓). 표시
// (review_session_items.guessed)는 무료 사용자에게도 남겨야 나중에 결제했을 때 "그때 찍었다고
// 눌러둔 것"이 살아 있고, 스케줄이 없는 문항은 규칙 안에서 조용히 넘어간다.
//
// 단방향·멱등(§6.6 "SRS"): 여러 번 눌러도 결과가 같다(상태는 그대로 두고 due 만 다시 잡는다).
// 되돌리는(=취소하는) 요청은 받지 않는다 — 그 자리가 있으면 사용자가 맞힌 문항의 복습일을
// 임의로 당겼다 미룰 수 있게 된다.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, testOverrides } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { markReviewItemGuessed } from "../_shared/core.mjs";

// 규칙이 돌려주는 거절 문구 → HTTP 상태. 웹 서버 액션은 상태 없이 { error } 만 주지만
// (클라이언트가 문구만 그린다) 앱은 상태로 분기하므로 여기서 매긴다.
const NOT_FOUND = new Set(["세션을 찾을 수 없어요.", "문항을 찾을 수 없어요."]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const position = Number(body?.position);
  // 웹 액션과 같은 검증(문자열 id·정수 position ≥ 0)에 Edge 공통 UUID 검사를 더한다.
  if (!sessionId || !isUuid(sessionId) || !Number.isInteger(position) || position < 0) {
    return json({ error: "잘못된 접근입니다." }, 400);
  }

  // now 는 계약 테스트 전용 주입(GONGMOA_TEST_HOOKS=1 일 때만 헤더를 읽는다). 평소엔
  // undefined 라 규칙의 기본값(new Date())으로 돈다 — srs_due_at 이 그 시각으로 계산되므로
  // 웹 경로와 같은 값을 비교하려면 주입이 필요하다.
  const test = testOverrides(req);
  const result = await markReviewItemGuessed(
    coreAdmin(),
    auth.userId,
    sessionId,
    position,
    test.now,
  );
  if (result.error) return json({ error: result.error }, NOT_FOUND.has(result.error) ? 404 : 400);
  return json({ ok: true });
});
