import {
  isBoardCategory,
  isBoardWriteImage,
  type BoardCategorySlug,
  type BoardWritePostResponse,
  type BoardWriteRequest,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callEdge } from "../lib/edge";
import { supabase } from "../lib/supabase";

// 자유게시판 **쓰기**(글 등록·수정·삭제, 본문 이미지) — EF `board-write`(설계서 §6.7 #17). 웹 서버 액션
// app/board/actions.ts 와 같은 규칙(core rules/board.ts)을 부르는 다른 어댑터다. board_posts 는
// insert/update/delete 가 회수돼 있어(schema.sql) 앱이 테이블에 직접 쓰는 길은 없고, 본문 HTML 은 반드시
// 서버의 sanitizeRichText 를 지난다(AGENTS.md "자유게시판 본문").
//
// 읽기(목록·상세·댓글)는 여기 없다 — queries/board.ts(B1)의 몫. 쓰기 뒤 무효화는 그 파일의 키
// (boardListRootKey·boardPostKey·boardCommentsKey — 전부 ["catalog", "board", …])가 앉은 접두로 한다:
// 글을 올린 뒤 목록·상세가 새로 오는 것이 웹 revalidatePath 의 앱 대응이다(§6.3 무효화 지도). 좋아요·
// 차단(["me", userId, …])은 글 쓰기와 무관해 건드리지 않는다.
export const BOARD_QUERY_PREFIX = ["catalog", "board"] as const;

type Input<A extends BoardWriteRequest["action"]> = Omit<Extract<BoardWriteRequest, { action: A }>, "action">;

async function writePost(req: BoardWriteRequest): Promise<BoardWritePostResponse> {
  const res = await callEdge("board-write", req);
  // 계약상 글·댓글 action 은 언제나 { id } 다. url 이 오면 서버가 다른 것을 돌려준 것이라 성공으로 보지 않는다.
  if (isBoardWriteImage(res)) throw new Error("등록에 실패했어요.");
  return res;
}

function useInvalidateBoard() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: BOARD_QUERY_PREFIX });
}

// 글 등록. 응답 id = 새 글 id(화면은 웹처럼 곧장 그 글로 간다).
export function useCreateBoardPost() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (input: Input<"post.create">) => writePost({ action: "post.create", ...input }),
    onSuccess: invalidate,
  });
}

// 글 수정. 응답 id = 그 글 id.
export function useUpdateBoardPost() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (input: Input<"post.update">) => writePost({ action: "post.update", ...input }),
    onSuccess: invalidate,
  });
}

// 글 삭제(본인 + 관리자 — 판정은 서버).
export function useDeleteBoardPost() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (input: Input<"post.delete">) => writePost({ action: "post.delete", ...input }),
    onSuccess: invalidate,
  });
}

// 본문 이미지 업로드 — 앱이 구운 webp(lib/board-image.ts)의 base64 를 보내고 공개 URL 을 받는다. 그 URL 을
// 본문 `![설명](url)` 에 그대로 넣는다(새니타이저가 boardImageOrigin 접두사만 남기므로 다른 주소는 저장 시
// 빠진다 — contracts.ts 주석). 무효화할 캐시는 없다(글이 저장되기 전이다).
//
// 타임아웃은 CBT 제출과 같은 60초 — 기본 20초(§6.9)는 2MB 가까운 base64 를 느린 회선으로 올리기에 짧다.
export function useUploadBoardImage() {
  return useMutation({
    mutationFn: async (webpBase64: string): Promise<string> => {
      const res = await callEdge("board-write", { action: "image", webpBase64 }, { timeoutMs: 60_000 });
      if (!isBoardWriteImage(res)) throw new Error("업로드에 실패했어요. 잠시 후 다시 시도해주세요.");
      return res.url;
    },
  });
}

// 수정 화면이 채울 값(웹 [id]/edit/page.tsx 가 fetchBoardPost 에서 꺼내 BoardForm 에 넘기는 네 값 + 권한
// 판정용 작성자 id). RLS 공개 읽기라 세션 없이도 읽히지만 화면은 로그인 뒤에만 연다.
export type BoardPostEditable = {
  id: string;
  // null = 탈퇴한 회원의 글(canEditBoardPost 가 false 를 낸다).
  authorId: string | null;
  title: string;
  category: BoardCategorySlug;
  contentHtml: string;
  isPinned: boolean;
};

export const boardPostEditKey = (id: string) => [...BOARD_QUERY_PREFIX, "post", id, "edit"] as const;

// 수정할 글 한 건. B1 의 상세 쿼리와 키를 나눠 둔 이유: 상세는 조회수·좋아요까지 든 다른 모양이고
// 캐시 사본을 편집 초기값으로 쓰면 다른 기기에서 고친 뒤의 옛 본문 위에 덧쓰게 된다 — 그래서 여기는
// staleTime 0 으로 열 때마다 새로 읽고 디스크에 남기지 않는다(공개 글이라 금지 대상은 아니지만 편집
// 스냅샷을 퍼시스트할 이유가 없다).
export function useBoardPostForEdit(id: string) {
  return useQuery({
    queryKey: boardPostEditKey(id),
    queryFn: async (): Promise<BoardPostEditable | null> => {
      const { data, error } = await supabase
        .from("board_posts")
        .select("id, user_id, title, category, content_html, is_pinned")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        authorId: (data.user_id as string | null) ?? null,
        title: data.title as string,
        // 웹 fetchBoardPost 와 같은 폴백 — 목록 밖 값이 들어 있으면 "자유"로 본다.
        category: isBoardCategory(data.category) ? data.category : "free",
        contentHtml: data.content_html as string,
        isPinned: data.is_pinned as boolean,
      };
    },
    staleTime: 0,
    gcTime: 0,
    meta: { persist: false },
  });
}
