import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/admin/actions";
import { fetchQuestionMedia } from "@/lib/wrong-notes";

// verify_question_answer() 대조에 실패해 verified=false로 남은 해설을 모아 보여주는
// 화면. 해설 배치 루틴이 청크당 2회까지만 재시도하고 넘어가므로, 그 이후로는 여기
// 목록이 유일한 확인 경로다 (docs/agents/explanation-batch-routines.md 참고).
// 읽기 전용 — 재작성은 배치 루틴이 하는 일이라 이 화면에서 직접 고치지 않는다.

type ExplanationRow = {
  id: string;
  created_at: string;
  correct_choice_number: number | null;
  correct_choice_summary: string | null;
  current_answer_status: string | null;
  current_answer_note: string | null;
  model_version: string | null;
  questions: {
    question_number: number;
    paper_id: string;
    exam_papers: {
      id: string;
      title: string;
      year: number;
      round: number;
    } | null;
  } | null;
};

const PAGE_LIMIT = 200;

export default async function UnverifiedExplanationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/admin/login");
  }

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    redirect("/");
  }

  const { data: rowsRaw, count } = await supabase
    .from("question_explanations")
    .select(
      "id, created_at, correct_choice_number, correct_choice_summary, current_answer_status, current_answer_note, model_version, questions!inner(question_number, paper_id, exam_papers!inner(id, title, year, round))",
      { count: "exact" },
    )
    .eq("verified", false)
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT);

  const rows = (rowsRaw ?? []) as unknown as ExplanationRow[];
  const withPaper = rows.filter((r) => r.questions?.exam_papers);

  const paperIds = [...new Set(withPaper.map((r) => r.questions!.paper_id))];

  const [{ data: answerRows }, media] = await Promise.all([
    paperIds.length > 0
      ? supabase
          .from("paper_answers")
          .select("paper_id, answers, voided_questions")
          .in("paper_id", paperIds)
      : Promise.resolve({ data: [] as { paper_id: string; answers: number[]; voided_questions: number[] }[] }),
    paperIds.length > 0
      ? fetchQuestionMedia(supabase, paperIds)
      : Promise.resolve(new Map()),
  ]);

  const answersByPaper = new Map<string, { answers: number[]; voided: Set<number> }>();
  for (const r of answerRows ?? []) {
    answersByPaper.set(r.paper_id, {
      answers: (r.answers ?? []) as number[],
      voided: new Set((r.voided_questions ?? []) as number[]),
    });
  }

  // 문제지 → 문항번호 순으로 묶어서 보기 좋게 정렬한다.
  const sorted = [...withPaper].sort((a, b) => {
    const pa = a.questions!.exam_papers!;
    const pb = b.questions!.exam_papers!;
    return (
      pa.title.localeCompare(pb.title, "ko") ||
      a.questions!.question_number - b.questions!.question_number
    );
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">미검증(unverified) 해설</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline dark:text-zinc-500">
            로그아웃
          </button>
        </form>
      </div>

      <Link href="/admin/upload" className="text-sm text-blue-600 underline dark:text-blue-400">
        ← 문제 업로드로 돌아가기
      </Link>

      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        해설 배치 루틴이 저장한 정답이 <code>paper_answers</code>의 공식 정답표와 불일치해
        <code>verified=false</code>로 남은 건입니다. 총 {count ?? sorted.length}건
        {count !== null && count! > PAGE_LIMIT ? ` 중 최근 ${PAGE_LIMIT}건 표시` : ""}.
        전항정답/복수정답 처리된 번호(voided_questions)는 정상적인 불일치일 수 있어 따로
        표시합니다.
      </p>

      {sorted.length === 0 && (
        <p className="rounded border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
          미검증 해설이 없습니다.
        </p>
      )}

      <div className="flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
        {sorted.map((row) => {
          const q = row.questions!;
          const paper = q.exam_papers!;
          const answerInfo = answersByPaper.get(q.paper_id);
          const officialAnswer = answerInfo?.answers[q.question_number - 1] ?? null;
          const isVoided = answerInfo?.voided.has(q.question_number) ?? false;
          const thumb = media.get(q.paper_id)?.get(q.question_number)?.images[0];

          return (
            <div key={row.id} className="flex gap-4 p-4">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt={`${paper.title} ${q.question_number}번 문항 이미지`}
                  className="h-20 w-20 shrink-0 rounded border border-zinc-200 object-cover object-top dark:border-zinc-700"
                />
              ) : (
                <div className="h-20 w-20 shrink-0 rounded border border-dashed border-zinc-200 dark:border-zinc-700" />
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/answers/${paper.id}`}
                    className="font-medium text-blue-600 underline dark:text-blue-400"
                  >
                    {paper.title} ({paper.year}년 {paper.round}회)
                  </Link>
                  <span className="text-sm text-zinc-500 dark:text-zinc-500">
                    {q.question_number}번
                  </span>
                  {isVoided && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                      전항정답/복수정답 처리됨
                    </span>
                  )}
                  {row.current_answer_status && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {row.current_answer_status}
                    </span>
                  )}
                </div>

                <p className="text-sm">
                  AI 제안 정답:{" "}
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {row.correct_choice_number ?? "-"}
                  </span>{" "}
                  · 공식 정답표:{" "}
                  <span className="font-semibold">{officialAnswer ?? "미입력"}</span>
                </p>

                {row.correct_choice_summary && (
                  <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {row.correct_choice_summary}
                  </p>
                )}
                {row.current_answer_note && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-500">
                    {row.current_answer_note}
                  </p>
                )}

                <p className="text-xs text-zinc-400 dark:text-zinc-600">
                  {row.model_version ?? "모델 정보 없음"} ·{" "}
                  {new Date(row.created_at).toLocaleString("ko-KR")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
