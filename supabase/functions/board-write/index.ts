// 자유게시판 쓰기 전부(설계서 §6.7 #17) — 글 작성·수정·삭제, 본문 이미지, 댓글 작성·수정·삭제.
// 웹 서버 액션 app/board/actions.ts 와 같은 규칙(core rules/board.ts)을 부르는 다른 어댑터다.
// board_posts·board_comments 는 쓰기 정책이 회수돼 있어(schema.sql) 앱이 표에 직접 쓸 길이
// 없고, 이 함수가 앱의 서버 액션 역할을 한다.
//
//   { action: "post.create", title, category, contentHtml, isPinned? }  → { success, id }
//   { action: "post.update", id, title, category, contentHtml, isPinned? } → { success, id }
//   { action: "post.delete", id }                                        → { success, id }
//   { action: "image", webpBase64 }                                      → { success, url }
//   { action: "comment.create", postId, content, parentId? }             → { success, id: postId }
//   { action: "comment.update", commentId, content }                     → { success, id: postId }
//   { action: "comment.delete", commentId }                              → { success, id: postId }
//
// 규칙은 전부 core 다 — 새니타이즈 → 검증 → 저장 순서, 시간당 한도 10/30/60, 답글 접기,
// 소프트 삭제, 알림. 여기는 인증·요청 파싱·관리자 판정·상태 코드 매핑만 한다(어댑터에 if 가
// 늘면 규칙이 새는 것이다). 관리자 판정은 웹 is_admin() 과 같은 근거(admins 이메일 화이트리스트,
// JWT 의 email) — core isAdminEmail.
//
// ⚠ **이미지는 여기서 굽지 않는다.** 웹은 sharp 로 1600px webp 를 굽지만 Deno 에는 sharp 가
// 없고, WASM 코덱을 넣으면 콜드스타트·메모리를 사진 한 장 때문에 요청마다 치른다. 앱이 이미
// 들고 있는 @shopify/react-native-skia 로 굽고(§12-8 아바타와 같은 결정) 서버는 **헤더만**
// 검사한다(core boardImageBytesError — RIFF/WEBP·폭 ≤1600·픽셀 수·애니메이션·RIFF 선언 길이).
// base64 는 33% 부푸므로 atob **전에** 문자 수로 먼저 거른다(avatar-upload 와 같다).
//
// 오류(§6.9 — 본문은 `{ error }` 한국어 문구 그대로, 상태는 규칙이 준 값):
//   401 로그인 필요 · 400 검증 실패·잘못된 id · 403 권한 없음 · 404 글·댓글 없음 ·
//   429 시간당 한도 · 500 저장·업로드 실패
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  boardImageOrigin,
  createBoardComment,
  createBoardPost,
  deleteBoardComment,
  deleteBoardPost,
  isAdminEmail,
  updateBoardComment,
  updateBoardPost,
  uploadBoardImage,
  BOARD_IMAGE_BASE64_MAX_CHARS,
} from "../_shared/core.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// 본문 이미지의 공개 URL 접두사. 웹(NEXT_PUBLIC_SUPABASE_URL)과 같은 프로젝트라 같은 문자열 —
// 새니타이저가 이 접두사로 시작하는 <img> 만 남긴다.
const deps = { imageOrigin: boardImageOrigin(SUPABASE_URL) };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  const admin = coreAdmin();
  const action = String(body.action ?? "");

  // 닉네임은 규칙이 admin API 로 읽는다(세션이 없다). isAdmin 은 is_pinned 반영과 남의 글·댓글
  // 삭제 권한에만 쓰인다.
  const actor = {
    userId: auth.userId,
    isAdmin: await isAdminEmail(admin, auth.email),
  };

  if (action === "post.create") {
    const result = await createBoardPost(
      admin,
      {
        actor,
        title: String(body.title ?? ""),
        category: String(body.category ?? ""),
        contentHtml: String(body.contentHtml ?? ""),
        isPinned: body.isPinned === true,
      },
      deps,
    );
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "post.update") {
    const result = await updateBoardPost(
      admin,
      {
        actor,
        id: String(body.id ?? ""),
        title: String(body.title ?? ""),
        category: String(body.category ?? ""),
        contentHtml: String(body.contentHtml ?? ""),
        isPinned: body.isPinned === true,
      },
      deps,
    );
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "post.delete") {
    const result = await deleteBoardPost(admin, { actor, id: String(body.id ?? "") });
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "image") {
    const encoded = String(body.webpBase64 ?? "");
    if (!encoded) return json({ error: "이미지를 선택해주세요." }, 400);
    if (encoded.length > BOARD_IMAGE_BASE64_MAX_CHARS) {
      return json({ error: "이미지가 너무 커요. 다른 사진으로 시도해주세요." }, 400);
    }

    let webp: Uint8Array;
    try {
      // atob 은 base64 가 아닌 문자가 섞이면 던진다 — 데이터 URL 접두를 붙여 보내는
      // 클라이언트도 여기서 걸러진다(계약은 본문만 받는다).
      const binary = atob(encoded);
      webp = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) webp[i] = binary.charCodeAt(i);
    } catch {
      return json({ error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요." }, 400);
    }

    const result = await uploadBoardImage(admin, { userId: auth.userId, webp }, deps);
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, url: result.url });
  }

  if (action === "comment.create") {
    const result = await createBoardComment(
      admin,
      {
        actor,
        postId: String(body.postId ?? ""),
        content: String(body.content ?? ""),
        parentId: body.parentId ? String(body.parentId) : null,
      },
      deps,
    );
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.update") {
    const result = await updateBoardComment(
      admin,
      { actor, commentId: String(body.commentId ?? ""), content: String(body.content ?? "") },
      deps,
    );
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  if (action === "comment.delete") {
    const result = await deleteBoardComment(
      admin,
      { actor, commentId: String(body.commentId ?? "") },
      deps,
    );
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ success: true, id: result.id });
  }

  return json({ error: "잘못된 요청입니다." }, 400);
});
