import {
  AVATAR_PATHS_MAX,
  avatarUrlMap,
  chunk,
  type AvatarUploadRequest,
  type AvatarUploadResponse,
} from "@gongmoa/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { SUPABASE_URL, supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 프로필 사진 등록·삭제(EF avatar-upload)와 남의 아바타 일괄 조회(RPC avatar_paths).
// 설계서 §6.2 아바타 행·§6.7 #16·§12-8.
//
// 내 아바타를 **읽는** 훅은 여기 없다. user_metadata.avatar_path 가 JWT 에 실려 오므로
// lib/profile.ts 의 currentAvatarUrl 이 세션만 읽어 그린다(웹 헤더가 getClaims 만 읽는 것과
// 같다) — 화면마다 DB 왕복을 하나씩 붙이지 않으려는 것이다.
//
// **남의** 아바타는 useAvatarUrls 한 벌로 읽는다. §12-8 에서 "앱에 남의 사진이 보이는 자리가
// 없다"는 이유로 뺐던 훅인데, Phase 5 에 자유게시판(글 목록·글 머리·댓글)이 앱에 오면서 그 자리가
// 생겼다. profiles 는 "본인 + 관리자"만 select 하는 RLS 라 앱 세션으로는 남의 행을 못 읽으므로
// §12-8 에 적어 둔 SD 함수 `avatar_paths(uuid[])`(반환 컬럼 user_id·avatar_path 둘로 고정)를
// 부르고, 행 → URL 변환은 웹 fetchAvatarUrls 와 같은 core avatarUrlMap 한 곳을 쓴다.

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

// 사용자 id 여러 개 → { userId: 공개 URL }. 웹 lib/avatars.ts#fetchAvatarUrls 의 앱 판.
//
// **목록 전체를 한 번에** 넘긴다(글 목록 20줄·댓글 전부) — 줄마다 부르면 그게 곧 N+1 이다.
// AVATAR_PATHS_MAX(200)명씩 **끊어서 전부** 물어본다(웹과 같은 이유 — 자르면 작성자가 200명을
// 넘는 글에서 뒷줄 아바타가 조용히 사라진다; RPC 도 200 초과를 거절한다).
//
// 비로그인은 부르지 않는다: RPC 가 auth.uid() null 을 거절하므로(SD 공통 규칙 (1)) 게스트에게는
// 첫 글자 아바타가 그려진다 — 웹은 서버(service_role)가 읽어 게스트에게도 사진이 보이는데, 이것이
// 웹과 갈리는 자리다(이 조회를 위해 RLS 나 익명 실행 권한을 열지는 않는다).
//
// 캐시: ['me', userId, 'avatars', …] + persist:false. 공개 값이지만 로그인 세션이 있어야만 받는
// 조회라 'me' 접두에 두고, 사진은 자주 바뀌지 않으니 카탈로그 등급(5분)으로 둔다. 키에 정렬한
// id 목록을 넣어 같은 화면의 재요청은 캐시를 맞고, 결과는 퍼시스트 블롭이 JSON 이라 Map 대신
// Record 로 든다.
//
// null 은 거른다 — 탈퇴한 회원의 글·댓글(user_id null, 2라운드 탈퇴 정책 #17)이 섞여 오는데 RPC 의
// uuid[] 에 null 을 넣으면 호출 전체가 거절되어 그 화면의 아바타가 통째로 사라진다.
export function useAvatarUrls(userIds: readonly (string | null)[]) {
  const { userId } = useAuth();
  const unique = useMemo(
    () => [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))].sort(),
    [userIds],
  );
  const idsKey = unique.join(",");
  return useQuery<Record<string, string>>({
    queryKey: ["me", userId ?? "", "avatars", idsKey],
    queryFn: async () => {
      const rows: { user_id: string; avatar_path: string | null }[] = [];
      for (const ids of chunk(unique, AVATAR_PATHS_MAX)) {
        const { data, error } = await supabase.rpc("avatar_paths", { p_user_ids: ids });
        if (error) throw new Error(`아바타 조회 실패: ${error.message}`);
        rows.push(...((data ?? []) as { user_id: string; avatar_path: string | null }[]));
      }
      return Object.fromEntries(avatarUrlMap(SUPABASE_URL, rows));
    },
    enabled: !!userId && unique.length > 0,
    staleTime: STALE.catalog,
    meta: { persist: false },
  });
}
