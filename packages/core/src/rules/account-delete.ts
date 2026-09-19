import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeRichText } from "../rich-text";

// 회원 탈퇴(계정 삭제) 규칙. Edge Function `account-delete` 가 이 함수의 어댑터고, 웹도 같은 EF 를
// 부른다(delete-account-button.tsx) — 웹 어댑터는 없다. 계정을 만들 수 있는 앱은 앱 안에 삭제
// 경로가 있어야 한다는 애플·구글 스토어 심사 요건이자, 개인정보 파기 요청을 처리하는 경로다.
//
// 탈퇴 정책(설계서 §12-2 #17): **본인 글만 지우고 타인의 답글은 남긴다.** 글·댓글·메시지 행은 지우지
// 않고 user_id 를 끊은 뒤 닉네임을 "탈퇴한 회원" 으로, 본인이 쓴 **원글·메시지의 내용은 비운다**
// (제목 "탈퇴한 회원의 글"). 댓글 내용은 남긴다 — 남의 스레드 안의 한 줄이라 지우면 그 아래 답글이
// 무슨 말에 대한 답인지 알 수 없다(예전 comments 익명화와 같은 판단). 이렇게 하려면 각 표의 user_id
// 가 nullable + on delete set null 이어야 한다(schema.sql "Phase 5 2라운드" 절 — 예전 cascade 는 원글이
// 지워지며 타인의 댓글까지 같이 지웠다).
//
// 순서가 중요하다:
//  1) 댓글류(comments·board_comments·suggestion_comments·notice_comments)는 user_id null + 닉네임만
//     바꾸고 내용은 유지.
//  2) 원글류(board_posts·suggestions·chat_messages)는 user_id null + 닉네임 + **내용 비움**.
//     board_posts 는 content_html 이 새니타이저 통과값이어야 하므로(금지선) 상수를 sanitizeRichText
//     에 한 번 통과시킨 값을 넣고, 썸네일(본문 첫 이미지)은 지운다. suggestions 의 is_secret 은
//     유지한다(비밀글 자리는 비밀글 자리로 남는다). chat_messages 는 내용만 바꾼다.
//  3) cascade 가 없는 참조(uploaded_by / verified_by / answered_by / created_by)를 끊는다 — 참조가
//     남아 있으면 auth.users 삭제가 FK 로 실패한다. 일반 회원에겐 해당 행이 없지만 관리자 계정이
//     탈퇴하면 여기서 막힌다.
//  4) 스토리지(avatars·board-images)의 본인 객체는 deleteUser **전에** 지운다. 스토리지에는 FK 가
//     없어 계정을 지워도 객체가 그대로 남고, 두 버킷 모두 공개라 URL 을 아는 사람은 계속 볼 수 있다.
//  5) auth.admin.deleteUser — 나머지 개인 데이터(응시·오답·메모·북마크·진단·profiles)는 전부
//     user_id 에 on delete cascade 라 함께 사라진다.
//
// 실패 정책:
//  · 1)·2) 의 DB 갱신 실패는 **탈퇴를 멈추고** 오류를 낸다(예전 comments 익명화와 같다). 계정은
//    그대로라 사용자가 다시 누르면 된다. 반대로 진행해 버리면 deleteUser 의 set null 로 user_id 만
//    끊긴 채 닉네임·본문이 그대로 공개로 남고, 그 글을 지울 수 있는 사람이 더는 없다.
//  · 3) 실패도 오류를 낸다 — 끊지 못하면 어차피 deleteUser 가 FK 로 실패한다.
//  · 4) 스토리지 정리 실패는 **로그만 남기고 진행한다.** 정리 실패가 탈퇴 자체를 막으면 "앱 안에서
//    계정을 지울 수 있어야 한다"는 스토어 요건(Apple 5.1.1(v)·Play 사용자 데이터 정책)을 어기게
//    되고, 남은 객체는 주인 없는 파일이라 나중에 일괄 정리할 수 있지만 지우지 못한 계정은 사용자가
//    스스로 복구할 방법이 없다.
//
// ⚠ Apple 로그인으로 가입한 계정은 Apple 요구사항상 토큰 폐기(revoke)까지 해야 완전하다. Apple
//    Developer > Keys 의 .p8 로 client_secret JWT 를 만들어 https://appleid.apple.com/auth/revoke 를
//    호출하는 단계인데, 그 키가 아직 없어서 빠져 있다. 키를 발급하면 deleteUser 직전에 추가할 것.

