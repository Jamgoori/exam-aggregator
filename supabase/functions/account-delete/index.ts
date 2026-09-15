// 회원 탈퇴(계정 삭제). 계정을 만들 수 있는 앱은 앱 안에 삭제 경로가 있어야 한다는
// 애플·구글 스토어 심사 요건이자, 개인정보 파기 요청을 처리하는 경로다. 웹·앱이 같은
// 함수를 부른다.
//
// 순서가 중요하다:
//  1) 댓글은 지우지 않고 익명화한다 — 대댓글이 달린 원댓글이 사라지면 남이 쓴 스레드가
//     끊기기 때문. user_id 를 끊고 닉네임만 "탈퇴한 회원"으로 바꾼다. (comments 에는
//     "user_id 가 null 이면 비회원" 같은 제약이 없어서 이 상태가 허용된다. 비회원
//     댓글과 달리 password_hash 가 없으므로 이후 누구도 수정·삭제할 수 없다.)
//  2) uploaded_by / verified_by 는 on delete 규칙이 없는 FK(관리자 업로드·검수 흔적)라
//     참조가 남아 있으면 auth.users 삭제가 실패한다. 먼저 null 로 끊는다.
//  3) 나머지 개인 데이터(응시·오답·메모·북마크·진단·profiles)는 전부 user_id 에
//     on delete cascade 가 걸려 있어 auth.users 행이 지워질 때 함께 사라진다.
//
// ⚠️ Apple 로그인으로 가입한 계정은 Apple 요구사항상 토큰 폐기(revoke)까지 해야 완전하다.
//    Apple Developer > Keys 의 .p8 로 client_secret JWT 를 만들어
//    https://appleid.apple.com/auth/revoke 를 호출하는 단계인데, 그 키가 아직 없어서
//    빠져 있다. 키를 발급하면 deleteUser 직전에 추가할 것.
import { corsHeaders, json } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

// comments_nickname_len 제약(1~10자) 안에 들어가야 한다.
const ANONYMIZED_NICKNAME = "탈퇴한 회원";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const admin = adminClient();

  // 1) 댓글 익명화.
  const { error: commentError } = await admin
    .from("comments")
    .update({ user_id: null, nickname: ANONYMIZED_NICKNAME })
    .eq("user_id", userId);
  if (commentError) {
    return json({ error: "댓글 정리에 실패했어요. 잠시 후 다시 시도해 주세요." }, 500);
  }

  // 2) cascade 가 없는 참조 끊기. 일반 회원에겐 해당 행이 없지만, 관리자 계정이
  //    탈퇴하면 여기서 막히므로 미리 비워둔다.
  const detach: { table: string; column: string }[] = [
    { table: "exam_papers", column: "uploaded_by" },
    { table: "answer_keys", column: "uploaded_by" },
    { table: "law_digests", column: "verified_by" },
  ];
  for (const { table, column } of detach) {
    const { error } = await admin
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);
    if (error) {
      return json({ error: "계정 정리에 실패했어요. 잠시 후 다시 시도해 주세요." }, 500);
    }
  }

  // 3) 계정 삭제 — 나머지 개인 데이터는 cascade 로 함께 지워진다.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return json({ error: "계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요." }, 500);
  }

  return json({ ok: true });
});
