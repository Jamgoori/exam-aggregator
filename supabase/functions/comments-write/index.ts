// 댓글 작성/수정/삭제. comments 테이블은 anon/authenticated 에 select 컬럼 권한만 주고
// 쓰기 권한을 전부 revoke 해뒀다(schema.sql) — 비회원 댓글 비밀번호 검증과 닉네임 위조
// 방지를 서버에서만 하기 위해서다. 웹은 서버 액션(service_role)으로 쓰는데, 앱에는 그
// 경로가 없어 클라이언트에서 직접 insert/delete 를 시도하고 있었고 권한이 없어 실패했다.
// 이 함수가 앱의 서버 액션 역할을 한다.
//
// 앱은 로그인 사용자 댓글만 다룬다(비회원 댓글은 웹 전용 password_hash 방식). 닉네임은
// 클라이언트 값을 믿지 않고 서버가 user_metadata 에서 읽어 채운다.
import { corsHeaders, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { profanityError } from "../_shared/profanity.ts";

// @gongmoa/core 의 COMMENT_CONTENT_MAX 와 같은 값(모노레포 밖이라 import 하지 않고 고정).
// DB 에도 comments_content_len(1~2000) 제약이 있어 최종 방어선은 스키마다.
const CONTENT_MAX = 2000;

// @gongmoa/core 의 COMMENT_MAX_DEPTH 와 같은 값. 원댓글 1, 대댓글 2, 대대댓글 3까지.
const MAX_DEPTH = 3;

type Action = "create" | "update" | "delete";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  const action = body.action as Action;
  const admin = adminClient();

  if (action === "create") {
    const paperId = String(body.paperId ?? "");
    const content = String(body.content ?? "").trim();
    const parentId = body.parentId ? String(body.parentId) : null;
    if (!paperId || !content) return json({ error: "내용을 입력해 주세요." }, 400);
    if (content.length > CONTENT_MAX) return json({ error: "내용이 너무 길어요." }, 400);
    // 비속어 차단. 웹 서버 액션(app/papers/actions.ts)과 같은 목록을 쓴다.
    const badWord = profanityError(content);
    if (badWord) return json({ error: badWord }, 400);

    // 답글 깊이 제한(웹 papers/actions.ts 와 같은 규칙). 클라이언트가 보낸 parentId 라
    // 부모를 따라 올라가며 깊이를 세고 한도에 닿았으면 거절한다.
    if (parentId) {
      const { data: parent } = await admin
        .from("comments")
        .select("id, paper_id, parent_id")
        .eq("id", parentId)
        .maybeSingle();
      if (!parent || parent.paper_id !== paperId) {
        return json({ error: "답글을 달 수 없는 댓글이에요." }, 400);
      }

      let depth = 1;
      let cursor = parent.parent_id as string | null;
      while (cursor) {
        depth++;
        if (depth >= MAX_DEPTH) break;
        const { data: up } = await admin
          .from("comments")
          .select("parent_id")
          .eq("id", cursor)
          .maybeSingle();
        cursor = (up?.parent_id as string | null) ?? null;
      }
      if (depth >= MAX_DEPTH) {
        return json({ error: "여기에는 더 답글을 달 수 없어요." }, 400);
      }
    }

    // 닉네임은 서버가 정한다 — 클라이언트가 남의 이름으로 쓰지 못하게.
    const { data: userRow } = await admin.auth.admin.getUserById(userId);
    const meta = userRow?.user?.user_metadata as { nickname?: string } | undefined;
    const nickname = meta?.nickname ?? userRow?.user?.email?.split("@")[0] ?? "회원";

    const { error } = await admin.from("comments").insert({
      paper_id: paperId,
      user_id: userId,
      nickname,
      content,
      parent_id: parentId,
    });
    if (error) return json({ error: "등록에 실패했어요." }, 500);
    return json({ ok: true });
  }

  if (action === "update") {
    const commentId = String(body.commentId ?? "");
    const content = String(body.content ?? "").trim();
    if (!commentId || !content) return json({ error: "내용을 입력해 주세요." }, 400);
    if (content.length > CONTENT_MAX) return json({ error: "내용이 너무 길어요." }, 400);
    const badWord = profanityError(content);
    if (badWord) return json({ error: badWord }, 400);

    // service_role 은 RLS 를 우회하므로 소유자 확인을 여기서 명시적으로 한다.
    const { data: row } = await admin
      .from("comments")
      .select("id, user_id")
      .eq("id", commentId)
      .maybeSingle();
    if (!row || row.user_id !== userId) {
      return json({ error: "내 댓글만 수정할 수 있어요." }, 403);
    }

    const { error } = await admin
      .from("comments")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", commentId);
    if (error) return json({ error: "수정에 실패했어요." }, 500);
    return json({ ok: true });
  }

  if (action === "delete") {
    const commentId = String(body.commentId ?? "");
    if (!commentId) return json({ error: "잘못된 접근입니다." }, 400);

    const { data: row } = await admin
      .from("comments")
      .select("id, user_id")
      .eq("id", commentId)
      .maybeSingle();
    if (!row || row.user_id !== userId) {
      return json({ error: "내 댓글만 삭제할 수 있어요." }, 403);
    }

    // 답글은 parent_id 의 on delete cascade 로 함께 지워진다.
    const { error } = await admin.from("comments").delete().eq("id", commentId);
    if (error) return json({ error: "삭제에 실패했어요." }, 500);
    return json({ ok: true });
  }

  return json({ error: "잘못된 요청입니다." }, 400);
});
