import { NextResponse, after } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { decideDownloadCount, readDownloadHeaders } from "@/lib/download-counting";

// 파일 경로·이름은 공개 자료이고 업로드 뒤 거의 안 바뀐다. 사람들이 가장 많이 누르는
// "문제 열기"가 이 라우트를 지나므로, 조회를 캐시해 302 까지의 왕복을 줄인다(관리자가
// 고치면 home-data 태그로 함께 갱신된다).
async function getPaperFile(id: string) {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const { data } = await createPublicClient()
    .from("exam_papers")
    .select("file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  return (data as { file_path: string; file_name: string } | null) ?? null;
}

// 원본 PDF로 나가는 유일한 통로. "문제 열기"(?view=1)와 다운로드 아이콘이 모두 여기를
// 지난다 — 예전에는 "문제 열기"가 Storage 공개 URL로 바로 나가서, 사람들이 실제로 가장
// 많이 누르는 동작이 홈의 "누적 다운로드"에서 통째로 빠져 있었다(3,790장 중 카운트가
// 붙은 문제지가 11장뿐이었다). 모바일 앱은 원본을 열어본 것도 같은 카운터로 세고
// 있었으므로(apps/mobile/src/lib/download.ts), 이제 웹·앱의 기준이 같다.
//
// view=1 이면 Content-Disposition: attachment 를 붙이지 않는다. 붙이면 "열기"를 눌렀는데
// 파일이 저장돼 버린다.
//
// **실제 저장(다운로드)에는 로그인이 있어야 한다.** view=1("문제 열기")은 그대로 비로그인도
// 열 수 있다 — 로그인을 요구하는 건 "다운로드" 버튼(Content-Disposition: attachment로
// 나가는 쪽)뿐이다. 막을 때는 로그인 화면으로 돌려보내고(next로 이 주소를 그대로 들려서,
// 로그인하면 이어서 받게 한다), 파일은 내주지 않는다. 이건 회원가입을 유도하는 접근
// 통제다 — 아래 다운로드 집계 판정과는 목적이 다르다(그쪽은 판정이 false 여도 파일을
// 내준다고 명시돼 있다. 이 로그인 검사는 그것과 별개로, view=1이 아닐 때만 먼저 막는다).
//
// **카운트는 사람이 누른 요청에만 붙인다**(lib/download-counting.ts). 이 판정 자체는
// 로그인과 무관하다 — 로그인 요구가 나중에 풀리더라도 봇 필터링은 그대로 남아야 한다.
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

  const paper = await getPaperFile(id);

  if (!paper) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 카운트는 응답을 보낸 뒤에 올린다(after) — 사용자는 PDF 가 열리기까지 이 RPC 를
  // 기다릴 이유가 없다. 실패해도 파일은 이미 내준 뒤라 집계만 하나 빠질 뿐이다.
  if (decideDownloadCount(readDownloadHeaders(request.headers)).count) {
    after(async () => {
      await supabase.rpc("increment_download_count", { paper_id: id });
    });
  }

  // download 옵션을 주면 Storage가 Content-Disposition: attachment로 응답해서
  // 브라우저 내장 뷰어로 열리는 대신 실제로 파일이 저장된다.
  const { data } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(paper.file_path, view ? undefined : { download: paper.file_name });

  return NextResponse.redirect(data.publicUrl);
}
