// 업로드 전에 브라우저에서 사진을 줄인다.
//
// 왜 필요한가: 업로드는 서버 액션으로 간다. 서버 액션의 요청 본문 상한은
// Next 기본 1MB, 올려 잡아도 Vercel 서버리스 함수의 4.5MB 가 천장이다. 요즘
// 휴대폰 사진 한 장이 3~8MB 라, 원본을 그대로 보내면 **파일 선택만 하고 아무 일도
// 일어나지 않는다**(플랫폼이 요청을 거절하고, 그 실패는 액션 호출부에서 예외로
// 튄다). 어차피 서버가 sharp 로 1600px webp 로 다시 굽기 때문에, 그 크기를 여기서
// 미리 맞춰 보내면 오가는 양이 수백 KB 로 줄고 업로드도 눈에 띄게 빨라진다.
//
// 서버의 리사이즈·형식 강제를 대신하는 것이 **아니다**. 여기는 편의이고, 크기·형식의
// 관문은 여전히 서버 액션 한 곳이다(docs/agents/board-rich-text.md).
//
// 실패하면 원본을 그대로 돌려준다 — 브라우저가 못 여는 형식(일부 HEIC 등)에서
// 업로드 자체를 막아버리면, 서버는 처리할 수 있는 파일까지 놓친다.

// 서버 액션으로 보낼 수 있는 실질 상한. next.config.ts 의 bodySizeLimit(4MB)에서
// 폼 경계·필드 이름 등 부대 비용을 뺀 여유값이다.
export const UPLOAD_BODY_LIMIT_BYTES = 3.5 * 1024 * 1024;

// 이보다 작으면 다시 굽지 않는다. 재인코딩은 화질을 한 번 더 깎으므로, 그냥
// 보내도 되는 파일은 원본 그대로 보내는 편이 낫다.
const SKIP_RESIZE_BELOW_BYTES = 400 * 1024;

type PrepareOptions = {
  // 긴 변 상한(px). 게시판 본문 1600, 프로필 사진 512.
  maxEdge: number;
  quality?: number;
};

export async function prepareImageUpload(
  file: File,
  { maxEdge, quality = 0.85 }: PrepareOptions,
): Promise<File> {
  if (typeof document === "undefined") return file;

  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    source = await decodeImage(file);
    if (!source) return file;

    const width = source.width;
    const height = source.height;
    if (!width || !height) return file;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    // 이미 작고 가벼우면 손대지 않는다.
    if (scale === 1 && file.size <= SKIP_RESIZE_BELOW_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    // webp 를 먼저 시도한다(투명도가 살고 용량이 작다). 인코더가 없는 브라우저는
    // 요청한 형식을 무시하고 png 를 돌려주므로 — 사진 png 는 원본보다 커진다 —
    // 나온 blob 의 type 을 보고 jpeg 로 다시 굽는다.
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") {
      blob = await toBlob(canvas, "image/jpeg", quality);
    }
    if (!blob) return file;

    // 줄였는데 더 커졌으면(이미 잘 압축된 작은 사진) 원본이 낫다.
    if (blob.size >= file.size && scale === 1) return file;

    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${baseName(file.name)}.${ext}`, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    // 디코딩·인코딩 중 무엇이 실패하든 원본으로 넘어간다(위 머리말 참고).
    return file;
  } finally {
    if (source && "close" in source) source.close();
  }
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  // imageOrientation: EXIF 회전을 픽셀에 반영해서 눕는 사진을 막는다.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 아래 <img> 경로로 넘어간다.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function baseName(name: string): string {
  const trimmed = name.replace(/\.[^.]+$/, "").slice(0, 40);
  return trimmed || "image";
}
