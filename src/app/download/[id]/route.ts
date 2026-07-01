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
    .select("file_path")
    .eq("id", id)
    .single();

  if (!paper) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await supabase.rpc("increment_download_count", { paper_id: id });

  const { data } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(paper.file_path);

  return NextResponse.redirect(data.publicUrl);
}
