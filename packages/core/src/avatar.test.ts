import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarInitial,
  avatarPublicUrl,
  avatarUploadError,
  AVATAR_MAX_BYTES,
} from "./avatar";

test("업로드 검증: 형식과 크기", () => {
  assert.equal(avatarUploadError({ type: "image/jpeg", size: 1000 }), null);
  assert.match(
    avatarUploadError({ type: "application/pdf", size: 1000 }) ?? "",
    /이미지만/,
  );
  assert.match(
    avatarUploadError({ type: "image/png", size: AVATAR_MAX_BYTES + 1 }) ?? "",
    /5MB/,
  );
  assert.match(avatarUploadError({ type: "image/png", size: 0 }) ?? "", /선택/);
});

test("아바타 글자는 코드포인트 단위로 자른다", () => {
  assert.equal(avatarInitial("공모아"), "공");
  assert.equal(avatarInitial("  띄어쓰기"), "띄");
  // 이모지가 반으로 잘리면 깨진 글자가 그려진다.
  assert.equal(avatarInitial("🎓학생"), "🎓");
  assert.equal(avatarInitial(""), "회");
});

test("공개 URL", () => {
  assert.equal(
    avatarPublicUrl("https://p.supabase.co/", "u1/a.webp"),
    "https://p.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
  );
  assert.equal(avatarPublicUrl("https://p.supabase.co", null), null);
  // user_metadata 는 사용자가 직접 고칠 수 있으므로 서버가 만든 모양이 아니면 버린다.
  assert.equal(avatarPublicUrl("https://p.supabase.co", "../exam-papers/2024/x.pdf"), null);
  assert.equal(avatarPublicUrl("https://p.supabase.co", "u1/a.webp?x=1"), null);
  assert.equal(avatarPublicUrl("https://p.supabase.co", "u1/a.png"), null);
});