// *_nickname_len 제약(1~10자) 안에 들어가야 한다.
export const ANONYMIZED_NICKNAME = "탈퇴한 회원";
// 원글 제목(board_posts·suggestions). title 제약 1~100자.
export const DELETED_POST_TITLE = "탈퇴한 회원의 글";
// 원글 본문(board_posts.content_text·suggestions.content). content_html 은 아래 함수가 만든다.
export const DELETED_POST_TEXT = "탈퇴한 회원의 글입니다.";
export const DELETED_CHAT_TEXT = "탈퇴한 회원의 메시지입니다.";

// board_posts.content_html 에 넣을 값. 금지선(docs/agents/board-rich-text.md §1)대로 상수도
// 새니타이저를 통과시킨다 — 이미지 접두사는 없다(본문에 이미지가 없다).
export function deletedPostHtml(): string {
  return sanitizeRichText(`<p>${DELETED_POST_TEXT}</p>`, { imageOrigins: [] });
}

// 정리할 공개 버킷. 둘 다 "{userId}/{uuid}.webp" 로 올리므로(rules/avatar.ts·rules/board.ts) 사용자
// id 디렉터리 하나만 비우면 된다.
export const USER_BUCKETS = ["avatars", "board-images"] as const;

// 댓글류 — 내용 유지, user_id 끊고 닉네임만 바꾼다. 순서가 곧 규칙이라 배열로 고정한다.
const COMMENT_TABLES = ["comments", "board_comments", "suggestion_comments", "notice_comments"] as const;

// cascade 가 없는 참조. suggestions.answered_by 는 SQL 도 on delete set null 로 바꿨지만 그 절이 아직
// 운영에 적용되기 전에도 탈퇴가 막히지 않게 여기서도 끊는다. notices.created_by 는 on delete 규칙이
// 없는 채로 남아 있어(관리자 작성 흔적) 공지를 쓴 관리자가 탈퇴하면 여기서 끊어야 deleteUser 가 된다.
const DETACH: readonly { table: string; column: string }[] = [
  { table: "exam_papers", column: "uploaded_by" },
  { table: "answer_keys", column: "uploaded_by" },
  { table: "law_digests", column: "verified_by" },
  { table: "suggestions", column: "answered_by" },
  { table: "notices", column: "created_by" },
];

export type AccountDeleteError = { error: string; status: 500 };

export type AccountDeleteDeps = {
  // 정리 실패 로그. 기본 console.error — 테스트가 잡으려고 주입한다.
  log?: (message: string, detail?: unknown) => void;
};

const COMMENT_CLEANUP_FAILED = "댓글 정리에 실패했어요. 잠시 후 다시 시도해 주세요.";
const POST_CLEANUP_FAILED = "글 정리에 실패했어요. 잠시 후 다시 시도해 주세요.";
const ACCOUNT_CLEANUP_FAILED = "계정 정리에 실패했어요. 잠시 후 다시 시도해 주세요.";
const ACCOUNT_DELETE_FAILED = "계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요.";

