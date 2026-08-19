import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/fetch-paged";
import { logout } from "@/app/admin/actions";
import { fetchQuestionMedia } from "@/lib/wrong-notes";

// verify_question_answer() 대조에 실패해 verified=false로 남은 해설을 모아 보여주는
// 화면. 해설 배치 루틴이 청크당 2회까지만 재시도하고 넘어가므로, 그 이후로는 여기
// 목록이 유일한 확인 경로다 (docs/agents/explanation-batch-routines.md 참고).
// 읽기 전용 — 재작성은 배치 루틴이 하는 일이라 이 화면에서 직접 고치지 않는다.
//
// 목록 위에 **문제지별 몰림 요약**을 둔다. 미검증 급증의 원인은 문제지 단위(정답표
// 오염·책형 불일치)와 문항 단위(모델 오답)가 전혀 다른데, 최근 200건을 평평하게
// 늘어놓기만 하면 그 모양이 안 보이기 때문이다 — 2026-08-16 정답표 오염 사고도
// "한 문제지에 3건 이상 몰린다"는 모양으로 드러났다
// (docs/agents/answer-keys-tracks.md). 요약은 최근 200건이 아니라 **미검증 전량**을
// 세고, 전항정답/복수정답(voided)은 정상 불일치이므로 빼고 센다.
// 터미널에서 더 깊게 보려면 `npm run unverified-report`.

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

// 몰림 요약용 최소 컬럼. 전량을 받으므로 행마다 가볍게 유지한다.
type SummaryRow = {
  id: string;
  questions: {
    question_number: number;
    paper_id: string;
    exam_papers: {
      id: string;
      title: string;
      question_count: number | null;
    } | null;
  } | null;
};

