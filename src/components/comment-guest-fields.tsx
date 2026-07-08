"use client";

import { NICKNAME_MAX } from "@/lib/nickname";
import { COMMENT_PW_MIN, COMMENT_PW_MAX } from "@/lib/comment-constraints";

// 비회원이 댓글/답글을 쓸 때 필요한 닉네임+비밀번호 입력. 새 댓글 폼과 답글 폼
// 양쪽에서 똑같이 쓰므로 한 곳에 모아둔다(감싸는 레이아웃은 호출부가 정한다).
export function CommentGuestFields({
  nickname,
  password,
  onNicknameChange,
  onPasswordChange,
}: {
  nickname: string;
  password: string;
  onNicknameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <>
      <input
        value={nickname}
        onChange={(e) => onNicknameChange(e.target.value)}
        maxLength={NICKNAME_MAX}
        placeholder={`닉네임 (최대 ${NICKNAME_MAX}자)`}
        required
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-40"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        minLength={COMMENT_PW_MIN}
        maxLength={COMMENT_PW_MAX}
        placeholder={`비밀번호 (${COMMENT_PW_MIN}~${COMMENT_PW_MAX}자)`}
        required
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-52"
      />
    </>
  );
}
