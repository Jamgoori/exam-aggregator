// 프로필 사진 등록·삭제(설계서 §6.7 #16·§7.1 "프로필/아바타"). 웹 서버 액션
// app/actions.ts#uploadAvatar/removeAvatar 와 같은 규칙(core rules/avatar.ts)을 부르는
// 다른 어댑터다 — avatars 버킷에는 쓰기 정책이 없으므로(§6.1 금지선) 앱이 버킷에 직접
// 올릴 길은 없고, 이 함수가 앱의 서버 액션 역할을 한다.
//
// ⚠ **굽는 일은 여기서 하지 않는다.** 웹은 sharp 로 256px webp 를 굽지만 Deno 에는
// sharp 가 없고, WASM 이미지 코덱을 넣으면 콜드스타트·메모리를 아바타 하나 때문에
// 요청마다 치른다. 앱이 이미 들고 있는 @shopify/react-native-skia 로 굽고(새 네이티브
// 의존은 OTA 를 깨고 APK 재빌드를 강제한다) 서버는 **검사만** 한다. 검사는 디코딩이
// 아니라 헤더 읽기다 — core avatarBytesError 가 RIFF/WEBP 매직바이트·캔버스 크기·
// 애니메이션 여부를 본다. 클라이언트가 말하는 MIME·확장자는 근거로 쓰지 않는다.
//
// 이미지는 base64 문자열로 받는다(계약: core edge/contracts.ts AvatarUploadRequest).
// multipart 는 supabase-js invoke 로 다루기 번거롭고, JSON 한 필드면 invokeEdge 를 그대로
// 쓴다. 대신 base64 는 33% 부푸므로 **디코딩 전에** 문자 수로 먼저 거른다 — 거대한
// 문자열을 굳이 바이트 배열로 펼치지 않으려는 것이다.
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  avatarPublicUrl,
  removeUserAvatar,
  uploadUserAvatar,
  AVATAR_BASE64_MAX_CHARS,
} from "../_shared/core.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  const admin = coreAdmin();
  const action = String(body.action ?? "");

  if (action === "remove") {
    const removed = await removeUserAvatar(admin, { userId });
    if ("error" in removed) return json({ error: removed.error }, removed.status);
    return json({ success: true, avatarPath: null, avatarUrl: null });
  }

  if (action !== "upload") return json({ error: "잘못된 요청입니다." }, 400);

  const encoded = String(body.webpBase64 ?? "");
  if (!encoded) return json({ error: "이미지를 선택해주세요." }, 400);
  if (encoded.length > AVATAR_BASE64_MAX_CHARS) {
    return json({ error: "이미지가 너무 커요. 다른 사진으로 시도해주세요." }, 400);
  }

  let webp: Uint8Array;
  try {
    // atob 은 base64 가 아닌 문자가 섞이면 던진다 — 데이터 URL 접두를 붙여 보내는
    // 클라이언트도 여기서 걸러진다(계약은 본문만 받는다).
    const binary = atob(encoded);
    webp = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) webp[i] = binary.charCodeAt(i);
  } catch {
    return json({ error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요." }, 400);
  }

  const result = await uploadUserAvatar(admin, { userId, webp });
  if ("error" in result) return json({ error: result.error }, result.status);

  return json({
    success: true,
    avatarPath: result.avatarPath,
    // 앱은 이 URL 만 쓴다 — 경로 → URL 변환 규칙(isValidAvatarPath)은 서버가 쥔다.
    avatarUrl: avatarPublicUrl(SUPABASE_URL, result.avatarPath),
  });
});
