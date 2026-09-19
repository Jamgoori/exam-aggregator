import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BOARD_CONTENT_HTML_MAX,
  canDeleteBoardComment,
  canDeleteBoardPost,
  canEditBoardComment,
  canEditBoardPost,
  canPinBoardPost,
  resolveBoardCommentParent,
  validateBoardCommentContent,
  validateBoardPostInput,
  type BoardPostInputOk,
  type BoardViewer,
} from "../board";
import { boardImageBytesError } from "../board-image";
import { authorNickname } from "../nickname";
import { notificationPreview } from "../notifications";
import { isPaperUuid } from "../paper-slug";
import { firstImageSrc, sanitizeRichText } from "../rich-text";
import {
  BOARD_HOURLY_COMMENT_LIMIT,
  BOARD_HOURLY_IMAGE_LIMIT,
  BOARD_HOURLY_POST_LIMIT,
  HOURLY_LIMIT_ERROR,
  overHourlyLimit,
} from "./hourly-limit";
import { createNotification } from "./notify";

// 자유게시판 쓰기 규칙. 웹 서버 액션(app/board/actions.ts)과 Edge Function(board-write)이
// 이 함수들의 얇은 어댑터다 — 웹 actions.ts 에 있던 본문을 **그대로** 옮겨 왔고, 문구·순서·
// 반환 모양을 새로 짓지 않았다. 한쪽에만 규칙이 있으면 웹에서 막히는 글이 앱에서는
// 들어가는 버그다(AGENTS.md "모바일 파리티").
//
// 인자 규칙(rules/avatar.ts 와 같다):
//   client — service_role 클라이언트. board_posts·board_comments 는 insert/update/delete 가
//            전부 회수돼 있어(schema.sql) 쓰기는 service_role 로만 한다. 열지 않는 이유: 본문
//            HTML 은 반드시 아래 새니타이저를 지나야 하는데, 정책을 열면 REST 로 그 관문을
//            지나가는 길이 생긴다.
//   actor  — 세션에서 확정한 사용자. 닉네임은 **클라이언트가 보내는 값을 믿지 않고**
//            user_metadata 에서 읽는다(남의 이름으로 글을 쓰지 못하게). 웹은 세션에 이미 있는
//            값을 넘기고, Edge 는 없으면 admin API 로 읽는다(resolveNickname).
//   deps.imageOrigin — 본문 이미지의 공개 URL 접두사(board-image.ts#boardImageOrigin).
//            새니타이저가 이 접두사로 시작하는 <img> 만 남긴다.
//
// **순서가 곧 금지선이다: 새니타이즈 → 검증 → 저장.** 검증을 원본 HTML 에 대고 하면
// "검사에는 통과했는데 저장된 건 다른 것"이 되고, 그 틈이 곧 저장형 XSS 다
// (docs/agents/board-rich-text.md §1).

export type BoardActor = BoardViewer & {
  userId: string;
  // user_metadata.nickname 원본. 웹은 세션에서 넘기고 Edge 는 생략한다(admin 으로 읽는다).
  metadataNickname?: unknown;
};

// 실패는 문구와 **HTTP 상태**를 함께 돌려준다(rules/avatar.ts 와 같은 이유 — Edge 가 문구를
// 정규식으로 갈라 상태를 고르기 시작하면 그게 곧 어댑터로 샌 규칙이다). 웹 서버 액션은
// 문구만 쓴다.
//   400 잘못된 입력·검증 실패   403 남의 글·댓글   404 글·댓글 없음
//   429 시간당 한도            500 저장 실패(사용자가 할 수 있는 게 없다)
export type BoardRuleError = { error: string; status: 400 | 403 | 404 | 429 | 500 };

export type BoardDeps = {
  imageOrigin: string;
  // 시간당 한도의 기준 시각. 테스트가 고정하려고 주입한다.
  now?: () => Date;
  // 이미지 저장 경로의 파일명(기본 crypto.randomUUID).
  randomUuid?: () => string;
};

