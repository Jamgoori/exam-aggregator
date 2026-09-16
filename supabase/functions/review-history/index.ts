// 섞어풀기·복습 기록 조회. review_sessions / review_session_items 는 RLS 를 켜두고 정책을
// 하나도 두지 않아(schema.sql) 클라이언트가 직접 못 읽는다 — 세션에 어떤 문항이 들어
// 있는지가 곧 "정답을 아직 모르는 출제 목록"이라서다. 그래서 service_role 로만 돌려준다.
// 규칙 본문은 packages/core/src/rules/review-session.ts(getReviewSessionView — 웹 결과
// 화면과 같은 함수, listSubmittedReviewSessions).
//
// 네 가지 응답:
//   body 없음 / { scope?, subjectSlug?, limit? }
//     → 내 기록 목록(채점 완료분만): { sessions: [{ sessionId, scope, subjectName, total, score,
//       submittedAt, subjectSlug, createdAt }] } (subjectSlug·createdAt 은 추가 필드)
//       `scope:"mix"` + `subjectSlug` 로 물으면 각 항목에 **`title`·`wrongCount`·`resolvedCount`
//       가 더 실린다**(전부 추가 필드 — 옛 앱·다른 호출은 그대로다). 웹 과목 오답노트의
//       섞어풀기 기록 카드(lib/mix-practice.ts#listMixSessions)와 같은 값이라 앱 MixSessionList
//       가 "12문항 중 5개 틀림 · 3개 극복"을 그릴 수 있다. Phase 2 가 이 세 값이 없어 그
//       화면을 미뤘다(§12-4 "Phase 3 로 넘긴 것" — 믹스 기록 목록).
//   { sessionId }
//     → 그 세션의 문항별 결과(review-submit 응답과 같은 모양): { score, total, items,
//       sessionId, scope, subjectSlug, subjectName, submitted, createdAt }
//   { sessionId, includeUnsubmitted: true }
//     → 아직 채점 전인 세션도 돌려준다(답·정답·출처 없이 images/choiceCount/position 만,
//       score null, submitted false) — 앱이 다른 기기에서 만든 세션을 이어 풀 때 쓴다(§6.7 #10).
//       옵션 없이 채점 전 세션을 물으면 예전대로 400.
//   { sessionId, view: "mix-note" }
//     → 위 상세 응답 + `mixNote`(기출 섞어풀기 한 세션의 오답노트 — 웹
//       /mypage/wrong-notes/[slug]/mix/[sessionId] 와 같은 값, 규칙 getMixSessionWrongNote).
//       추가 필드라 옛 앱은 그대로 상세만 읽으면 된다. 채점 전 세션이면 예전대로 400,
//       남의 세션이거나 섞어풀기(scope='mix')가 아니면 404.
//   { view: "last-choices", subjectSlug }
//     → 그 과목에서 **내가 마지막으로 틀렸을 때 고른 답**:
//       { choices: [{ paperId, questionNumber, selectedChoice }] }. 정답은 실리지 않는다 —
//       내가 골랐던 답이라 이미 내 것이다. 앱 오답노트가 "응시 없이 채점된 오답"(기출
//       섞어풀기·같은개념 기출)을 목록에 보탤 때 쓴다: 그 문항은 user_question_status 에만
//       있어 앱이 목록에는 넣을 수 있지만, 고른 답은 review_session_items(정책 0개)에 있어
//       못 읽는다(§9 "상태 전용 오답(mix) 합산·마지막 선택"). 규칙은 웹 오답노트와 같은
//       함수(fetchLastWrongChoices). 없는 과목이면 빈 배열이다.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  buildMixPool,
  fetchLastWrongChoices,
  getMixSessionWrongNote,
  getReviewSessionView,
  getSubjectBySlug,
  isPremiumUserFor,
  listMixSessions,
  listSubmittedReviewSessions,
  toReviewResultItems,
} from "../_shared/core.mjs";

