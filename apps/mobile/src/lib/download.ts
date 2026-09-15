import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { supabase } from "./supabase";
import { publicUrl } from "./storage";

// 원본·정답 PDF 저장/공유(설계서 §5 `/download` 행).
//
// 앱은 웹 /download/* 라우트를 절대 호출하지 않는다(로그인 리다이렉트·봇 필터·geo-block
// 대상이라 앱 요청은 막히고 집계도 안 된다). 보기는 react-native-pdf 에 Storage 공개 URL 을
// 직접 주고, 저장/공유는 여기서 expo-file-system 신 API 로 캐시에 받은 뒤 expo-sharing
// 시트 하나로 iOS "파일에 저장"·Android "다운로드에 저장"·카카오톡 공유를 모두 맡긴다
// (앱이 직접 Downloads/MediaStore 에 쓰지 않음 → 권한 요청 없음).
//
// 캐시: Paths.cache/pdf/<paperId>-<kind>/<safeFileName>. 50MB 초과 시 오래된 것부터 삭제,
// 로그아웃과 무관하게 유지(정답 PDF 도 공개 파일이라 캐시 금지 대상이 아니다).
export type PdfKind = "paper" | "answer";

const PDF_DIR = new Directory(Paths.cache, "pdf");
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

// **화면에 붙일 때 주의**: 웹은 /download/[id] 가 요청을 가려서 사람이 누른 것만 센다
// (apps/web/src/lib/download-counting.ts — 봇·프리페치 제외). 여기는 RPC 를 그대로
// 부르므로 그런 판정이 없다. 사용자가 저장·공유 버튼을 누른 순간에만 부를 것 —
// 뷰어 진입·프리로드·캐시 워밍에서 부르면 다운로드 집계가 열람 수로 부풀어 웹과 뜻이 달라진다.
export async function countDownload(paperId: string): Promise<void> {
  // 집계용이라 실패해도 사용자 흐름을 막지 않는다.
  try {
    await supabase.rpc("increment_download_count", { paper_id: paperId });
  } catch {
    // 무시
  }
}

export function safeFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "exam";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function cacheDirFor(paperId: string, kind: PdfKind): Directory {
  return new Directory(PDF_DIR, `${paperId}-${kind}`);
}

// 캐시에 있으면 그대로, 없으면 받아서 File 을 돌려준다. 여기서는 세지 않는다.
export async function fetchPdfToCache(
  paperId: string,
  kind: PdfKind,
  storagePath: string,
  fileName: string,
): Promise<File> {
  const dir = cacheDirFor(paperId, kind);
  const file = new File(dir, safeFileName(fileName));
  if (file.exists) return file;
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  try {
    await File.downloadFileAsync(publicUrl(storagePath), file);
  } catch (e) {
    // 반쯤 받은 파일이 "캐시 있음" 으로 오판되지 않게 지운다.
    try {
      if (file.exists) file.delete();
    } catch {
      // 무시
    }
    throw e;
  }
  trimPdfCache();
  return file;
}

// 저장/공유 — 사용자가 버튼을 누른 자리에서만 부른다. 이 순간에만 다운로드를 센다.
export async function sharePdf(
  paperId: string,
  kind: PdfKind,
  storagePath: string,
  fileName: string,
): Promise<void> {
  const file = await fetchPdfToCache(paperId, kind, storagePath, fileName);
  await countDownload(paperId);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("이 기기에서는 공유 시트를 열 수 없어요.");
  }
  await Sharing.shareAsync(file.uri, {
    UTI: "com.adobe.pdf",
    mimeType: "application/pdf",
    dialogTitle: safeFileName(fileName),
  });
}

// 50MB 초과 시 오래된 폴더부터 삭제. 동기 API 라 try/catch 로 감싸고 실패는 무시한다.
export function trimPdfCache(): void {
  try {
    if (!PDF_DIR.exists) return;
    const entries = PDF_DIR.list()
      .filter((e): e is Directory => e instanceof Directory)
      .map((dir) => {
        const files = dir.list().filter((f): f is File => f instanceof File);
        const size = files.reduce((s, f) => s + (f.size ?? 0), 0);
        const mtime = files.reduce((m, f) => Math.max(m, f.modificationTime ?? 0), 0);
        return { dir, size, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((s, e) => s + e.size, 0);
    for (const e of entries) {
      if (total <= MAX_CACHE_BYTES) break;
      e.dir.delete();
      total -= e.size;
    }
  } catch {
    // 무시
  }
}
