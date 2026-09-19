// 공지 **댓글** 작성·수정·삭제(설계서 §6.7 #17 계열). 웹 서버 액션 app/notices/actions.ts 의
// createNoticeComment/updateNoticeComment/deleteNoticeComment 와 같은 규칙(core rules/notices.ts)
// 을 부르는 다른 어댑터다.
//
//   { action: "comment.create", noticeId, content } → { success, id: noticeId }
//   { action: "comment.update", commentId, content } → { success, id: noticeId }
//   { action: "comment.delete", commentId }          → { success, id: noticeId }
//
// notice_comments 는 RLS("insert own"·"update own"·"delete own or admin")로 앱이 직접 쓸 수도
// 있지만, 시간당 30건·비속어·닉네임 확정(클라이언트 값을 믿지 않는다)을 웹과 같은 규칙으로
// 강제하려면 이 함수를 지나야 한다. 규칙은 admin 클라이언트로 불려도 남의 댓글에 닿지 않게
// 본문에 소유자 조건을 명시한다(rules/notices.ts 머리말).
//
// 공지 **원글**의 작성·수정·삭제는 관리자 전용이라 앱에 없고(§5 — /notices/new·edit 는 AASA
// 제외) 여기에도 없다. 관리자 판정(남의 댓글 삭제)은 웹 is_admin() 과 같은 근거 — core isAdminEmail.
//
// 오류: 401 로그인 필요 · 400 검증 실패·잘못된 id · 403 권한 없음 · 404 댓글 없음 ·
//       429 시간당 한도 · 500 저장 실패
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  createNoticeComment,
  deleteNoticeComment,
  isAdminEmail,
  updateNoticeComment,
} from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  const admin = coreAdmin();
  const action = String(body.action ?? "");
  const actor = {
    userId: auth.userId,
    isAdmin: await isAdminEmail(admin, auth.email),
  };

  if (action === "comment.create") {
    const result = await createNoticeComment(admin, {
      actor,
      noticeId: String(body.noticeId ?? ""),
      content: String(body.content ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.update") {
    const result = await updateNoticeComment(admin, {
      actor,
      commentId: String(body.commentId ?? ""),
      content: String(body.content ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.delete") {
    const result = await deleteNoticeComment(admin, {
      actor,
      commentId: String(body.commentId ?? ""),
    });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  return json({ error: "잘못된 요청입니다." }, 400);
});
