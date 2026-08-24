import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decideDownloadCount, readDownloadHeaders } from "@/lib/download-counting";

// 원본 PDF로 나가는 유일한 통로. "문제 열기"(?view=1)와 다운로드 아이콘이 모두 여기를
// 지난다 — 예전에는 "문제 열기"가 Storage 공개 URL로 바로 나가서, 사람들이 실제로 가장
// 많이 누르는 동작이 홈의 "누적 다운로드"에서 통째로 빠져 있었다(3,790장 중 카운트가
// 붙은 문제지가 11장뿐이었다). 모바일 앱은 원본을 열어본 것도 같은 카운터로 세고
// 있었으므로(apps/mobile/src/lib/download.ts), 이제 웹·앱의 기준이 같다.
//
// view=1 이면 Content-Disposition: attachment 를 붙이지 않는다. 붙이면 "열기"를 눌렀는데
// 파일이 저장돼 버린다.
//
// **카운트는 사람이 누른 요청에만 붙인다**(lib/download-counting.ts). 이 라우트는 로그인을
// 보지 않고 카운터 RPC 도 anon 에 열려 있어서, robots.txt 를 무시하는 크롤러가 문제지
// 상세의 이 링크를 따라오기만 해도 누적 다운로드가 올라갔다. 그래서 회원이 아무도 다시
// 로그인하지 않는 동안에도 숫자만 혼자 늘어 있었다.
//
// 판정이 false 여도 **파일은 그대로 내준다.** 여기서 바뀌는 건 집계뿐이고, 접근 통제나
// 트래픽 비용은 이 라우트가 다룰 문제가 아니다(robots.ts 주석대로 Vercel Firewall 쪽이다).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const view = new URL(request.url).searchParams.get("view") === "1";
  const supabase = await createClient();

  const { data: paper } = await supabase
    .from("exam_papers")
    .select("file_path, file_name")
    .eq("id", id)
    .single();

  if (!paper) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (decideDownloadCount(readDownloadHeaders(request.headers)).count) {
    await supabase.rpc("increment_download_count", { paper_id: id });
  }

  // download 옵션을 주면 Storage가 Content-Disposition: attachment로 응답해서
  // 브라우저 내장 뷰어로 열리는 대신 실제로 파일이 저장된다.
  const { data } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(paper.file_path, view ? undefined : { download: paper.file_name });

  return NextResponse.redirect(data.publicUrl);
}
