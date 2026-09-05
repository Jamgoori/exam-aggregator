import { preload } from "react-dom";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReviewSessionView } from "@/lib/review-session";
import { ReviewSolver } from "@/components/review-solver";

// 섞어풀기 풀이/결과 페이지. 세션은 과목 오답노트의 "섞어풀기" 버튼(createReviewSession)
// 이 먼저 만들고 이 주소로 넘어온다. 본인 세션이 아니거나 없으면 404.
export default async function ReviewSessionPage({
  params,
}: {
  params: Promise<{ slug: string; sessionId: string }>;
}) {
  const { slug, sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  // 멤버십을 보지 않는다. 섞어풀기는 무료고, "오늘의 복습"으로 만들어진 세션도
  // 여기서 막으면 체험이 끝난 사람이 풀던 세션의 답안이 통째로 날아간다(채점을
  // 막지 않는 것과 같은 판단 — actions.ts 의 submitReviewSession 주석 참조).
  // 이 화면은 해설을 보여주지 않으므로 해설 페이월과도 무관하다.
  const view = await getReviewSessionView(supabase, user.id, sessionId);
  if (!view) notFound();

  // slug "all" = 전 과목 섞어풀기/복습(특정 과목 페이지가 없음). 돌아가기는 허브로.
  // 기출 섞어풀기(scope 'mix')는 기록 카드가 붙는 "문제지별" 탭으로 돌아간다.
  const backHref =
    slug === "all"
      ? "/mypage?tab=wrong-notes"
      : view.scope === "mix"
        ? `/mypage/wrong-notes/${slug}`
        : `/mypage/wrong-notes/${slug}?view=questions`;

  // 풀이 화면은 언제나 첫 문항부터 보여준다. 그 이미지는 <head>의 preload로 걸어
  // HTML을 읽는 순간 받기 시작하게 한다(JS 번들을 받아 하이드레이션이 끝날 때까지
  // 기다리면 그만큼 늦게 뜬다). 나머지 문항은 ReviewSolver가 뒤에서 이어 받는다.
  if (!view.submitted) {
    for (const src of view.items[0]?.images ?? []) {
      preload(src, { as: "image", fetchPriority: "high" });
    }
  }

  return <ReviewSolver initial={view} backHref={backHref} subjectSlug={slug} />;
}