const LIST_LIMIT = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";

  const admin = coreAdmin();

  // ── 마지막에 고른 답(상태 전용 오답 합산) ────────────────────────────────
  // sessionId 와 무관한 조회라 목록 분기보다 **먼저** 갈라낸다.
  if (body?.view === "last-choices") {
    const slug = typeof body?.subjectSlug === "string" ? body.subjectSlug.trim() : "";
    if (!slug) return json({ error: "잘못된 접근입니다." }, 400);
    try {
      const subject = await getSubjectBySlug(admin, slug);
      // 없는 과목은 404 가 아니라 빈 배열이다 — 호출부(오답노트)는 이 값이 없어도 목록을
      // 그려야 하고, 여기서 화면을 떨어뜨릴 이유가 없다.
      if (!subject) return json({ choices: [] });
      const map = await fetchLastWrongChoices(admin, userId, subject.id);
      const choices: { paperId: string; questionNumber: number; selectedChoice: number | null }[] =
        [];
      for (const [key, selectedChoice] of map) {
        const sep = key.lastIndexOf("#");
        if (sep <= 0) continue;
        choices.push({
          paperId: key.slice(0, sep),
          questionNumber: Number(key.slice(sep + 1)),
          selectedChoice,
        });
      }
      return json({ choices });
    } catch {
      // 곁다리 값이라 실패해도 화면은 목록을 그린다 — 200 + 빈 배열로 떨어뜨린다.
      return json({ choices: [] });
    }
  }

  // ── 목록 ──────────────────────────────────────────────────────────────────
  if (!sessionId) {
    const scope = typeof body?.scope === "string" ? body.scope : null;
    const subjectSlug = typeof body?.subjectSlug === "string" ? body.subjectSlug : null;
    try {
      const rows = await listSubmittedReviewSessions(admin, userId, {
        scope,
        subjectSlug,
        limit: Number.isInteger(body?.limit) ? body.limit : LIST_LIMIT,
      });

      // 과목 하나의 섞어풀기 기록이면 웹 카드와 같은 값(같은 날 순번이 붙은 제목·틀린 수·
      // 극복 수)을 규칙 listMixSessions 에서 그대로 가져와 얹는다. 과목을 특정해야만 하는
      // 계산이라(극복 판정이 그 과목의 dedup 대표 매핑을 쓴다) 다른 조합에서는 얹지 않는다 —
      // 그때는 예전 그대로다. 개념(concept_id)은 여기서 쓰이지 않으므로 풀을 개념 없이
      // 만든다(mix-create 머리말 참고 — Edge 에는 캐시가 없어 왕복 하나가 그대로 비용이다).
      const extras = new Map<string, { title: string; wrongCount: number; resolvedCount: number }>();
      if (scope === "mix" && subjectSlug && rows.length > 0) {
        try {
          const subject = await getSubjectBySlug(admin, subjectSlug);
          if (subject) {
            const summaries = await listMixSessions(admin, admin, userId, subject.id, {
              getMixPool: (subjectId: string) =>
                buildMixPool(admin, admin, subjectId, { includeConcepts: false }),
            });
            for (const s of summaries) {
              extras.set(s.id, {
                title: s.title,
                wrongCount: s.wrongCount,
                resolvedCount: s.resolvedCount,
              });
            }
          }
        } catch {
          // 무시: 추가 필드가 없으면 앱이 개수 없이 그린다(목록 자체를 잃는 것보다 낫다).
        }
      }

      return json({
        sessions: rows.map((s) => ({
          sessionId: s.sessionId,
          scope: s.scope,
          subjectName: s.subjectName,
          total: s.total,
          score: s.score,
          submittedAt: s.submittedAt,
          subjectSlug: s.subjectSlug,
          createdAt: s.createdAt,
          ...(extras.get(s.sessionId) ?? {}),
        })),
      });
    } catch {
      return json({ error: "기록을 불러오지 못했어요." }, 500);
    }
  }

  // ── 세션 상세 ─────────────────────────────────────────────────────────────
  if (!isUuid(sessionId)) return json({ error: "잘못된 접근입니다." }, 400);

  // 남의 세션 id 로는 아무것도 나오지 않게 소유자를 규칙 안에서 확인한다(null).
  const view = await getReviewSessionView(admin, admin, userId, sessionId);
  if (!view) return json({ error: "세션을 찾을 수 없어요." }, 404);
  if (!view.submitted && body?.includeUnsubmitted !== true) {
    return json({ error: "아직 채점하지 않은 세션이에요." }, 400);
  }

  const detail = {
    score: view.submitted ? (view.score ?? 0) : null,
    total: view.total,
    items: toReviewResultItems(view),
    sessionId: view.id,
    scope: view.scope,
    subjectSlug: view.subjectSlug,
    subjectName: view.subjectName,
    submitted: view.submitted,
    createdAt: view.createdAt,
  };

  // ── mix 기록 뷰 ───────────────────────────────────────────────────────────
  // 해설 본문을 실을지는 오답노트와 같은 기준(멤버십)이다 — 웹 mix 기록 페이지도
  // isPremium 을 그대로 includeExplanations 로 넘긴다. 쿼터·로그는 건드리지 않는다
  // (오답노트 안의 해설이라 explanations-get 의 wrong-note 모드와 같은 규칙).
  // getMixPool 은 웹에서 'use cache' 로 감싸는 무거운 조회인데 Edge 에는 캐시 계층이
  // 없어 매 요청 다시 만든다(규칙이 캐시를 모르게 두려는 §6.2 의 선택 — 앞으로 생길
  // mix-create 도 같은 방식이다).
  if (body?.view === "mix-note") {
    const note = await getMixSessionWrongNote(
      admin,
      admin,
      userId,
      sessionId,
      await isPremiumUserFor(admin, auth),
      { getMixPool: (subjectId: string) => buildMixPool(admin, admin, subjectId) },
    );
    // 남의 세션·채점 전·섞어풀기가 아닌 세션은 전부 null(규칙 안에서 확인).
    if (!note) return json({ error: "세션을 찾을 수 없어요." }, 404);
    return json({ ...detail, mixNote: note });
  }

  return json(detail);
});
