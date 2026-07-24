// src/lib/optimize-pdf.ts와 동일한 로직의 스크립트(.mjs)용 버전. 스크립트는
// Next.js 빌드 파이프라인 밖에서 node로 직접 실행돼 "@/..." 경로 별칭을 못 쓰므로
// 별도로 둔다. object stream으로 구조만 정리하는 무손실 최적화이며, 실패하거나
// 오히려 커지면 원본 버퍼를 그대로 돌려준다.
import { PDFDocument } from "pdf-lib";

export async function optimizePdf(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const optimized = await doc.save({ useObjectStreams: true });
    return optimized.byteLength < buffer.byteLength
      ? Buffer.from(optimized)
      : buffer;
  } catch (err) {
    console.warn("optimizePdf: 최적화 실패, 원본 그대로 사용", err.message);
    return buffer;
  }
}
