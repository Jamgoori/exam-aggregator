import { supabase } from "./supabase";
import type { Comment } from "@gongmoa/core";

// 문제지 상세의 상호작용(북마크·난이도·댓글). 모두 RLS 로 본인 쓰기만 허용돼 있어
// 클라이언트에서 직접 한다(웹 서버 액션과 동일 규칙: 본인 행만, 중복 방지).

export const VALID_SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// ── 북마크 ──────────────────────────────────────────────
export async function isBookmarked(paperId: string): Promise<boolean> {
  const { data } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("paper_id", paperId)
    .maybeSingle();
  return !!data;
}

export async function setBookmark(paperId: string, on: boolean): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("로그인이 필요해요.");
  if (on) {
    const { error } = await supabase
      .from("bookmarks")
      .insert({ paper_id: paperId, user_id: userId });
    // 이미 있으면(23505) 무시.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase.from("bookmarks").delete().eq("paper_id", paperId);
    if (error) throw error;
  }
}

// ── 난이도 ──────────────────────────────────────────────
export type RatingSummary = { average: number | null; count: number; myScore: number | null };

export async function getRatingSummary(paperId: string): Promise<RatingSummary> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { data } = await supabase
    .from("difficulty_ratings")
    .select("score, user_id")
    .eq("paper_id", paperId);
  const rows = data ?? [];
  const scores = rows.map((r) => r.score as number);
  const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const myScore = userId
    ? (rows.find((r) => r.user_id === userId)?.score as number | undefined) ?? null
    : null;
  return { average, count: scores.length, myScore };
}

export async function postRating(paperId: string, score: number): Promise<void> {
  if (!VALID_SCORES.includes(score)) throw new Error("잘못된 점수입니다.");
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("로그인이 필요해요.");
  const { error } = await supabase
    .from("difficulty_ratings")
    .insert({ paper_id: paperId, user_id: userId, guest_token: null, score });
  if (error) throw new Error(error.code === "23505" ? "이미 평가했어요." : "평가에 실패했어요.");
}

// ── 댓글 ──────────────────────────────────────────────
export async function getComments(paperId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Comment[];
}

export async function postComment(
  paperId: string,
  content: string,
  parentId: string | null = null,
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("로그인이 필요해요.");
  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";
  const { error } = await supabase.from("comments").insert({
    paper_id: paperId,
    user_id: user.id,
    nickname,
    content: content.trim(),
    parent_id: parentId,
  });
  if (error) throw error;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw error;
}
