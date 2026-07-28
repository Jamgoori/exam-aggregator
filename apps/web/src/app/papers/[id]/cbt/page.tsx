import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CbtSolver } from "@/components/cbt-solver";
import { getPaperDisplayTitle } from "@/lib/paper-title";
import type { ExamPaper } from "@gongmoa/core";

export default async function CbtPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로컬 개발에서 크롭 이미지·레이아웃을 확인하려면 매번 로그인해야 해서 번거롭다.
  // .env.local에 DEV_SKIP_CBT_AUTH=1을 두면 로그인 없이 열 수 있다.
  // `process.env.NODE_ENV !== "production"` 조건을 반드시 함께 둔다 — 빌드 시 이
  // 분기가 통째로 죽어 배포본에는 우회 경로가 아예 남지 않는다. 서버에 환경변수를
  // 잘못 켜도 프로덕션에서는 동작하지 않는다.
  const devSkipAuth =
    process.env.NODE_ENV !== "production" && process.env.DEV_SKIP_CBT_AUTH === "1";

  if (!user && !devSkipAuth) {
    redirect(`/login?next=${encodeURIComponent(`/papers/${id}/cbt`)}`);
  }

  const [{ data: paper }, { data: hasAnswers }, { data: questionRows }] =
    await Promise.all([
      supabase.from("exam_papers").select("*").eq("id", id).single(),
      supabase.rpc("has_cbt_answers", { target_paper_id: id }),
      supabase
        .from("questions")
        .select("question_number, choice_count, question_images(order_index, image_path)")
        .eq("paper_id", id)
        .order("question_number"),
    ]);

  if (!paper) {
    notFound();
  }

  const typedPaper = paper as ExamPaper;

  if (!hasAnswers || !typedPaper.question_count) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">아직 CBT를 지원하지 않는 문제지예요</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          정답이 등록되면 CBT로 풀 수 있어요. 우선 원본 PDF로 풀어보세요.
        </p>
        <Link
          href={`/papers/${typedPaper.id}`}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          문제지로 돌아가기
        </Link>
      </div>
    );
  }

  const { data: paperFileUrl } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(typedPaper.file_path);

  // "문제별로 보기" 모드용: 문항별로 잘라둔 이미지가 등록돼 있는 문제지만 지원한다.
  // 아직 크롭 이미지를 안 올린 문제지는 questionImages가 빈 객체가 되고, 그 경우
  // CbtSolver가 해당 탭을 비활성화한다.
  const questionImages: Record<number, string[]> = {};
  const questionChoiceCounts: Record<number, number> = {};
  for (const row of questionRows ?? []) {
    const images = [...(row.question_images ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map(
        (img) =>
          supabase.storage.from("exam-papers").getPublicUrl(img.image_path).data
            .publicUrl,
      );
    if (images.length === 0) continue;
    questionImages[row.question_number] = images;
    questionChoiceCounts[row.question_number] = row.choice_count;
  }

  // 명시적으로 저장된 값이 없으면(한 번도 자물쇠를 잠근 적 없음) null로 구분해서
  // 넘긴다 — 전체보기로 "시작"하는 것과 전체보기를 "기본값으로 잠가둔 것"은
  // 자물쇠 아이콘 표시상 서로 다른 상태라 여기서 뭉개면 안 된다.
  const rawDefaultViewMode = user?.user_metadata?.default_cbt_view_mode;
  const defaultViewMode: "full" | "single" | null =
    rawDefaultViewMode === "single" || rawDefaultViewMode === "full"
      ? rawDefaultViewMode
      : null;

  return (
    <CbtSolver
      paperId={typedPaper.id}
      paperTitle={getPaperDisplayTitle(typedPaper.title, typedPaper.track)}
      fileUrl={paperFileUrl.publicUrl}
      totalQuestions={typedPaper.question_count}
      choiceCount={typedPaper.choice_count}
      questionImages={questionImages}
      questionChoiceCounts={questionChoiceCounts}
      defaultViewMode={defaultViewMode}
    />
  );
}
