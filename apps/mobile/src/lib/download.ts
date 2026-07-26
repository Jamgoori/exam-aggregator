import { Platform } from "react-native";
import RNBlobUtil from "react-native-blob-util";
import { supabase } from "./supabase";
import { publicUrl } from "./storage";

// 원본 PDF 내려받기/열기. 웹은 /download/[id] 라우트가 카운트를 올린 뒤 Storage 로
// 넘기는데(app/download/[id]/route.ts), 앱은 Storage 공개 URL 을 직접 받으므로 그
// 라우트를 안 지난다 — 그래서 같은 RPC(increment_download_count)를 여기서 호출한다.
// 안 그러면 앱 다운로드가 홈의 "누적 다운로드" 집계에서 통째로 빠진다.
//
// 새 의존성 없이 이미 있는 react-native-blob-util 로 받아서 OS 기본 뷰어/공유 시트에
// 넘긴다(iOS previewDocument, Android ACTION_VIEW).

export async function countDownload(paperId: string): Promise<void> {
  // 집계용이라 실패해도 사용자 흐름을 막지 않는다.
  try {
    await supabase.rpc("increment_download_count", { paper_id: paperId });
  } catch {
    // 무시
  }
}

function safeFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "exam";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

// 파일을 앱 캐시로 받은 뒤 OS 에 넘긴다. 사용자는 거기서 저장·공유·다른 앱으로 열기를
// 고를 수 있다.
export async function downloadAndOpenPdf(
  paperId: string,
  filePath: string,
  fileName: string,
): Promise<void> {
  const url = publicUrl(filePath);
  const target = `${RNBlobUtil.fs.dirs.CacheDir}/${safeFileName(fileName)}`;

  const res = await RNBlobUtil.config({ path: target, fileCache: true }).fetch("GET", url);
  const path = res.path();

  await countDownload(paperId);

  if (Platform.OS === "ios") {
    await RNBlobUtil.ios.previewDocument(path);
  } else {
    await RNBlobUtil.android.actionViewIntent(path, "application/pdf");
  }
}