// 새니타이즈 **전** 원본 길이 상한. 검증은 새니타이즈된 결과에 대고 하지만, 원본이
// 무한정 크면 새니타이저가 그만큼 CPU 를 쓴다. 서식 태그를 감안해 저장 상한의 4배.
export const BOARD_RAW_HTML_MAX = BOARD_CONTENT_HTML_MAX * 4;

const RAW_TOO_LONG = "본문이 너무 깁니다. 글을 나눠서 올려주세요.";

function nowOf(deps: BoardDeps): Date {
  return deps.now ? deps.now() : new Date();
}

// ── 글 ──────────────────────────────────────────────────────────────────────

export type BoardPostWriteInput = {
  actor: BoardActor;
  title: string;
  category: string;
  // 에디터가 만든 원본 HTML. **여기서 새니타이즈하기 전에는 아무 데도 쓰지 않는다.**
  contentHtml: string;
  isPinned?: boolean;
};

// 새니타이즈 → 검증. 글 작성과 수정이 같은 순서로 지나는 한 자리.
function prepareBoardPost(
  input: Pick<BoardPostWriteInput, "title" | "category" | "contentHtml">,
  deps: BoardDeps,
): BoardRuleError | BoardPostInputOk {
  if (String(input.contentHtml ?? "").length > BOARD_RAW_HTML_MAX) {
    return { error: RAW_TOO_LONG, status: 400 };
  }
  const sanitizedHtml = sanitizeRichText(input.contentHtml, { imageOrigins: [deps.imageOrigin] });
  const validated = validateBoardPostInput({
    title: input.title,
    category: input.category,
    sanitizedHtml,
  });
  if ("error" in validated) return { error: validated.error, status: 400 };
  return validated;
}

