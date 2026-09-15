import type { CommentsWriteRequest } from "@gongmoa/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { paperPublicKey } from "./papers";
import { callEdge } from "../lib/edge";

// 댓글 작성/수정/삭제 — Edge `comments-write`(설계서 §6.2 댓글 행). 조회는 문제지 공개 상세
// (['catalog','paper-public',id])에 실려 오므로 성공 후 그 키를 무효화해 웹 router.refresh()
// 와 같은 효과를 낸다. 비회원(비밀번호) 댓글은 앱 비목표라 그 폼은 그리지 않는다.
export function useCommentsWrite(paperId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CommentsWriteRequest) => callEdge("comments-write", req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paperPublicKey(paperId) }),
  });
}