export async function deleteAccount(
  client: SupabaseClient,
  input: { userId: string },
  deps: AccountDeleteDeps = {},
): Promise<AccountDeleteError | { ok: true }> {
  const log = deps.log ?? ((message: string, detail?: unknown) => console.error(message, detail));
  const userId = input.userId;

  // 1) 댓글 익명화.
  for (const table of COMMENT_TABLES) {
    const { error } = await client
      .from(table)
      .update({ user_id: null, nickname: ANONYMIZED_NICKNAME })
      .eq("user_id", userId);
    if (error) {
      log(`[account-delete] ${table} 익명화 실패:`, error.message);
      return { error: COMMENT_CLEANUP_FAILED, status: 500 };
    }
  }

  // 2) 원글 비우기.
  const postWrites: { table: string; values: Record<string, unknown> }[] = [
    {
      table: "board_posts",
      values: {
        user_id: null,
        nickname: ANONYMIZED_NICKNAME,
        title: DELETED_POST_TITLE,
        content_html: deletedPostHtml(),
        content_text: DELETED_POST_TEXT,
        thumbnail_url: null,
      },
    },
    {
      table: "suggestions",
      values: {
        user_id: null,
        nickname: ANONYMIZED_NICKNAME,
        title: DELETED_POST_TITLE,
        content: DELETED_POST_TEXT,
      },
    },
    {
      table: "chat_messages",
      values: { user_id: null, nickname: ANONYMIZED_NICKNAME, content: DELETED_CHAT_TEXT },
    },
  ];
  for (const { table, values } of postWrites) {
    const { error } = await client.from(table).update(values).eq("user_id", userId);
    if (error) {
      log(`[account-delete] ${table} 비우기 실패:`, error.message);
      return { error: POST_CLEANUP_FAILED, status: 500 };
    }
  }

  // 3) cascade 가 없는 참조 끊기.
  for (const { table, column } of DETACH) {
    const { error } = await client
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);
    if (error) {
      log(`[account-delete] ${table}.${column} 끊기 실패:`, error.message);
      return { error: ACCOUNT_CLEANUP_FAILED, status: 500 };
    }
  }

  // 4) 공개 버킷의 본인 객체. deleteUser **전에** 한다. 두 순서의 실패 모양을 비교하면 이쪽이 낫다:
  //    여기서 지우고 deleteUser 가 실패하면 사용자가 탈퇴를 다시 눌러 끝낼 수 있지만(사진이 먼저
  //    사라질 뿐 복구 가능한 상태다), 반대로 두면 deleteUser 뒤 이 함수가 중간에 끊겼을 때 **어느
  //    id 의 객체가 남았는지 아는 행이 하나도 안 남는다**(profiles 도 cascade 로 같이 사라진다) —
  //    공개 버킷에 영구히 떠 있는 사진을 나중에 찾아낼 방법이 없다.
  await purgeUserObjects(client, userId, log);

  // 5) 계정 삭제 — 나머지 개인 데이터는 cascade 로 함께 지워진다.
  const { error: deleteError } = await client.auth.admin.deleteUser(userId);
  if (deleteError) {
    log("[account-delete] deleteUser 실패:", deleteError.message);
    return { error: ACCOUNT_DELETE_FAILED, status: 500 };
  }

  return { ok: true };
}

// 한 사용자의 버킷 객체를 지운다. **실패해도 던지지 않는다**(머리말의 실패 정책).
export async function purgeUserObjects(
  client: SupabaseClient,
  userId: string,
  log: (message: string, detail?: unknown) => void,
): Promise<void> {
  for (const bucket of USER_BUCKETS) {
    try {
      // 한 장짜리 list 로 끝내지 않고 **빌 때까지** 돈다. 아바타는 언제나 1개지만 게시판 이미지는
      // 시간당 60장까지 올릴 수 있어(rules/hourly-limit.ts BOARD_HOURLY_IMAGE_LIMIT) 오래 쓴
      // 계정이면 한 페이지를 넘길 수 있다 — 거기서 멈추면 "지웠다"고 응답해 놓고 공개 URL 로
      // 남는 사진이 생긴다. 지운 만큼 뒷장이 앞으로 당겨지므로 offset 을 올리지 않고 언제나 첫
      // 장을 다시 읽는다.
      // 페이지 수에 천장을 둔다. remove() 가 오류 없이 아무것도 지우지 않는 상황이 생기면(있어서는
      // 안 되지만) 아래 루프는 같은 100개를 영원히 다시 읽는다 — 그러면 함수가 플랫폼 타임아웃까지
      // 매달려 **탈퇴 자체가 끝나지 않는다**. 5,000개면 어떤 계정도 넘지 않는 수이고, 넘으면 남은
      // 것은 로그를 보고 일괄 정리한다.
      for (let page = 0; page < 50; page++) {
        const { data, error } = await client.storage.from(bucket).list(userId, { limit: 100 });
        if (error) {
          log(`[account-delete] ${bucket} 목록 실패:`, error.message);
          break;
        }
        const paths = (data ?? []).map((f: { name: string }) => `${userId}/${f.name}`);
        if (paths.length === 0) break;
        const { error: removeError } = await client.storage.from(bucket).remove(paths);
        if (removeError) {
          // 지우지 못한 것을 다시 목록에서 만나면 무한 반복이 된다 — 한 번 실패하면 그만둔다.
          log(`[account-delete] ${bucket} 삭제 실패:`, removeError.message);
          break;
        }
        if (paths.length < 100) break;
      }
    } catch (e) {
      log(`[account-delete] ${bucket} 정리 중 예외:`, e);
    }
  }
}
