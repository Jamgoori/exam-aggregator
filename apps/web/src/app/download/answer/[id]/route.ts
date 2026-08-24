import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 정답지는 문제 다운로드 카운트와 별개이므로 여기서는 아무 카운터도 증가시키지 않는다.
//
// **실제 저장(다운로드)에는 로그인이 있어야 한다** — app/download/[id]/route.ts(문제 PDF)와
// 같은 기준. view=1("정답 열기")이면 Content-Disposition: attachment 를 붙이지 않고
// 로그인도 요구하지 않는다. 막을 때는 /login?next=이 주소 로 돌려보내고 파일은 내주지
// 않는다.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "1";
  const supabase = await createClient();

  if (!view) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const next = `${url.pathname}${url.search}`;
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(next)}`, url.origin),
      );
    }
  }

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
    .getPublicUrl(answerKey.file_path, view ? undefined : { download: answerKey.file_name });

  return NextResponse.redirect(data.publicUrl);
}
