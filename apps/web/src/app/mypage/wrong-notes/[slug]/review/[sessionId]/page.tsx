import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReviewSessionView } from "@/lib/review-session";
import { ReviewSolver } from "@/components/review-solver";
import { isPremium } from "@/lib/membership";
import { MembershipLockedPage } from "@/components/membership-upsell";

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

  // 세션을 만드는 액션들이 이미 멤버십을 확인하지만, 체험이 끝난 뒤 남아 있던 세션
  // 주소로 다시 들어오는 경로가 있어 풀이 화면에서도 확인한다.
  if (!(await isPremium(supabase, user.id))) {
    return (
      <MembershipLockedPage
        title="복습·섞어풀기는 멤버십 기능이에요"
        description="틀린 문제를 언제 다시 볼지 문항마다 계산해서 그날 볼 것만 내주는 기능이에요. 풀던 세션과 오답 기록은 그대로 남아 있어요."
        backHref="/mypage?tab=wrong-notes"
        backLabel="마이페이지로"
        next={`/mypage/wrong-notes/${slug}/review/${sessionId}`}
      />
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
