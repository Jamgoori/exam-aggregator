import { avatarUploadError, AVATAR_MAX_BYTES } from "@gongmoa/core";
import * as ImagePicker from "expo-image-picker";
import { Camera, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Avatar } from "../avatar";
import { Button } from "../button";
import { bakeAvatarWebp } from "../../lib/avatar-image";
import { handleEdgeError } from "../../lib/edge";
import { useAvatarUpload } from "../../queries/avatars";
import { useAuth } from "../../providers/auth-provider";
import { themedIcon } from "../../theme/icons";

// 내 정보 수정 화면의 프로필 사진 칸(웹 profile-image-field.tsx 1:1, 설계서 §7.1 프로필/아바타).
//
// 사진을 고르면 곧바로 올린다(따로 저장 버튼이 없다) — 사진은 "고른다 = 바꾼다"가 자연스러운
// 값이고, 저장 버튼을 두면 고른 뒤 안 누르고 나가는 사람이 반드시 생긴다.
//
// 미리보기는 서버 응답을 기다리지 않고 방금 고른 로컬 파일로 먼저 바꾼다. 실패하면 원래
// 사진으로 되돌린다 — 성공이 압도적으로 흔한 동작이라 이쪽이 "누르면 바로 바뀐다"는 감각을 준다.
//
// 웹과 다른 곳은 굽는 자리 하나뿐이다: 웹은 서버(sharp)가 굽고, 앱은 보내기 전에 Skia 로
// 굽는다(lib/avatar-image.ts — Deno 에는 sharp 가 없다). 검사·저장 규칙은 core rules/avatar.ts
// 한 벌이고 EF 가 최종 관문이다.
const CameraIcon = themedIcon(Camera);
const TrashIcon = themedIcon(Trash2);

// 굽기가 끝나 EF 응답을 기다리는 동안 catch 로 떨어질 때의 마지막 문구(웹 handlePick 의
// catch 와 같은 문장). 서버가 문구를 준 경우에는 그 문장을 그대로 쓴다.
const FALLBACK_ERROR = "사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.";

