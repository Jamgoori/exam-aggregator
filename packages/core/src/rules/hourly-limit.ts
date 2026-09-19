import type { SupabaseClient } from "@supabase/supabase-js";

// 시간당 작성 수 상한 — 한 계정이 게시판을 도배하는 것만 막는 느슨한 상한.
//
// 예전에는 웹 서버 액션마다(board·suggestions·notices·papers) 같은 모양의 count 쿼리와
// 상수를 따로 들고 있었다. 앱이 Edge Function 으로 같은 글을 쓰게 되면서 "웹에서는 10건에
// 막히고 앱에서는 11건이 들어가는" 틈이 생기지 않게 한도와 세는 법을 여기 한 곳에 둔다.
// 표 이름과 한도만 다르고 형태가 같아서 함수 하나로 충분하다.
//
// 세는 기준은 created_at 이 지금부터 1시간 전 이후인 **내 행의 수**다(고정 창이 아니라
// 미끄러지는 창). 행이 지워지면 그만큼 다시 쓸 수 있다 — 도배 방지가 목적이라 그 정도의
// 허술함은 감수한다(정확한 과금이 아니다).

// 자유게시판 글. 건의게시판과 같은 기준.
export const BOARD_HOURLY_POST_LIMIT = 10;
// 자유게시판 댓글. 답글 포함.
export const BOARD_HOURLY_COMMENT_LIMIT = 30;
// 본문 이미지. 한 시간에 이만큼이면 사진 여러 장 붙인 글을 몇 개 써도 남는다.
// 이건 테이블이 아니라 스토리지 객체 수로 센다(rules/board.ts#uploadBoardImage).
export const BOARD_HOURLY_IMAGE_LIMIT = 60;
// 공지 댓글. suggestion_comments 와 같은 기준. 공지 원글은 관리자 전용이라 상한이 없다.
export const NOTICE_COMMENT_HOURLY_LIMIT = 30;
// 건의글. 정상적인 건의는 하루에 몇 건을 넘지 않는다(문항 오류 신고와 같은 기준) —
// 웹 suggestions/actions.ts 에 있던 HOURLY_LIMIT 을 옮긴 것.
export const SUGGESTION_HOURLY_LIMIT = 10;
// 건의 댓글. 원글보다 가볍게 자주 오가므로 더 넉넉히(웹 COMMENT_HOURLY_LIMIT).
export const SUGGESTION_COMMENT_HOURLY_LIMIT = 30;

// 도배 초과 시 문구. 웹 서버 액션 전부가 이 한 문장을 쓴다.
export const HOURLY_LIMIT_ERROR =
  "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요.";

export type HourlyLimitTable =
  | "board_posts"
  | "board_comments"
  | "notice_comments"
  | "suggestions"
  | "suggestion_comments";

// user_id 컬럼과 created_at 컬럼을 가진 표라면 어디든 같은 식으로 센다.
// count 조회가 실패하면(null) 0 으로 본다 — 한도 검사가 죽어서 글쓰기가 통째로 막히는
// 쪽보다 한 시간 동안 조금 더 쓰게 두는 쪽이 낫다.
export async function overHourlyLimit(
  client: SupabaseClient,
  table: HourlyLimitTable,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<boolean> {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  return (count ?? 0) >= limit;
}
