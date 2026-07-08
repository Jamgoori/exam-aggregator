import "server-only";
import { PDFDocument } from "pdf-lib";

// 업로드되는 시험지/정답 PDF를 무손실로 다듬는다. object stream을 써서 객체
// 구조만 다시 정리할 뿐 텍스트·이미지 내용은 절대 건드리지 않는다(실측상 원본
// 대비 2~5%대 절감, qpdf 같은 네이티브 툴보다는 덜 줄지만 Vercel 서버리스
// 함수에서 그대로 돌아가는 순수 JS라 배포 위험이 없다).
// 파싱 실패 등 어떤 이유로든 문제가 생기면 원본 버퍼를 그대로 돌려줘서 업로드
// 자체가 실패하는 일은 없게 한다.
export async function optimizePdf(buffer: Buffer): Promise<Buffer> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const optimized = await doc.save({ useObjectStreams: true });
    return optimized.byteLength < buffer.byteLength
      ? Buffer.from(optimized)
      : buffer;
  } catch (err) {
    console.warn("optimizePdf: 최적화 실패, 원본 그대로 사용", err);
    return buffer;
  }
}