export function AvatarField() {
  const { nickname, avatarUrl } = useAuth();
  const upload = useAvatarUpload();
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handlePick() {
    setError(null);
    setMessage(null);

    // iOS PHPicker·Android Photo Picker 는 권한 요청 없이 열리고(앱은 사용자가 고른 한 장만
    // 받는다), 구형 안드로이드에서만 OS 가 알아서 권한 창을 띄운다. 그래서 여기서 따로
    // requestMediaLibraryPermissionsAsync 를 부르지 않는다 — 부르면 최신 OS 에서도 굳이
    // "전체 보관함 접근" 을 묻는 창이 한 번 더 뜬다.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // 정사각형 크롭 UI. 웹 sharp 는 내용을 보고 자르지만(position:"attention") 앱은 사용자가
      // 직접 고르게 한다 — 얼굴이 가장자리에 있는 사진에서 결과가 더 낫다.
      allowsEditing: true,
      aspect: [1, 1],
      // 1(최대) 로 두면 안드로이드가 원본 파일을 그대로 base64 로 실어 준다(RawImageExporter).
      // 1 미만이어야 두 플랫폼 다 **JPEG 로 다시 구워** 주고, 그래야 HEIC 처럼 Skia 가 못 읽는
      // 형식이 넘어오지 않는다.
      quality: 0.9,
      base64: true,
      exif: false,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    if (!asset?.base64) {
      setError("이미지를 선택해주세요.");
      return;
    }

    // 서버가 최종 관문이지만, 20MB 짜리 사진을 다 처리한 뒤 "안 된다"고 하면 배터리와
    // 데이터만 쓰고 끝난다. 웹 profile-image-field.tsx 와 **같은 함수·같은 문구**로 먼저 거른다.
    // mimeType 이 비어 오는 기기가 있어 JPEG 를 기본값으로 둔다 — base64 는 위 quality 설정상
    // 두 플랫폼 모두 JPEG 다. fileSize 도 없으면 base64 길이에서 되계산한다(4글자 = 3바이트).
    const invalid = avatarUploadError({
      type: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? Math.floor((asset.base64.length * 3) / 4),
    });
    if (invalid) {
      setError(invalid);
      return;
    }

    const rollback = preview;
    setPreview(asset.uri);
    setPending(true);
    try {
      // 굽기(Skia)는 **동기**라 JS 스레드를 통째로 잡는다 — 앨범 원본이 1200만 화소면
      // 수백 ms 다. 바로 부르면 위에서 켠 "올리는 중" 표시가 그려지기 전에 화면이 멈춰,
      // 사용자에게는 "눌렀는데 아무 일도 안 일어난" 순간이 된다. 한 틱 양보해 렌더를
      // 먼저 내보낸 뒤에 굽는다.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // 256×256 정사각 webp 로 굽는다. 규격 밖이면 여기서 서버와 같은 문구로 던진다.
      const baked = bakeAvatarWebp(asset.base64);
      const result = await upload.mutateAsync({ action: "upload", webpBase64: baked.base64 });
      setPreview(result.avatarUrl ?? null);
      setMessage("프로필 사진을 변경했어요.");
    } catch (e) {
      setPreview(rollback);
      const handled = await handleEdgeError(e, { next: "/mypage/edit" });
      // 401·426 은 화면 이동으로 끝난 것이라 여기서 또 알리지 않는다.
      if (!handled.redirected) setError(handled.message || FALLBACK_ERROR);
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setMessage(null);
    const rollback = preview;
    setPreview(null);
    setPending(true);
    try {
      await upload.mutateAsync({ action: "remove" });
      setMessage("프로필 사진을 지웠어요.");
    } catch (e) {
      setPreview(rollback);
      const handled = await handleEdgeError(e, { next: "/mypage/edit" });
      if (!handled.redirected) setError(handled.message || FALLBACK_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-4">
        <View className="relative">
          <Avatar nickname={nickname} avatarUrl={preview} size="xl" />
          {/* 아바타 위에 겹치는 카메라 버튼 — 사진 자체가 "누르는 곳"이라는 것을 아이콘 하나로
              알린다(작은 화면에서 별도 버튼을 찾게 하지 않는다). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="프로필 사진 변경"
            accessibilityState={{ disabled: pending, busy: pending }}
            disabled={pending}
            onPress={() => void handlePick()}
            hitSlop={6}
            className={[
              "absolute -right-1 -bottom-1 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 active:bg-blue-700 dark:border-zinc-900",
              pending ? "opacity-60" : "",
            ].join(" ")}
          >
            <CameraIcon size={15} colorClassName="text-white" />
          </Pressable>
          {pending && (
            <View className="absolute inset-0 items-center justify-center rounded-full bg-white/60 dark:bg-black/50">
              <AppText variant="11" weight="medium" allowFontScaling={false} className="text-zinc-600 dark:text-zinc-200">
                올리는 중
              </AppText>
            </View>
          )}
        </View>

        <View className="min-w-0 flex-1 gap-2">
          <View className="flex-row flex-wrap gap-2">
            <Button
              variant="outline"
              label="사진 올리기"
              disabled={pending}
              onPress={() => void handlePick()}
              className="rounded-lg px-3 py-1.5"
              textClassName="text-sm font-medium text-zinc-600 dark:text-zinc-300"
            />
            {preview && (
              <Button
                variant="outline"
                label="삭제"
                icon={<TrashIcon size={14} colorClassName="text-zinc-500 dark:text-zinc-400" />}
                disabled={pending}
                onPress={() => void handleRemove()}
                className="gap-1 rounded-lg px-3 py-1.5"
                textClassName="text-sm font-medium text-zinc-500 dark:text-zinc-400"
              />
            )}
          </View>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500" pretty>
            JPG·PNG·WEBP·GIF, {Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))}MB 이하. 정사각형으로 잘려
            저장돼요.
          </AppText>
        </View>
      </View>

      {error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}
      {message && !error && (
        <AppText variant="sm" className="text-green-600 dark:text-green-400">
          {message}
        </AppText>
      )}
    </View>
  );
}
