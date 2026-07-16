import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getSubjectWrongNoteOverview,
  getSubjectWrongNoteQuestions,
} from "@/lib/wrong-notes";
import { SubjectWrongNoteQuestions } from "@/components/subject-wrong-note-questions";
import { levelColor } from "@/lib/level-colors";
import { subjectColor } from "@/lib/subject-colors";

type ViewKey = "papers" | "questions";

// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 화면. 기본 "문제지별"은 문제지
// 요약 카드 목록(누르면 회독별 기록·해설), "문항 모아보기"는 그 과목에서 틀린 문항을
// 문제지 경계 없이 한 목록으로 펼친다. 어느 탭을 보든 다른 탭 데이터는 조회하지 않게
// ?view 쿼리로 서버에서 갈라 렌더한다(회독 많은 계정에서 무거운 문항 조립을 필요할
// 때만 하려는 분리).
export default async function SubjectWrongNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view: viewParam } = await searchParams;
  const view: ViewKey = viewParam === "questions" ? "questions" : "papers";
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  if (view === "questions") {
    const note = await getSubjectWrongNoteQuestions(supabase, user.id, slug);
    if (!note) notFound();
    return (
      <SubjectWrongNoteShell subject={note.subject} view="questions">
        <SubjectWrongNoteQuestions
          questions={note.questions}
          unresolvedCount={note.unresolvedCount}
          subjectSlug={slug}
        />
      </SubjectWrongNoteShell>
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
    <SubjectWrongNoteShell subject={subject} view="papers">
      {totalWrong > 0 && (
        <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-500">
          지금까지 틀려본 문제 {totalWrong}개 중 {totalWrong - totalUnresolved}개를
          극복했어요. 문제지를 고르면 회독별 점수와 함께 틀린 문제·해설을 볼 수
          있어요.
        </p>
      )}

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
    </SubjectWrongNoteShell>
  );
}

// 헤더(뒤로가기·과목 배지·제목) + 탭 링크를 두 뷰가 공유한다. 탭은 ?view 쿼리를
// 바꾸는 링크라 서버에서 해당 뷰만 조회한다.
function SubjectWrongNoteShell({
  subject,
  view,
  children,
}: {
  subject: { slug: string; name: string };
  view: ViewKey;
  children: React.ReactNode;
}) {
  const base = `/mypage/wrong-notes/${subject.slug}`;
  const tab = (key: ViewKey, label: string, href: string) => (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        view === key
          ? "bg-blue-600 text-white"
          : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
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
        <div className="flex gap-2">
          {tab("papers", "문제지별", base)}
          {tab("questions", "문항 모아보기", `${base}?view=questions`)}
        </div>
      </div>
      {children}
    </div>
  );
}
