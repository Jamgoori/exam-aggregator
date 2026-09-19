"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { boardImageOrigin } from "@/lib/board";
import { boardImageUploadError, BOARD_IMAGE_MAX_WIDTH } from "@gongmoa/core";
import {
  createBoardComment as createBoardCommentRule,
  createBoardPost as createBoardPostRule,
  deleteBoardComment as deleteBoardCommentRule,
  deleteBoardPost as deleteBoardPostRule,
  updateBoardComment as updateBoardCommentRule,
  updateBoardPost as updateBoardPostRule,
  uploadBoardImage as uploadBoardImageRule,
  type BoardActor,
} from "@gongmoa/core/server";

// 자유게시판 서버 액션 — **어댑터**다. 규칙(새니타이즈 → 검증 → 저장, 시간당 한도, 답글 접기,
// 소프트 삭제, 알림, 이미지 검사)은 전부 packages/core/src/rules/board.ts 에 있고, Edge Function
// board-write 가 같은 함수를 부른다. 여기 남은 것은 세션 확보·sharp 굽기·revalidate 뿐이다 —
// 여기에 if 가 늘기 시작하면 규칙이 새는 것이다(docs/agents/edge-core-bundle.md).

export type BoardResult = { error?: string; success?: boolean; id?: string };

// 디코딩 픽셀 상한(5천만 px ≈ 7000×7000). sharp 기본값(2.7억 px)은 서버리스 함수
// 메모리(1GB 안팎)에서 한 장으로 OOM 을 낼 수 있는 크기다 — 압축 폭탄 방어.
const IMAGE_MAX_PIXELS = 50_000_000;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function revalidateBoard(id?: string) {
  revalidatePath("/board");
  if (id) revalidatePath(`/board/${id}`);
  // 검색엔진에 나가는 <head>(제목·설명)를 만드는 캐시도 같이 깨운다 — 안 깨우면
  // 새 글이 한동안 "제목 없는 셸"로 크롤러에게 나간다(lib/board.ts 주석).
  // "max" = stale-while-revalidate (예전 값을 즉시 주고 뒤에서 새로 받아 교체).
  revalidateTag("board-posts", "max");
}

// 규칙에 넘길 사용자. 닉네임은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의
// 이름으로 글을 쓸 수 있다. 관리자 여부는 웹이 늘 쓰는 rpc("is_admin")(Edge 는 같은 admins
// 표를 이메일로 본다).
async function getBoardActor(): Promise<BoardActor | null> {
  const { supabase, user } = await getSessionUser();
  if (!user) return null;
  const { data: isAdminData } = await supabase.rpc("is_admin");
  return {
    userId: user.id,
    isAdmin: isAdminData === true,
    metadataNickname: user.user_metadata?.nickname,
  };
}

function deps() {
  return { imageOrigin: boardImageOrigin() };
}

// ── 글 ──────────────────────────────────────────────────────────────────────

export async function createBoardPost(input: {
  title: string;
  category: string;
  // 에디터가 만든 원본 HTML. 규칙이 새니타이즈하기 전에는 아무 데도 쓰지 않는다.
  contentHtml: string;
  isPinned?: boolean;
}): Promise<BoardResult> {
  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await createBoardPostRule(createAdminClient(), { actor, ...input }, deps());
  if ("error" in result) return { error: result.error };

  revalidateBoard(result.id);
  return { success: true, id: result.id };
}

export async function updateBoardPost(input: {
  id: string;
  title: string;
  category: string;
  contentHtml: string;
  isPinned?: boolean;
}): Promise<BoardResult> {
  // id 모양은 규칙도 보지만, 로그인 전에 끊던 웹의 순서를 그대로 둔다(문구 동일).
  if (!isUuid(String(input.id ?? ""))) return { error: "잘못된 접근입니다." };

  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await updateBoardPostRule(createAdminClient(), { actor, ...input }, deps());
  if ("error" in result) return { error: result.error };

  revalidateBoard(result.id);
  return { success: true, id: result.id };
}

