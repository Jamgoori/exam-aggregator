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
//  3) 스토리지(avatars·board-images)의 본인 객체는 **auth.users 를 지우기 전에** 지운다.
//     스토리지에는 FK 가 없어 계정을 지워도 객체가 그대로 남고, 두 버킷 모두 공개라
//     탈퇴한 뒤에도 URL 을 아는 사람은 사진을 계속 볼 수 있다(설계서 §7.1 (1) —
//     스토어의 "계정 삭제" 요건이 말하는 완전성은 여기까지다).
//  4) 나머지 개인 데이터(응시·오답·메모·북마크·진단·profiles)는 전부 user_id 에
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

// 정리할 공개 버킷. 둘 다 "{userId}/{uuid}.webp" 로 올리므로(core rules/avatar.ts,
// 웹 board/actions.ts#uploadBoardImage) 사용자 id 디렉터리 하나만 비우면 된다.
const USER_BUCKETS = ["avatars", "board-images"];

// 한 사용자의 버킷 객체를 지운다. **실패해도 던지지 않는다** — 정리 실패가 탈퇴 자체를
// 막으면 "앱 안에서 계정을 지울 수 있어야 한다"는 스토어 요건(Apple 5.1.1(v)·Play 사용자
// 데이터 정책)을 어기게 되고, 사용자는 영영 탈퇴하지 못한 채 같은 오류만 다시 본다.
// 남은 객체는 주인 없는 파일이라 나중에 일괄 정리할 수 있지만, 지우지 못한 계정은
// 사용자가 스스로 복구할 방법이 없다. 그래서 오류는 로그에만 남긴다.
async function purgeUserObjects(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<void> {
  for (const bucket of USER_BUCKETS) {
    try {
      // 한 장짜리 list 로 끝내지 않고 **빌 때까지** 돈다. 아바타는 언제나 1개지만
      // 게시판 이미지는 시간당 60장까지 올릴 수 있어(웹 board/actions.ts
      // HOURLY_IMAGE_LIMIT) 오래 쓴 계정이면 한 페이지를 넘길 수 있다 — 거기서 멈추면
      // "지웠다"고 응답해 놓고 공개 URL 로 남는 사진이 생긴다. 지운 만큼 뒷장이 앞으로
      // 당겨지므로 offset 을 올리지 않고 언제나 첫 장을 다시 읽는다.
      // 페이지 수에 천장을 둔다. remove() 가 오류 없이 아무것도 지우지 않는 상황이
      // 생기면(있어서는 안 되지만) 아래 루프는 같은 100개를 영원히 다시 읽는다 — 그러면
      // 함수가 플랫폼 타임아웃까지 매달려 **탈퇴 자체가 끝나지 않는다**. 5,000개면 어떤
      // 계정도 넘지 않는 수이고, 넘으면 남은 것은 로그를 보고 일괄 정리한다.
      for (let page = 0; page < 50; page++) {
        const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 100 });
        if (error) {
          console.error(`[account-delete] ${bucket} 목록 실패:`, error.message);
          break;
        }
        const paths = (data ?? []).map((f: { name: string }) => `${userId}/${f.name}`);
        if (paths.length === 0) break;
        const { error: removeError } = await admin.storage.from(bucket).remove(paths);
        if (removeError) {
          // 지우지 못한 것을 다시 목록에서 만나면 무한 반복이 된다 — 한 번 실패하면 그만둔다.
          console.error(`[account-delete] ${bucket} 삭제 실패:`, removeError.message);
          break;
        }
        if (paths.length < 100) break;
      }
    } catch (e) {
      console.error(`[account-delete] ${bucket} 정리 중 예외:`, e);
    }
  }
}

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

  // 3) 공개 버킷의 본인 객체. 설계서 §7.1 대로 deleteUser **전에** 한다. 두 순서의
  //    실패 모양을 비교하면 이쪽이 낫다: 여기서 지우고 deleteUser 가 실패하면 사용자가
  //    탈퇴를 다시 눌러 끝낼 수 있지만(사진이 먼저 사라질 뿐 복구 가능한 상태다),
  //    반대로 두면 deleteUser 뒤 이 함수가 중간에 끊겼을 때 **어느 id 의 객체가 남았는지
  //    아는 행이 하나도 안 남는다**(profiles 도 cascade 로 같이 사라진다) — 공개 버킷에
  //    영구히 떠 있는 사진을 나중에 찾아낼 방법이 없다.
  await purgeUserObjects(admin, userId);

  // 4) 계정 삭제 — 나머지 개인 데이터는 cascade 로 함께 지워진다.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return json({ error: "계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요." }, 500);
  }

  return json({ ok: true });
});