const PAGE_LIMIT = 200;
// 요약에 펼쳐 보여줄 문제지 수. 나머지는 건수만 알린다.
const SUMMARY_LIMIT = 15;
// 이만큼 몰리면 문제지 단위 원인(정답표)을 먼저 의심한다.
const CLUSTER_MIN = 3;
// 문항의 절반 이상이 어긋나면 정답표 열 자체가 다른 책형일 가능성이 높다 — 책형
// 회전 시 우연 일치가 ~20%뿐이라 열이 통째로 밀리면 대부분이 불일치로 보인다.
const BOOKLET_RATIO = 0.5;

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

  const [rowsRaw, summaryRaw] = await Promise.all([
    supabase
      .from("question_explanations")
      .select(
        "id, created_at, correct_choice_number, correct_choice_summary, current_answer_status, current_answer_note, model_version, questions!inner(question_number, paper_id, exam_papers!inner(id, title, year, round))",
      )
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT)
      .then((res) => (res.data ?? []) as unknown as ExplanationRow[]),
    fetchAllPages<SummaryRow>(
      (from, to) =>
        supabase
          .from("question_explanations")
          .select(
            "id, questions!inner(question_number, paper_id, exam_papers!inner(id, title, question_count))",
          )
          .eq("verified", false)
          .order("id")
          .range(from, to) as unknown as Promise<{
          data: SummaryRow[] | null;
          error: { message: string } | null;
        }>,
      "미검증 해설",
    ),
  ]);

  const rows = rowsRaw;
  const withPaper = rows.filter((r) => r.questions?.exam_papers);
  const summaryWithPaper = summaryRaw.filter((r) => r.questions?.exam_papers);

  // 정답표는 요약(전량)과 목록(최근 200건)이 함께 쓴다 — 등장하는 문제지를 한 번에 받는다.
  const paperIds = [
    ...new Set([
      ...summaryWithPaper.map((r) => r.questions!.paper_id),
      ...withPaper.map((r) => r.questions!.paper_id),
    ]),
  ];
  const listPaperIds = [...new Set(withPaper.map((r) => r.questions!.paper_id))];

  const [answerRows, media] = await Promise.all([
    fetchAnswers(supabase, paperIds),
    listPaperIds.length > 0
      ? fetchQuestionMedia(supabase, listPaperIds)
      : Promise.resolve(new Map()),
  ]);

  const answersByPaper = new Map<string, { answers: number[]; voided: Set<number> }>();
  for (const r of answerRows) {
    answersByPaper.set(r.paper_id, {
      answers: (r.answers ?? []) as number[],
      voided: new Set((r.voided_questions ?? []) as number[]),
    });
  }

  // 문제지별로 묶는다. voided는 정상 불일치라 빼고 세고, 따로 몇 건인지만 남긴다.
  const clusters = new Map<
    string,
    { paperId: string; title: string; questionCount: number | null; real: number; voided: number }
  >();
  for (const r of summaryWithPaper) {
    const q = r.questions!;
    const paper = q.exam_papers!;
    const entry = clusters.get(q.paper_id) ?? {
      paperId: paper.id,
      title: paper.title,
      questionCount: paper.question_count,
      real: 0,
      voided: 0,
    };
    if (answersByPaper.get(q.paper_id)?.voided.has(q.question_number)) entry.voided++;
    else entry.real++;
    clusters.set(q.paper_id, entry);
  }

  const ranked = [...clusters.values()]
    .filter((c) => c.real > 0)
    .sort((a, b) => b.real - a.real || a.title.localeCompare(b.title, "ko"));

  const totalUnverified = summaryWithPaper.length;
  const totalVoided = ranked.reduce((sum, c) => sum + c.voided, 0);
  const totalReal = ranked.reduce((sum, c) => sum + c.real, 0);
  const clustered = ranked.filter((c) => c.real >= CLUSTER_MIN);

  // 문제지 → 목록 → 문항번호 순으로 묶어서 보기 좋게 정렬한다.
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
        <code>verified=false</code>로 남은 건입니다. 총 {totalUnverified}건 (전항정답/복수정답
        처리된 정상 불일치 {totalVoided}건 제외 시 {totalReal}건).
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">문제지별 몰림</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          한 문제지에 {CLUSTER_MIN}건 이상 몰리면 개별 문항의 모델 오답이 아니라 그 문제지의
          정답표를 의심합니다. 문항의 절반 이상이 어긋나면 정답표 열 자체가 다른 책형일
          가능성이 높습니다. 미검증 전량 기준 — {clustered.length}장이 몰림에 해당합니다.
        </p>

        {ranked.length === 0 ? (
          <p className="rounded border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
            몰린 문제지가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
            {ranked.slice(0, SUMMARY_LIMIT).map((c) => {
              const ratio = c.questionCount ? c.real / c.questionCount : null;
              const badge =
                ratio !== null && ratio >= BOOKLET_RATIO
                  ? { label: "책형 의심", tone: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" }
                  : c.real >= CLUSTER_MIN
                    ? { label: "몰림", tone: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" }
                    : null;

              return (
                <div key={c.paperId} className="flex flex-wrap items-center gap-2 p-3">
                  <Link
                    href={`/admin/answers/${c.paperId}`}
                    className="font-medium text-blue-600 underline dark:text-blue-400"
                  >
                    {c.title}
                  </Link>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {c.real}건
                    {c.questionCount ? ` / ${c.questionCount}문항` : ""}
                    {ratio !== null ? ` (${(ratio * 100).toFixed(0)}%)` : ""}
                  </span>
                  {c.voided > 0 && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-600">
                      전항정답/복수정답 {c.voided}건 제외
                    </span>
                  )}
                  {badge && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.tone}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {ranked.length > SUMMARY_LIMIT && (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            …외 문제지 {ranked.length - SUMMARY_LIMIT}장. 전체 분류는{" "}
            <code>npm run unverified-report</code>.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          최근 {Math.min(PAGE_LIMIT, sorted.length)}건
        </h2>

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
      </section>
    </div>
  );
}

// paper_answers는 PostgREST의 .in() URL 길이 제한이 있어 나눠 받는다.
async function fetchAnswers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<{ paper_id: string; answers: number[] | null; voided_questions: number[] | null }[]> {
  const rows: { paper_id: string; answers: number[] | null; voided_questions: number[] | null }[] =
    [];
  for (let i = 0; i < paperIds.length; i += 200) {
    const { data, error } = await supabase
      .from("paper_answers")
      .select("paper_id, answers, voided_questions")
      .in("paper_id", paperIds.slice(i, i + 200));
    if (error) throw new Error(`paper_answers 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}
