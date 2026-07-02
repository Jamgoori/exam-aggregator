import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 정답지는 문제 다운로드 카운트와 별개이므로 여기서는 아무 카운터도 증가시키지 않는다.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: answerKey } = await supabase
    .from("answer_keys")
    .select("file_path, file_name")
    .eq("id", id)
    .single();

  if (!answerKey) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(answerKey.file_path, { download: answerKey.file_name });

  return NextResponse.redirect(data.publicUrl);
}
