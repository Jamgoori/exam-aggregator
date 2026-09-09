import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_WASM_URL } from "./crop-question-images.mjs";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { data: p } = await s.from("exam_papers").select("file_path,title").eq("id", process.argv[2]).single();
const { data: blob } = await s.storage.from("exam-papers").download(p.file_path);
const pdf = await getDocument({ data: new Uint8Array(Buffer.from(await blob.arrayBuffer())), wasmUrl: PDF_WASM_URL }).promise;
const want = new RegExp(process.argv[3]);
for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  for (const it of tc.items) {
    const t = (it.str ?? "").trim();
    if (t && want.test(t)) console.log(`p${n}(h=${vp.height.toFixed(0)}) "${t.slice(0, 40)}" x=${it.transform[4].toFixed(1)} y=${it.transform[5].toFixed(1)}`);
  }
}