export async function createBoardPost(
  client: SupabaseClient,
  input: BoardPostWriteInput,
  deps: BoardDeps,
): Promise<BoardRuleError | { id: string }> {
  const validated = prepareBoardPost(input, deps);
  if ("error" in validated) return validated;

  // 고정(공지)은 관리자만. 체크박스는 비관리자 화면에 아예 없지만, 폼 데이터를 직접 만들어
  // 보내는 경로를 여기서 막아야 실제로 지켜진다.
  const isPinned = canPinBoardPost(input.actor) && input.isPinned === true;

  if (await overHourlyLimit(client, "board_posts", input.actor.userId, BOARD_HOURLY_POST_LIMIT, nowOf(deps))) {
    return { error: HOURLY_LIMIT_ERROR, status: 429 };
  }

  const { data, error } = await client
    .from("board_posts")
    .insert({
      user_id: input.actor.userId,
      nickname: authorNickname(await resolveNickname(client, input.actor)),
      category: validated.category,
      title: validated.title,
      content_html: validated.contentHtml,
      content_text: validated.contentText,
      thumbnail_url: firstImageSrc(validated.contentHtml),
      is_pinned: isPinned,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요.", status: 500 };
  return { id: data.id as string };
}

export async function updateBoardPost(
  client: SupabaseClient,
  input: BoardPostWriteInput & { id: string },
  deps: BoardDeps,
): Promise<BoardRuleError | { id: string }> {
  const id = String(input.id ?? "");
  if (!isPaperUuid(id)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = prepareBoardPost(input, deps);
  if ("error" in validated) return validated;

  const { data: post } = await client
    .from("board_posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  if (!canEditBoardPost({ user_id: post.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  const { error } = await client
    .from("board_posts")
    .update({
      category: validated.category,
      title: validated.title,
      content_html: validated.contentHtml,
      content_text: validated.contentText,
      thumbnail_url: firstImageSrc(validated.contentHtml),
      // 고정 여부는 관리자가 고칠 때만 손댄다 — 비관리자가 자기 글을 수정할 때 이 값을
      // 같이 보내면 관리자가 걸어둔 공지 고정이 풀린다.
      ...(canPinBoardPost(input.actor) ? { is_pinned: input.isPinned === true } : {}),
      updated_at: nowOf(deps).toISOString(),
    })
    .eq("id", id)
    // 위에서 확인했지만 쓰기 문장에도 소유자를 박는다 — 읽기와 쓰기 사이의 경합·admin 클라이언트
    // (RLS 없음) 양쪽에 대한 방어선이다(rules/notices.ts 와 같은 배치). 수정은 관리자에게도
    // 열지 않으므로(canEditBoardPost) 조건이 언제나 붙는다.
    .eq("user_id", input.actor.userId);
  if (error) return { error: "수정에 실패했어요.", status: 500 };

  return { id };
}

export async function deleteBoardPost(
  client: SupabaseClient,
  input: { actor: BoardActor; id: string },
): Promise<BoardRuleError | { id: string }> {
  const id = String(input.id ?? "");
  if (!isPaperUuid(id)) return { error: "잘못된 접근입니다.", status: 400 };

  const { data: post } = await client
    .from("board_posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  if (!canDeleteBoardPost({ user_id: post.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  // 관리자는 남의 글을 지울 수 있으므로 소유자 조건은 관리자가 아닐 때만 붙인다(위 수정과 같은 이유).
  let query = client.from("board_posts").delete().eq("id", id);
  if (!input.actor.isAdmin) query = query.eq("user_id", input.actor.userId);
  const { error } = await query;
  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  return { id };
}

// ── 이미지 업로드 ───────────────────────────────────────────────────────────
// 클라이언트가 버킷에 직접 올리지 않는 이유는 프로필 사진과 같다 — 크기·형식을 서버가
// 강제해야 하고, 그 관문을 우회할 수 있으면 강제가 아니다(schema.sql 의 board-images 버킷에
// 쓰기 정책이 없다).
//
// webp 는 **이미 구워진** 가로 ≤1600px webp 바이트다. 굽는 일은 런타임마다 다르다(웹은
// sharp, 앱은 Skia — Deno 에는 sharp 가 없다). 규칙은 굽지 않고 boardImageBytesError 로
// **검사만** 한다(board-image.ts 머리말).

export async function uploadBoardImage(
  client: SupabaseClient,
  input: { userId: string; webp: Uint8Array },
  deps: BoardDeps,
): Promise<BoardRuleError | { url: string }> {
  const invalid = boardImageBytesError(input.webp);
  if (invalid) return { error: invalid, status: 400 };

  // 시간당 상한은 테이블이 아니라 **스토리지 목록**으로 센다(웹 uploadBoardImage 그대로) —
  // 이미지는 글보다 먼저 올라가고 글이 취소되면 표에 남는 행이 없기 때문이다.
  const oneHourAgo = new Date(nowOf(deps).getTime() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await client.storage.from("board-images").list(input.userId, {
    limit: BOARD_HOURLY_IMAGE_LIMIT,
    sortBy: { column: "created_at", order: "desc" },
  });
  const recentCount = (recent ?? []).filter(
    (f: { created_at?: string | null }) => (f.created_at ?? "") > oneHourAgo,
  ).length;
  if (recentCount >= BOARD_HOURLY_IMAGE_LIMIT) {
    return {
      error: "짧은 시간 동안 이미지를 너무 많이 올렸어요. 잠시 후 다시 시도해주세요.",
      status: 429,
    };
  }

  const uuid = deps.randomUuid ?? (() => crypto.randomUUID());
  // 사용자 id 를 앞에 두면 탈퇴 정리(account-delete)가 `list(userId)` 로 본인 객체만 골라낸다.
  const path = `${input.userId}/${uuid()}.webp`;
  const { error } = await client.storage
    .from("board-images")
    .upload(path, input.webp, { contentType: "image/webp", cacheControl: "31536000" });
  if (error) {
    // 원인을 화면에 그대로 내보내지는 않지만(스토리지 내부 사정이다) 로그에는 남긴다 —
    // 안 남기면 "업로드가 안 돼요" 신고 하나에 재현부터 다시 해야 한다.
    console.error("[board] 이미지 업로드 실패:", error.message);
    // 버킷이 없는 건 이용자가 다시 시도해서 풀릴 일이 아니라 설치가 덜 된 것이다
    // (supabase/schema.sql 의 board-images 버킷 · scripts/sql 의 1회 적용본).
    return {
      error: /bucket/i.test(error.message)
        ? "이미지 저장소가 아직 준비되지 않았어요. 운영자에게 알려주세요."
        : "업로드에 실패했어요. 잠시 후 다시 시도해주세요.",
      status: 500,
    };
  }

  return { url: `${deps.imageOrigin}${path}` };
}

// ── 댓글 ────────────────────────────────────────────────────────────────────

export async function createBoardComment(
  client: SupabaseClient,
  input: {
    actor: BoardActor;
    postId: string;
    content: string;
    // 답글이면 대상 댓글 id. 답글에 다는 답글은 서버가 원 댓글로 접어 올린다.
    parentId?: string | null;
  },
  deps: BoardDeps,
): Promise<BoardRuleError | { id: string }> {
  const postId = String(input.postId ?? "");
  if (!isPaperUuid(postId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateBoardCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: post } = await client
    .from("board_posts")
    .select("user_id, title")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  if (await overHourlyLimit(client, "board_comments", input.actor.userId, BOARD_HOURLY_COMMENT_LIMIT, nowOf(deps))) {
    return { error: HOURLY_LIMIT_ERROR, status: 429 };
  }

  // 답글 대상 확인. 답글의 답글이면 그 부모(원 댓글)에 붙인다 — 깊이를 1단계로 묶어두는
  // 판단은 ../board.ts 의 resolveBoardCommentParent 하나다.
  let parentId: string | null = null;
  let parentAuthorId: string | null = null;
  const requestedParent = String(input.parentId ?? "");
  if (requestedParent) {
    if (!isPaperUuid(requestedParent)) return { error: "잘못된 접근입니다.", status: 400 };
    const { data: parent } = await client
      .from("board_comments")
      .select("id, parent_id, post_id, user_id, is_deleted")
      .eq("id", requestedParent)
      .maybeSingle();
    // 다른 글의 댓글 id 를 부모로 넘기는 경로를 막는다(트리가 글을 넘나들면 안 된다).
    if (!parent || parent.post_id !== postId) {
      return { error: "답글을 달 댓글을 찾을 수 없어요.", status: 404 };
    }
    parentId = resolveBoardCommentParent({
      id: parent.id as string,
      parent_id: (parent.parent_id as string | null) ?? null,
    });
    // 탈퇴한 회원의 댓글(user_id null)도 여기서 null 이 된다 — 알림 받을 사람이 없다.
    parentAuthorId = parent.is_deleted ? null : ((parent.user_id as string | null) ?? null);
  }

  const nickname = authorNickname(await resolveNickname(client, input.actor));
  const { data: created, error } = await client
    .from("board_comments")
    .insert({
      post_id: postId,
      parent_id: parentId,
      user_id: input.actor.userId,
      nickname,
      content: validated.content,
    })
    .select("id")
    .single();
  if (error || !created) return { error: "댓글 등록에 실패했어요.", status: 500 };

  // 알림. 답글이면 원 댓글 작성자에게, 아니면 글쓴이에게 보낸다. 답글이 원글에 달린
  // 것이기도 하므로 글쓴이에게도 알린다(둘이 같은 사람이면 한 번만 — 아래
  // createNotification 이 본인 알림을 걸러낸다). 실패해도 댓글 등록은 성공이다(notify.ts).
  const link = `/board/${postId}#comment-${created.id as string}`;
  const preview = notificationPreview(validated.content);
  const title = post.title as string;

  if (parentAuthorId) {
    await createNotification(client, {
      userId: parentAuthorId,
      type: "board_reply",
      actorId: input.actor.userId,
      actorNickname: nickname,
      title,
      preview,
      link,
    });
  }
  // 글쓴이가 탈퇴한 회원이면(user_id null) createNotification 이 받을 사람 없음으로 건너뛴다.
  if (post.user_id !== parentAuthorId) {
    await createNotification(client, {
      userId: post.user_id as string | null,
      type: "board_comment",
      actorId: input.actor.userId,
      actorNickname: nickname,
      title,
      preview,
      link,
    });
  }

  return { id: postId };
}

export async function updateBoardComment(
  client: SupabaseClient,
  input: { actor: BoardActor; commentId: string; content: string },
  deps: BoardDeps,
): Promise<BoardRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateBoardCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: comment } = await client
    .from("board_comments")
    .select("post_id, user_id, is_deleted")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment || comment.is_deleted) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  if (!canEditBoardComment({ user_id: comment.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  const { error } = await client
    .from("board_comments")
    .update({ content: validated.content, updated_at: nowOf(deps).toISOString() })
    .eq("id", commentId)
    // 쓰기 문장에도 소유자를 박는다(글 수정과 같은 이유 — 댓글 수정도 본인만이다).
    .eq("user_id", input.actor.userId);
  if (error) return { error: "수정에 실패했어요.", status: 500 };

  return { id: comment.post_id as string };
}

export async function deleteBoardComment(
  client: SupabaseClient,
  input: { actor: BoardActor; commentId: string },
  deps: BoardDeps,
): Promise<BoardRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const { data: comment } = await client
    .from("board_comments")
    .select("post_id, user_id, parent_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  if (!canDeleteBoardComment({ user_id: comment.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  // 답글이 달린 원 댓글은 행을 지우지 않고 "삭제된 댓글" 표시만 남긴다 — 통째로 지우면
  // 그 아래 답글들이 무슨 말에 대한 답인지 알 수 없게 된다(cascade 로 같이 지워버리면
  // 남의 글까지 지우는 셈이다).
  const { count: replyCount } = await client
    .from("board_comments")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", commentId);

  // 소프트 삭제(update)든 행 삭제(delete)든 쓰기 문장에 소유자를 박는다 — 관리자는 남의 댓글도
  // 지우므로 관리자가 아닐 때만(글 삭제와 같은 배치).
  let query =
    (replyCount ?? 0) > 0
      ? client
          .from("board_comments")
          .update({
            is_deleted: true,
            content: "삭제된 댓글입니다.",
            updated_at: nowOf(deps).toISOString(),
          })
          .eq("id", commentId)
      : client.from("board_comments").delete().eq("id", commentId);
  if (!input.actor.isAdmin) query = query.eq("user_id", input.actor.userId);
  const { error } = await query;

  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  return { id: comment.post_id as string };
}

// 작성자명의 원본(user_metadata.nickname). 웹은 세션에서 이미 읽어 둔 값을 넘기고(왕복
// 하나를 아낀다), Edge 에는 그 세션이 없어 여기서 admin 으로 읽는다. 이메일 로컬파트로
// 떨어지지 않는다 — 그 값은 닉네임 정책(금칙어·중복)을 지나간 적이 없어서 "관리자" 같은
// 이름이 그대로 박힌다(../nickname.ts authorNickname 주석).
async function resolveNickname(client: SupabaseClient, actor: BoardActor): Promise<unknown> {
  if (actor.metadataNickname !== undefined) return actor.metadataNickname;
  const { data } = await client.auth.admin.getUserById(actor.userId);
  return (data?.user?.user_metadata as { nickname?: unknown } | undefined)?.nickname;
}
