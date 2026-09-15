import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment } from "../types";

// 문제지 댓글 조회 — 웹 paper-detail-data.ts 의 comments 조회와 같은 컬럼·정렬.
// comments 는 anon/authenticated 에 select 만 열려 있다(schema.sql). 쓰기는 Edge
// `comments-write`(앱) / 서버 액션(웹) — 클라이언트 직접 insert 는 권한이 없어 실패한다.
export async function fetchPaperComments(client: SupabaseClient, paperId: string): Promise<Comment[]> {
  const { data, error } = await client
    .from("comments")
    .select("id, paper_id, user_id, nickname, content, created_at, updated_at, parent_id")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`댓글 조회 실패: ${error.message}`);
  return (data ?? []) as Comment[];
}
