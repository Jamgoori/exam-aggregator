// 건의게시판 읽기·쓰기 전부(설계서 §6.7 #19). 웹 lib/suggestions.ts(읽기)·suggestions/actions.ts(쓰기)와
// 같은 규칙(core rules/suggestions.ts)을 부르는 다른 어댑터다.
//
// **읽기까지 여기서 하는 이유**: suggestions·suggestion_comments 는 anon/authenticated 의 SELECT 조차
// 회수돼 있다(schema.sql — 남의 비밀글 자리를 "비밀글입니다" 로 보여주려면 행을 서버가 읽고 마스킹해야
// 하고, 열면 본문이 REST 로 샌다). 게시판·공지와 달리 앱은 표를 직접 읽지 못하고, 이 함수가 목록·상세·
// 댓글도 내준다. 마스킹(canReadSuggestion·suggestionListTitle)은 규칙 안에 있다.
//
//   { action: "list", page? }                            → { items, pinnedItems, total, totalPages }
//   { action: "get", id }                                → { status: "ok", suggestion, canEdit, canDelete, canAnswer }
//                                                          | { status: "not_found" } | { status: "forbidden" }
//   { action: "comments", id }                           → { items }
//   { action: "create", title, content, isSecret, isPinned? }      → { success, id }
//   { action: "update", id, title, content, isSecret, isPinned? }  → { success, id }
//   { action: "delete", id }                             → { success, id }
//   { action: "answer", id, answer }                     → { success, id }   (관리자)
//   { action: "comment.create", suggestionId, content }  → { success, id: suggestionId }
//   { action: "comment.update", commentId, content }     → { success, id: suggestionId }
//   { action: "comment.delete", commentId }              → { success, id: suggestionId }
//
// list·get·comments 는 비로그인도 부른다(getOptionalUser — 웹 목록·상세가 비로그인에 열려 있는 것과
// 같다). 나머지는 requireUser. 관리자 판정은 board-write 와 같은 근거(admins 이메일 화이트리스트 —
// core isAdminEmail). 조회수는 get 안에서 웹 countSuggestionView 규칙대로(본인·관리자 제외) admin
// 클라이언트로 increment_suggestion_view 를 부른다 — service_role 전용 함수라 앱이 따로 부를 길이 없다.
//
// 오류(§6.9 — 본문은 `{ error }` 한국어 문구 그대로, 상태는 규칙이 준 값):
//   401 로그인 필요 · 400 검증 실패·잘못된 id · 403 권한 없음/볼 수 없는 비밀글 · 404 글·댓글 없음 ·
//   429 시간당 한도(글 10·댓글 30) · 500 저장 실패
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, getOptionalUser, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  answerSuggestion,
  countSuggestionView,
  createSuggestion,
  createSuggestionComment,
  deleteSuggestion,
  deleteSuggestionComment,
  fetchSuggestion,
  fetchSuggestionPage,
  isAdminEmail,
  readSuggestionComments,
  updateSuggestion,
  updateSuggestionComment,
} from "../_shared/core.mjs";

const READ_ACTIONS = new Set(["list", "get", "comments"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  const admin = coreAdmin();
  const action = String(body.action ?? "");

  if (READ_ACTIONS.has(action)) {
    // 비로그인은 { userId: null, isAdmin: false } — 웹 getSuggestionViewer 와 같은 모양.
    const user = await getOptionalUser(req);
    const viewer = {
      userId: user?.userId ?? null,
      isAdmin: user ? await isAdminEmail(admin, user.email) : false,
    };

    if (action === "list") {
      const raw = Number(body.page ?? 1);
      const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
      return json(await fetchSuggestionPage(admin, page, viewer));
    }

    const id = String(body.id ?? "");
    if (action === "get") {
      // uuid 모양이 아니면 PostgREST 가 22P02 를 내고 웹은 그걸 "없는 글" 로 본다 — 같은 결과를 조회
      // 없이 낸다.
      if (!isUuid(id)) return json({ status: "not_found" });
      const result = await fetchSuggestion(admin, id, viewer);
      if (result.status !== "ok") return json(result);
      await countSuggestionView(admin, id, viewer, result.suggestion.authorId);
      return json({
        ...result,
        canEdit: result.suggestion.canEdit,
        canDelete: result.suggestion.canDelete,
        canAnswer: viewer.isAdmin,
      });
    }

    // comments — 원글 접근 권한은 규칙이 다시 본다(상세와 별도 요청이라 "이미 확인했다"는 전제가 없다).
    if (!isUuid(id)) return json({ error: "글을 찾을 수 없어요." }, 404);
    const result = await readSuggestionComments(admin, id, viewer);
    if (result.status === "not_found") return json({ error: "글을 찾을 수 없어요." }, 404);
    if (result.status === "forbidden") return json({ error: "권한이 없어요." }, 403);
    return json({ items: result.items });
  }

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  // 닉네임은 규칙이 admin API 로 읽는다(세션이 없다). isAdmin 은 is_pinned 반영·남의 글 삭제·답변에 쓰인다.
  const actor = {
    userId: auth.userId,
    isAdmin: await isAdminEmail(admin, auth.email),
  };

  if (action === "create") {
    const result = await createSuggestion(admin, {
      actor,
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
      isSecret: body.isSecret === true,
      isPinned: body.isPinned === true,
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "update") {
    const result = await updateSuggestion(admin, {
      actor,
      id: String(body.id ?? ""),
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
      isSecret: body.isSecret === true,
      isPinned: body.isPinned === true,
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "delete") {
    const result = await deleteSuggestion(admin, { actor, id: String(body.id ?? "") });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "answer") {
    const result = await answerSuggestion(admin, {
      actor,
      id: String(body.id ?? ""),
      answer: String(body.answer ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.create") {
    const result = await createSuggestionComment(admin, {
      actor,
      suggestionId: String(body.suggestionId ?? ""),
      content: String(body.content ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.update") {
    const result = await updateSuggestionComment(admin, {
      actor,
      commentId: String(body.commentId ?? ""),
      content: String(body.content ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.delete") {
    const result = await deleteSuggestionComment(admin, {
      actor,
      commentId: String(body.commentId ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  return json({ error: "잘못된 요청입니다." }, 400);
});
