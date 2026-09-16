import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import { removeUserAvatar, uploadUserAvatar } from "./avatar";
import { AVATAR_SIZE } from "../avatar";

// 프로필 사진 규칙(설계서 §6.7 #16). 웹 서버 액션과 Edge `avatar-upload` 가 **이 함수**를
// 부르므로, 여기서 지키는 것이 곧 두 경로가 같다는 뜻이다. 보는 것은 넷:
//   1. 순서 — 검사 → 업로드 → profiles → user_metadata → **예전 사진 삭제는 맨 뒤**.
//      먼저 지우면 업로드가 실패한 계정의 사진만 사라진다.
//   2. 되돌리기 — profiles 에 경로를 못 적었으면 방금 올린 객체는 주인 없는 파일이라 지운다.
//   3. 이중 기록 — profiles.avatar_path 와 user_metadata.avatar_path 가 **둘 다** 바뀐다
//      (헤더·앱 상단은 JWT 만 읽고 그린다 — 한쪽만 적으면 예전 사진이 계속 남는다).
//   4. 남의 경로는 지우지 않는다(isOwnAvatarPath) — profiles 에 쓰기 정책이 열리는 날의 방어선.

const USER = "1111-2222";
const OTHER = "9999-8888";
const UUID = "aaaa-bbbb";
const PATH = `${USER}/${UUID}.webp`;

// 256×256 손실 webp 의 헤더만. avatarBytesError 는 앞 30바이트만 읽으므로 이걸로 충분하다
// (진짜 인코더를 부르면 무엇을 검사했는지가 오히려 흐려진다 — avatar.test.ts 와 같은 방침).
function webp(side = AVATAR_SIZE): Uint8Array {
  const bytes = new Uint8Array(30);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  // 오프셋 4의 RIFF 길이 = 파일 크기 - 8(avatarBytesError 가 "선언보다 뒤에 더 붙어
  // 있는가"를 이 값으로 본다). 인코더는 언제나 정확히 맞춘다.
  bytes[4] = bytes.length - 8;
  put(8, "WEBP");
  put(12, "VP8 ");
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes[26] = side & 0xff;
  bytes[27] = (side >> 8) & 0x3f;
  bytes[28] = side & 0xff;
  bytes[29] = (side >> 8) & 0x3f;
  return bytes;
}

function db(profiles: Row[] = [], users: Row[] = [{ id: USER, user_metadata: {} }]) {
  return new FakeSupabase({ profiles, users }, { primaryKeys: { profiles: ["user_id"] } });
}

const deps = { randomUuid: () => UUID };

test("업로드: profiles 행이 없으면 만들고, 경로를 두 곳에 적는다", async () => {
  const fake = db([], [{ id: USER, user_metadata: { nickname: "공모아" } }]);
  const result = await uploadUserAvatar(asClient(fake), { userId: USER, webp: webp(), metadataNickname: "공모아" }, deps);

  assert.deepEqual(result, { avatarPath: PATH });
  assert.deepEqual(fake.uploads, [{ bucket: "avatars", paths: [PATH] }]);
  // 지울 예전 사진이 없었다.
  assert.deepEqual(fake.removes, []);
  assert.equal(fake.rowsOf("profiles")[0]?.avatar_path, PATH);
  assert.equal(fake.rowsOf("profiles")[0]?.nickname, "공모아");
  assert.equal((fake.rowsOf("users")[0]?.user_metadata as Row)?.avatar_path, PATH);
});

test("업로드: 예전 사진은 새 사진이 자리를 잡은 뒤에 지운다", async () => {
  const stale = `${USER}/old.webp`;
  const fake = db([{ user_id: USER, nickname: "공모아", avatar_path: stale }]);
  const result = await uploadUserAvatar(asClient(fake), { userId: USER, webp: webp(), metadataNickname: "공모아" }, deps);

  assert.deepEqual(result, { avatarPath: PATH });
  assert.equal(fake.rowsOf("profiles")[0]?.avatar_path, PATH);
  // 업로드가 먼저, 삭제가 나중. 지운 것은 옛 경로 하나뿐이다.
  assert.deepEqual(fake.uploads, [{ bucket: "avatars", paths: [PATH] }]);
  assert.deepEqual(fake.removes, [{ bucket: "avatars", paths: [stale] }]);
});

test("업로드: profiles 에 못 적으면 방금 올린 객체를 되지운다", async () => {
  const fake = db([{ user_id: USER, nickname: "공모아", avatar_path: null }]);
  // 첫 select 는 통과해야 하므로 update 차례에 맞춰 실패를 심는다.
  fake.failNext.set("profiles", "boom");
  const result = await uploadUserAvatar(asClient(fake), { userId: USER, webp: webp(), metadataNickname: "공모아" }, deps);

  assert.deepEqual(result, { error: "저장에 실패했어요.", status: 500 });
  assert.deepEqual(fake.removes, [{ bucket: "avatars", paths: [PATH] }]);
});

test("업로드: 규격 밖 바이트는 버킷을 건드리지 않는다", async () => {
  const fake = db();
  const tooBig = await uploadUserAvatar(asClient(fake), { userId: USER, webp: webp(AVATAR_SIZE + 1) }, deps);
  assert.deepEqual(tooBig, { error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.", status: 400 });
  assert.deepEqual(fake.uploads, []);
  assert.deepEqual(fake.writes, []);
});

test("업로드 실패: 버킷이 없으면 다시 시도하라고 하지 않는다", async () => {
  const fake = db();
  fake.failNextUpload = "Bucket not found";
  const result = await uploadUserAvatar(asClient(fake), { userId: USER, webp: webp() }, deps);
  assert.deepEqual(result, {
    error: "이미지 저장소가 아직 준비되지 않았어요. 운영자에게 알려주세요.",
    status: 500,
  });
  // 경로를 적지 않았다.
  assert.deepEqual(fake.writes, []);
});

test("삭제: 두 곳의 경로를 비운 뒤 객체를 지운다", async () => {
  const fake = db([{ user_id: USER, nickname: "공모아", avatar_path: PATH }], [
    { id: USER, user_metadata: { nickname: "공모아", avatar_path: PATH } },
  ]);
  const result = await removeUserAvatar(asClient(fake), { userId: USER });

  assert.deepEqual(result, { avatarPath: null });
  assert.equal(fake.rowsOf("profiles")[0]?.avatar_path, null);
  assert.equal((fake.rowsOf("users")[0]?.user_metadata as Row)?.avatar_path, null);
  // 닉네임 같은 다른 메타데이터는 남는다(top-level 키 단위 병합).
  assert.equal((fake.rowsOf("users")[0]?.user_metadata as Row)?.nickname, "공모아");
  assert.deepEqual(fake.removes, [{ bucket: "avatars", paths: [PATH] }]);
});

test("삭제: 남의 경로가 적혀 있으면 그 객체는 지우지 않는다", async () => {
  const foreign = `${OTHER}/x.webp`;
  const fake = db([{ user_id: USER, nickname: "공모아", avatar_path: foreign }]);
  const result = await removeUserAvatar(asClient(fake), { userId: USER });

  assert.deepEqual(result, { avatarPath: null });
  // 내 행의 경로는 비우되, 남의 사진은 건드리지 않는다.
  assert.equal(fake.rowsOf("profiles")[0]?.avatar_path, null);
  assert.deepEqual(fake.removes, []);
});
