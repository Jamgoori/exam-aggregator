import type { AvatarUploadRequest, AvatarUploadResponse } from "@gongmoa/core";
import { useMutation } from "@tanstack/react-query";
import { callEdge } from "../lib/edge";
import { supabase } from "../lib/supabase";

// 프로필 사진 등록·삭제(EF avatar-upload). 설계서 §6.2 아바타 행·§6.7 #16.
//
// 내 아바타를 **읽는** 훅은 여기 없다. user_metadata.avatar_path 가 JWT 에 실려 오므로
// lib/profile.ts 의 currentAvatarUrl 이 세션만 읽어 그린다(웹 헤더가 getClaims 만 읽는 것과
// 같다) — 화면마다 DB 왕복을 하나씩 붙이지 않으려는 것이다.
//
// **남의** 아바타를 일괄 조회하는 훅도 없다: 앱에는 남의 사진이 보이는 자리가 아직 없다.
// 웹에서 아바타가 붙는 목록은 자유게시판(글 목록·댓글)뿐이고 게시판은 앱 비목표(§5)이며,
// 기출 댓글은 웹에도 아바타가 없다. 그 자리가 생기는 날 필요한 것은 profiles 를 대신 읽는
// security definer 함수 하나다(profiles 는 "본인 + 관리자"만 select 하는 RLS 라 앱 세션으로는
// 남의 행을 못 읽는다) — 설계서 §12-8 에 그때 붙일 SQL 을 적어 뒀다.

// 사진 등록·삭제. 웹 서버 액션 uploadAvatar/removeAvatar 와 같은 규칙(core rules/avatar.ts)을
// 부르는 다른 어댑터다 — avatars 버킷에는 쓰기 정책이 없어(§6.1 금지선) 앱이 직접 올릴 길은
// 없고, EF 가 앱의 서버 액션 역할을 한다.
export function useAvatarUpload() {
  return useMutation<AvatarUploadResponse, unknown, AvatarUploadRequest>({
    mutationFn: (req) => callEdge("avatar-upload", req),
    onSuccess: async () => {
      // 헤더·드로어·마이페이지는 JWT 의 user_metadata.avatar_path 를 읽어 아바타를 그린다.
      // 토큰을 갱신하지 않으면 다음 로그인 때까지 예전 사진이 남는다 — 웹 uploadAvatar 가
      // refreshSession 을 부르는 것과 같은 이유(§6.3 무효화 지도의 "닉네임/아바타" 행).
      await supabase.auth.refreshSession().catch(() => {});
    },
  });
}
