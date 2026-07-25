import type { Comment } from "./types";

// 댓글 스레드 — 웹·모바일 공유.
//
// 예전에는 "답글은 최상위 댓글에만"(1단계)이었지만, 대댓글에 다시 답글을 달 수 있어야
// 대화가 이어져서 깊이 제한을 COMMENT_MAX_DEPTH 로 늘렸다. 무제한으로 두지 않는 이유는
// 화면 때문이다 — 들여쓰기가 계속 깊어지면 좁은 폭(특히 앱)에서 글이 한 줄에 두세 글자만
// 남는다. 한도에 닿은 댓글에는 답글 버튼을 감추고, 서버도 같은 한도로 거절한다.
//
// 깊이는 1부터 센다: 원댓글 1, 대댓글 2, 대대댓글 3.
export const COMMENT_MAX_DEPTH = 3;

export type CommentNode = Comment & {
  depth: number;
  replies: CommentNode[];
};

// 평평한 댓글 목록을 트리로 만든다. 부모가 목록에 없는 댓글(부모가 지워졌거나 조회
// 범위 밖)은 유실되지 않게 최상위로 올린다.
export function buildCommentTree(comments: Comment[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const c of comments) {
    byId.set(c.id, { ...c, depth: 1, replies: [] });
  }

  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }

  // depth 는 부모를 따라 내려가며 채운다. 사이클(있어선 안 되지만 데이터가 깨진 경우)에
  // 빠지지 않도록 방문한 노드는 다시 타지 않는다.
  const seen = new Set<string>();
  const assign = (nodes: CommentNode[], depth: number) => {
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      n.depth = depth;
      assign(n.replies, depth + 1);
    }
  };
  assign(roots, 1);

  const byCreated = (a: CommentNode, b: CommentNode) =>
    a.created_at.localeCompare(b.created_at);
  const sortDeep = (nodes: CommentNode[]) => {
    nodes.sort(byCreated);
    for (const n of nodes) sortDeep(n.replies);
  };
  sortDeep(roots);

  return roots;
}

// 이 댓글에 답글을 달 수 있는지. 한도에 닿으면 더 못 단다.
export function canReplyTo(depth: number): boolean {
  return depth < COMMENT_MAX_DEPTH;
}
