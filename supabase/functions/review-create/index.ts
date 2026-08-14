// 섞어풀기 세션 생성. 웹 review-session.ts(createAllReviewSessionForUser)의 v1 포팅.
// 내 오답(이미지가 있는) 중 무작위로 뽑아 review_sessions/items 를 만든다. 응답에는
// 정답·출처를 절대 싣지 않는다(힌트 방지) — 이미지·선지 수만.
//
// ⚠️ 웹은 dedup(중복 시험지)·수동 표시·복습 쿨다운까지 반영한다. 이 v1 은 그걸
// 단순화했다(user_question_status wrong_count>0 기준). 상세 규칙은 웹 참고.
import { corsHeaders, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { isPremiumUser } from "../_shared/membership.ts";
import { fetchQuestionMedia } from "../_shared/media.ts";
import {
  pickReviewCandidates,
  type ReviewPickStrategy,
} from "../_shared/review-pick.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 연타·남용으로 review_sessions 가 쌓이는 걸 막는다(SECURITY.md 7번). 에러로 막지 않고
// "최근에 만든 아직 안 푼 세션"을 그대로 돌려준다 — 사용자가 버튼을 두 번 눌러도 새 세션이
// 생기는 대신 같은 문제 묶음을 이어서 풀게 되므로, 막는 느낌 없이 목적이 달성된다.
const REUSE_WINDOW_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  let onlyUnresolved = true;
  let limit = DEFAULT_LIMIT;
  // 뽑기 방식. 클라이언트가 보내는 값이라 모르는 값은 기본값으로 떨어뜨린다.
  let strategy: ReviewPickStrategy = "weighted";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.onlyUnresolved === "boolean") onlyUnresolved = body.onlyUnresolved;
    if (Number.isInteger(body?.limit)) limit = body.limit;
    if (body?.strategy === "random") strategy = "random";
  } catch {
    // 기본값 사용
  }
  limit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const admin = adminClient();

  // 복습은 멤버십 기능이다. 웹 서버 액션(app/mypage/wrong-notes/actions.ts)이 같은
  // 확인을 하고 있고, 이 함수는 앱이 부르는 같은 기능의 다른 입구다 — 여기가 열려
  // 있으면 토큰만 있으면 누구나 복습 세션을 만들 수 있어 페이월이 무의미해진다.
  if (!(await isPremiumUser(admin, userId, auth.email))) {
    return json({ error: "복습은 멤버십 기능이에요." }, 403);
  }

  // 최근에 만들고 아직 제출하지 않은 세션이 있으면 그걸 그대로 이어준다.
  {
    const since = new Date(Date.now() - REUSE_WINDOW_MINUTES * 60_000).toISOString();
    const { data: recent } = await admin
      .from("review_sessions")
      .select("id, total_questions")
      .eq("user_id", userId)
      .is("submitted_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const { data: itemRows } = await admin
        .from("review_session_items")
        .select("paper_id, question_number, position")
        .eq("session_id", recent.id)
        .order("position", { ascending: true });
      const rows = (itemRows ?? []) as {
        paper_id: string;
        question_number: number;
        position: number;
      }[];

      // 항목이 비어 있는 세션(생성 중 실패로 남은 껍데기)은 재사용하지 않고 새로 만든다.
      if (rows.length > 0) {
        const media = await fetchQuestionMedia(admin, [
          ...new Set(rows.map((r) => r.paper_id)),
        ]);
        // 새로 만들 때와 같은 모양 — 정답·출처는 싣지 않는다.
        const items = rows.map((r) => {
          const m = media.get(r.paper_id)?.get(r.question_number);
          return {
            position: r.position,
            images: m?.images ?? [],
            choiceCount: m?.choiceCount ?? 4,
          };
        });
        return json({ sessionId: recent.id, total: rows.length, items });
      }
    }
  }

  // 내 오답 문항. wrong_count·last_answered_at 은 층 정원제 추출의 재료다.
  let q = admin
    .from("user_question_status")
    .select("paper_id, question_number, wrong_count, last_answered_at")
    .eq("user_id", userId)
    .gt("wrong_count", 0);
  if (onlyUnresolved) q = q.eq("last_is_correct", false);
  const { data: statusRows, error } = await q;
  if (error) return json({ error: "오답을 불러오지 못했어요." }, 500);

  const rows = (statusRows ?? []) as {
    paper_id: string;
    question_number: number;
    wrong_count: number | null;
    last_answered_at: string | null;
  }[];
  if (rows.length === 0) {
    return json({ error: "다시 풀 오답이 없어요." }, 400);
  }

  // 이미지가 있는 문항만 출제 가능.
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const media = await fetchQuestionMedia(admin, paperIds);
  const candidates = rows
    .filter((r) => (media.get(r.paper_id)?.get(r.question_number)?.images.length ?? 0) > 0)
    .map((r) => ({
      paper_id: r.paper_id,
      question_number: r.question_number,
      wrongCount: r.wrong_count ?? 0,
      lastWrongAt: r.last_answered_at ?? "",
    }));
  if (candidates.length === 0) {
    return json({ error: "다시 풀 (이미지가 있는) 오답이 없어요." }, 400);
  }

  // 균등 무작위가 아니라 층 정원제(2번 이상 틀림 > 최근 오답 > 나머지). 오답이 수백
  // 개 쌓인 계정에서 균등 추출은 위험한 문항을 만날 확률을 계속 희석시킨다.
  const picked = pickReviewCandidates(candidates, limit, strategy);

  const { data: session, error: sErr } = await admin
    .from("review_sessions")
    .insert({
      user_id: userId,
      subject_id: null,
      scope: "subject",
      only_unresolved: onlyUnresolved,
      total_questions: picked.length,
    })
    .select("id")
    .single();
  if (sErr || !session) return json({ error: "세션 생성에 실패했어요." }, 500);

  const { error: iErr } = await admin.from("review_session_items").insert(
    picked.map((c, i) => ({
      session_id: session.id,
      paper_id: c.paper_id,
      question_number: c.question_number,
      position: i,
      selected_choice: null,
      is_correct: null,
    })),
  );
  if (iErr) {
    await admin.from("review_sessions").delete().eq("id", session.id);
    return json({ error: "세션 생성에 실패했어요." }, 500);
  }

  // 풀이용 응답 — 정답/출처 없음.
  const items = picked.map((c, i) => {
    const m = media.get(c.paper_id)?.get(c.question_number);
    return {
      position: i,
      images: m?.images ?? [],
      choiceCount: m?.choiceCount ?? 4,
    };
  });

  return json({ sessionId: session.id, total: picked.length, items });
});
