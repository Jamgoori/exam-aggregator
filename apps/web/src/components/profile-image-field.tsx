"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { removeAvatar, uploadAvatar } from "@/app/actions";
import { Avatar } from "@/components/user-menu";
import { avatarUploadError, AVATAR_MAX_BYTES } from "@gongmoa/core";

// 내 정보 수정 화면의 프로필 사진 칸.
//
// 파일을 고르면 곧바로 올린다(따로 저장 버튼이 없다) — 사진은 "고른다 = 바꾼다"가
// 자연스러운 값이고, 저장 버튼을 두면 고른 뒤 안 누르고 나가는 사람이 반드시 생긴다.
//
// 미리보기는 서버 응답을 기다리지 않고 로컬 objectURL 로 먼저 바꾼다. 업로드가
// 실패하면 원래 사진으로 되돌린다 — 성공이 압도적으로 흔한 동작이라, 이쪽이
// "누르면 바로 바뀐다"는 감각을 준다.
export function ProfileImageField({
  nickname,
  initialAvatarUrl,
}: {
  nickname: string;
  initialAvatarUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialAvatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비워둔다.
    e.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);

    // 서버가 최종 관문이지만, 20MB 짜리 사진을 다 올려보낸 뒤 "안 된다"고 하면
    // 모바일 데이터만 쓰고 끝난다. 같은 함수로 여기서 먼저 걸러낸다.
    const invalid = avatarUploadError({ type: file.type, size: file.size });
    if (invalid) {
      setError(invalid);
      return;
    }

    const localUrl = URL.createObjectURL(file);
    const rollback = preview;
    setPreview(localUrl);

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadAvatar(formData);
      URL.revokeObjectURL(localUrl);
      if (result.error) {
        setPreview(rollback);
        setError(result.error);
        return;
      }
      setPreview(result.avatarUrl ?? null);
      setMessage("프로필 사진을 변경했어요.");
      // 헤더·서랍의 아바타도 같이 바뀌게 서버 컴포넌트를 다시 그린다.
      router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    setMessage(null);
    const rollback = preview;
    setPreview(null);
    startTransition(async () => {
      const result = await removeAvatar();
      if (result.error) {
        setPreview(rollback);
        setError(result.error);
        return;
      }
      setMessage("프로필 사진을 지웠어요.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar nickname={nickname} avatarUrl={preview} size="xl" />
          {/* 아바타 위에 겹치는 카메라 버튼 — 사진 자체가 "누르는 곳"이라는 것을
              아이콘 하나로 알린다(모바일에서 별도 버튼을 찾게 하지 않는다). */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            aria-label="프로필 사진 변경"
            className="absolute -right-1 -bottom-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60 dark:border-zinc-900"
          >
            <Camera size={15} />
          </button>
          {pending && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60 text-[11px] font-medium text-zinc-600 dark:bg-black/50 dark:text-zinc-200">
              올리는 중
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
            >
              사진 올리기
            </button>
            {preview && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={pending}
                className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:text-red-400"
              >
                <Trash2 size={14} />
                삭제
              </button>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            JPG·PNG·WEBP·GIF, {Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))}MB 이하.
            정사각형으로 잘려 저장돼요.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={handlePick}
        className="hidden"
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && !error && (
        <p className="text-sm text-green-600 dark:text-green-400">{message}</p>
      )}
    </div>
  );
}
