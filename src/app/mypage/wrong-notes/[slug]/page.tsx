import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSubjectWrongNoteOverview } from "@/lib/wrong-notes";
import { levelColor } from "@/lib/level-colors";
import { subjectColor } from "@/lib/subject-colors";

// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 문제지 목록. 문제지 카드를
// 누르면 회독별 기록과 오답 문제·해설을 보는 문제지 오답노트로 이어진다.
// (회독이 쌓여도 이 페이지는 요약 카드만 그려서 가볍게 유지된다.)
export default async function SubjectWrongNotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const note = await getSubjectWrongNoteOverview(supabase, user.id, slug);
  if (!note) notFound();

  const { subject, papers } = note;
  const totalWrong = papers.reduce(
    (sum, p) => sum + p.unresolvedCount + p.resolvedCount,
    0,
  );
  const totalUnresolved = papers.reduce((sum, p) => sum + p.unresolvedCount, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Link
          href="/mypage?tab=wrong-notes"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 오답노트로
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
          >
            {subject.name}
          </span>
        </div>
        <h1 className="text-2xl font-semibold">{subject.name} 오답노트</h1>
        {totalWrong > 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            지금까지 틀려본 문제 {totalWrong}개 중 {totalWrong - totalUnresolved}개를
            극복했어요. 문제지를 고르면 회독별 점수와 함께 틀린 문제·해설을 볼 수
            있어요.
          </p>
        )}
      </div>

      {papers.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
          이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀면 틀린 문제가
          자동으로 이곳에 모여요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {papers.map((p) => {
            const pctLabel =
              p.latestScore != null && p.latestTotal
                ? `${Math.round((p.latestScore / p.latestTotal) * 100)}점`
                : null;
            return (
              <Link
                key={p.paper.id}
                href={`/mypage/wrong-notes/${slug}/${p.paper.id}`}
                className="group flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
              >
                <div className="flex items-center gap-2">
                  {p.paper.level && (
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${levelColor(p.paper.level)}`}
                    >
                      {p.paper.level}
                    </span>
                  )}
                  <span className="font-medium leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {p.paper.title}
                  </span>
                  <ChevronRight
                    size={16}
                    className="ml-auto shrink-0 text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800 dark:text-zinc-400">
                    {p.attemptCount}회독
                  </span>
                  {pctLabel && (
                    <span>
                      최근{" "}
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {pctLabel}
                      </span>{" "}
                      ({p.latestScore}/{p.latestTotal})
                    </span>
                  )}
                  <span>
                    마지막 응시{" "}
                    {new Date(p.lastAttemptAt).toLocaleDateString("ko-KR")}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <span
                      className={`font-medium ${p.unresolvedCount > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-600"}`}
                    >
                      오답 {p.unresolvedCount}
                    </span>
                    {p.resolvedCount > 0 && (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        극복 {p.resolvedCount}
                      </span>
                    )}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
