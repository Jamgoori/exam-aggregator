import Link from "next/link";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { LoginLink } from "@/components/login-link";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import type { ExamPaper, Subject } from "@/lib/supabase/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "즐겨찾기한 과목",
  description: "즐겨찾기한 과목의 기출문제를 연도별로 모아봤어요.",
};

// 연도 내림차순 → 같은 연도 안에서는 과목명 가나다순으로 묶어서 보여준다.
// 같은 연도·과목 안에서는 시험 유형(국가직/지방직/서울시 ...) 등록 순서, 그 다음
// 회차 내림차순으로 정렬한다.
function groupPapers(papers: ExamPaper[]) {
  const sorted = [...papers].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    const nameCompare = (a.subjects?.name ?? "").localeCompare(
      b.subjects?.name ?? "",
      "ko",
    );
    if (nameCompare !== 0) return nameCompare;
    const orderA = a.exam_types?.display_order ?? 0;
    const orderB = b.exam_types?.display_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return b.round - a.round;
  });

  const byYear = new Map<number, Map<string, ExamPaper[]>>();
  for (const paper of sorted) {
    if (!byYear.has(paper.year)) byYear.set(paper.year, new Map());
    const bySubject = byYear.get(paper.year)!;
    const subjectName = paper.subjects?.name ?? "기타";
    if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
    bySubject.get(subjectName)!.push(paper);
  }
  return byYear;
}

export default async function BookmarksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-24 text-center">
        <Star size={40} className="text-amber-400" />
        <h1 className="text-2xl font-semibold">즐겨찾기한 과목</h1>
        <p className="text-zinc-500">
          로그인하고 관심 과목을 즐겨찾기하면, 내가 치는 과목의 기출문제만
          모아서 볼 수 있어요.
        </p>
        <LoginLink className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700" />
      </div>
    );
  }

  const { data: bookmarkRows } = await supabase
    .from("subject_bookmarks")
    .select("subjects(*)")
    .eq("user_id", user.id);

  const bookmarkedSubjects = (
    (bookmarkRows ?? []) as unknown as { subjects: Subject | null }[]
  )
    .map((r) => r.subjects)
    .filter((s): s is Subject => s !== null);

  if (bookmarkedSubjects.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-24 text-center">
        <Star size={40} className="text-zinc-300" />
        <h1 className="text-2xl font-semibold">즐겨찾기한 과목</h1>
        <p className="text-zinc-500">
          아직 즐겨찾기한 과목이 없어요. 과목 옆의 별 아이콘을 눌러
          추가해보세요.
        </p>
        <Link
          href="/"
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          과목 둘러보기
        </Link>
      </div>
    );
  }

  const subjectIds = bookmarkedSubjects.map((s) => s.id);

  const [{ data: papers }, myRoundCounts] = await Promise.all([
    supabase
      .from("exam_papers")
      .select("*, subjects(*), exam_types(*)")
      .in("subject_id", subjectIds),
    getMyRoundCounts(supabase, user.id),
  ]);

  const allPapers = (papers ?? []) as ExamPaper[];
  const paperIds = allPapers.map((p) => p.id);

  const [bookmarkedPaperIds, cbtAvailability] = await Promise.all([
    getMyBookmarkedPaperIds(supabase, user.id, paperIds),
    getCbtAvailability(supabase, paperIds),
  ]);

  const byYear = groupPapers(allPapers);
  const years = [...byYear.keys()].sort((a, b) => b - a);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 underline">
          ← 홈으로
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold">
          <Star size={26} className="text-amber-400" fill="currentColor" />
          즐겨찾기한 과목
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {bookmarkedSubjects
            .map((s) => s.name)
            .sort((a, b) => a.localeCompare(b, "ko"))
            .join(", ")}
        </p>
      </div>

      {allPapers.length === 0 ? (
        <p className="py-12 text-center text-zinc-500">
          즐겨찾기한 과목에 아직 업로드된 기출문제가 없어요.
        </p>
      ) : (
        years.map((year) => (
          <section key={year} className="flex flex-col gap-6">
            <h2 className="text-xl font-bold">{year}년</h2>
            {[...byYear.get(year)!.entries()].map(([subjectName, subjectPapers]) => (
              <div key={subjectName} className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-zinc-500">
                  {subjectName}
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {subjectPapers.map((paper) => (
                    <ExamCard
                      key={paper.id}
                      paper={paper}
                      myRoundCount={myRoundCounts.get(paper.id)}
                      isBookmarked={bookmarkedPaperIds.has(paper.id)}
                      loggedIn
                      hasCbtAnswers={cbtAvailability.has(paper.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
