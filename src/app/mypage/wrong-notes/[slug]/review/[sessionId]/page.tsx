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

  const view = await getReviewSessionView(supabase, user.id, sessionId);
  if (!view) notFound();

  // slug "all" = 전 과목 섞어풀기/복습(특정 과목 페이지가 없음). 돌아가기는 허브로.
  const backHref =
    slug === "all"
      ? "/mypage?tab=wrong-notes"
      : `/mypage/wrong-notes/${slug}?view=questions`;

  return <ReviewSolver initial={view} backHref={backHref} subjectSlug={slug} />;
}