export async function deleteBoardPost(id: string): Promise<BoardResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await deleteBoardPostRule(createAdminClient(), { actor, id });
  if ("error" in result) return { error: result.error };

  revalidateBoard(id);
  return { success: true };
}

// ── 좋아요 ──────────────────────────────────────────────────────────────────
// 규칙은 SD RPC toggle_board_like 하나다(schema.sql "Phase 5 1라운드" 절) — 앱도 같은 함수를
// 부른다. 한 문장 안에서 "있으면 delete 없으면 insert" 를 끝내고, 트리거가 갱신한 like_count 를
// 돌려준다. 세션 클라이언트로 불러야 한다(auth.uid() 가 본인이다 — admin 으로 부르면 null).
export async function toggleBoardLike(
  postId: string,
): Promise<{ error?: string; liked?: boolean; likeCount?: number }> {
  if (!isUuid(postId)) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { data, error } = await supabase.rpc("toggle_board_like", { p_post_id: postId });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { liked: boolean; like_count: number }
    | undefined;
  if (error || !row) return { error: "잠시 후 다시 시도해주세요." };

  revalidateBoard(postId);
  return { liked: row.liked === true, likeCount: row.like_count };
}

// ── 이미지 업로드 ───────────────────────────────────────────────────────────
// 에디터의 "사진" 버튼이 부른다. 여기서 하는 일은 **굽기**뿐이다 — 검사(구워진 webp 헤더)·시간당
// 60장·업로드는 규칙(uploadBoardImage)이 하고, Edge 는 앱(Skia)이 구워 보낸 바이트에 같은 규칙을
// 댄다. 규칙이 결과 바이트를 한 번 더 검사하므로 sharp 가 규격을 벗어나면(나중에 resize 인자를
// 잘못 고치면) 여기서 걸린다.
export async function uploadBoardImage(
  formData: FormData,
): Promise<{ error?: string; url?: string }> {
  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const file = formData.get("file");
  const invalid = boardImageUploadError(file instanceof File ? file : null);
  if (invalid) return { error: invalid };

  let processed: Buffer;
  try {
    // withoutEnlargement: 작은 이미지를 억지로 키우지 않는다(키우면 흐려지기만 한다).
    // rotate(): 휴대폰 사진의 EXIF 회전을 실제 픽셀에 반영한다 — 안 하면 눕는다.
    processed = await sharp(Buffer.from(await (file as File).arrayBuffer()), {
      limitInputPixels: IMAGE_MAX_PIXELS,
    })
      .rotate()
      .resize({ width: BOARD_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요." };
  }

  const result = await uploadBoardImageRule(
    createAdminClient(),
    { userId: user.id, webp: new Uint8Array(processed) },
    deps(),
  );
  if ("error" in result) return { error: result.error };

  return { url: result.url };
}

// ── 댓글 ────────────────────────────────────────────────────────────────────

export async function createBoardComment(input: {
  postId: string;
  content: string;
  // 답글이면 대상 댓글 id. 답글에 다는 답글은 규칙이 원 댓글로 접어 올린다.
  parentId?: string | null;
}): Promise<BoardResult> {
  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await createBoardCommentRule(createAdminClient(), { actor, ...input }, deps());
  if ("error" in result) return { error: result.error };

  revalidateBoard(result.id);
  return { success: true, id: result.id };
}

export async function updateBoardComment(input: {
  commentId: string;
  content: string;
}): Promise<BoardResult> {
  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await updateBoardCommentRule(createAdminClient(), { actor, ...input }, deps());
  if ("error" in result) return { error: result.error };

  revalidateBoard(result.id);
  return { success: true, id: result.id };
}

export async function deleteBoardComment(commentId: string): Promise<BoardResult> {
  const actor = await getBoardActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await deleteBoardCommentRule(createAdminClient(), { actor, commentId }, deps());
  if ("error" in result) return { error: result.error };

  revalidateBoard(result.id);
  return { success: true };
}
