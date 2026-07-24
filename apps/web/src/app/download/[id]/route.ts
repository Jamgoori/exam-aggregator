import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: paper } = await supabase
    .from("exam_papers")
    .select("file_path, file_name")
    .eq("id", id)
    .single();

  if (!paper) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await supabase.rpc("increment_download_count", { paper_id: id });

  // download 옵션을 주면 Storage가 Content-Disposition: attachment로 응답해서
  // 브라우저 내장 뷰어로 열리는 대신 실제로 파일이 저장된다.
  const { data } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(paper.file_path, { download: paper.file_name });

  return NextResponse.redirect(data.publicUrl);
}
