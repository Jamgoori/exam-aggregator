import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenCheck, ChevronRight, Star, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { MyPageTabs, type MyPageTabKey } from "@/components/mypage-tabs";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { formatDuration } from "@/lib/format";
import { computeStreakDays, streakTier } from "@/lib/streak";
import { subjectColor } from "@/lib/subject-colors";
import {
  buildWrongNoteGroups,
  fetchWrongAnswerRows,
  type WrongNoteAttemptRow,
  type WrongNoteSubjectGroup,
} from "@/lib/wrong-notes";
import type { ExamPaper } from "@/lib/supabase/types";

const TAB_KEYS: MyPageTabKey[] = ["bookmarks", "history", "wrong-notes"];

type MyAttempt = {
  id: string;
  score: number;
  total_questions: number;
  duration_seconds: number | null;
  created_at: string;
  exam_papers: (Pick<ExamPaper, "id" | "title" | "level" | "choice_count"> & {
    subjects?: ExamPaper["subjects"];
    exam_types?: ExamPaper["exam_types"];
  }) | null;
};

// 같은 문제지를 몇 번째 풀었는지("N회독") 계산. myAttempts는 전체를 최신순으로 이미
// 받아왔으므로, 문제지별로 묶어 오래된 순으로 다시 정렬해 순번을 매긴다.
function computeAttemptRounds(myAttempts: MyAttempt[]) {
  const attemptsByPaper = new Map<string, MyAttempt[]>();
  for (const a of myAttempts) {
    if (!a.exam_papers) continue;
    const list = attemptsByPaper.get(a.exam_papers.id) ?? [];
    list.push(a);
    attemptsByPaper.set(a.exam_papers.id, list);
  }
  const roundNumberByAttemptId = new Map<string, number>();
  for (const list of attemptsByPaper.values()) {
    [...list]
      .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
      .forEach((a, i) => roundNumberByAttemptId.set(a.id, i + 1));
  }
  return { attemptsByPaper, roundNumberByAttemptId };
}

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = tab ? `/mypage?tab=${encodeURIComponent(tab)}` : "/mypage";
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const initialTab: MyPageTabKey = TAB_KEYS.includes(tab as MyPageTabKey)
    ? (tab as MyPageTabKey)
    : "bookmarks";

  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const [{ data: bookmarkRows }, { data: attemptRows }] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("id, created_at, exam_papers(*, subjects(*), exam_types(*))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("cbt_attempts")
      .select(
        "id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, choice_count, subjects(*), exam_types(*))",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const bookmarkedPapers = (
    (bookmarkRows ?? []) as unknown as { exam_papers: ExamPaper | null }[]
  )
    .map((r) => r.exam_papers)
    .filter((p): p is ExamPaper => p !== null);

  const cbtAvailability = await getCbtAvailability(
    supabase,
    bookmarkedPapers.map((p) => p.id),
  );

  const myAttempts = (attemptRows ?? []) as unknown as MyAttempt[];
  const { attemptsByPaper, roundNumberByAttemptId } = computeAttemptRounds(myAttempts);

  // 오답노트 집계는 위에서 이미 받아온 응시 목록을 그대로 재사용하고,
  // 문항별 오답 행만 추가로 조회한다.
  const wrongRows = await fetchWrongAnswerRows(
    supabase,
    myAttempts.map((a) => a.id),
  );
  const wrongNoteGroups = buildWrongNoteGroups(
    myAttempts as unknown as WrongNoteAttemptRow[],
    wrongRows,
  );
  const totalUnresolved = wrongNoteGroups.reduce(
    (sum, g) => sum + g.unresolvedCount,
    0,
  );

  const streakDays = computeStreakDays(myAttempts.map((a) => a.created_at));
  const tier = streakTier(streakDays);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{nickname}님의 마이페이지</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
          <Link href="/mypage/edit" className="text-blue-600 hover:underline">
            내 정보 수정
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">CBT 응시</span>
          <span className="text-xl font-semibold">{myAttempts.length}</span>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">연속 학습</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold">{streakDays}일</span>
            {tier && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${tier.className}`}
              >
                {tier.label}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">남은 오답</span>
          <span
            className={`text-xl font-semibold ${totalUnresolved > 0 ? "text-red-600" : "text-emerald-600"}`}
          >
            {totalUnresolved}문제
          </span>
        </div>
      </div>

      <MyPageTabs
        initialTab={initialTab}
        bookmarks={
          <BookmarksTab
            papers={bookmarkedPapers}
            attemptsByPaper={attemptsByPaper}
            cbtAvailability={cbtAvailability}
          />
        }
        history={
          <HistoryTab
            attempts={myAttempts}
            roundNumberByAttemptId={roundNumberByAttemptId}
          />
        }
        wrongNotes={<WrongNotesTab groups={wrongNoteGroups} />}
      />
    </div>
  );
}

// "즐겨찾기" 탭: 북마크한 문제지 카드 그리드.
function BookmarksTab({
  papers,
  attemptsByPaper,
  cbtAvailability,
}: {
  papers: ExamPaper[];
  attemptsByPaper: Map<string, MyAttempt[]>;
  cbtAvailability: Set<string>;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Star size={18} className="text-amber-400" />
        즐겨찾기한 문제 ({papers.length})
      </h2>
      {papers.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          아직 즐겨찾기한 문제가 없어요. 문제 상세 페이지에서 북마크 아이콘을
          눌러보세요.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {papers.map((paper) => (
            <ExamCard
              key={paper.id}
              paper={paper}
              myRoundCount={attemptsByPaper.get(paper.id)?.length}
              isBookmarked
              loggedIn
              hasCbtAnswers={cbtAvailability.has(paper.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// "내 시험 기록" 탭: CBT 응시 이력 목록. 회차를 누르면 문제지 상세 대신 그 회차의
// 오답만 모아 보여주는 페이지로 이동한다 (문제지 상세는 그 페이지 안에서 갈 수 있다).
function HistoryTab({
  attempts,
  roundNumberByAttemptId,
}: {
  attempts: MyAttempt[];
  roundNumberByAttemptId: Map<string, number>;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Trophy size={18} className="text-amber-500" />
        내 시험 기록 ({attempts.length})
      </h2>
      {attempts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          아직 CBT로 풀어본 문제가 없어요. 문제 상세 페이지에서 온라인 풀기를
          눌러보세요.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-100">
          {attempts.map((a) => {
            const pct =
              a.total_questions > 0
                ? Math.round((a.score / a.total_questions) * 100)
                : 0;
            const wrongCount = a.total_questions - a.score;
            return (
              <Link
                key={a.id}
                href={`/mypage/attempts/${a.id}`}
                className="group flex flex-col gap-1 py-4 transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  {a.exam_papers ? (
                    <span className="text-sm font-medium group-hover:text-blue-600">
                      {a.exam_papers.title}
                    </span>
                  ) : (
                    <span className="text-sm text-zinc-400">삭제된 문제</span>
                  )}
                  <span className="text-xs text-zinc-400">
                    {new Date(a.created_at).toLocaleDateString("ko-KR")}
                    {a.duration_seconds != null &&
                      ` · ${formatDuration(a.duration_seconds)}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {roundNumberByAttemptId.has(a.id) && (
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                      {roundNumberByAttemptId.get(a.id)}회독
                    </span>
                  )}
                  <span className="font-semibold">
                    {a.score}/{a.total_questions}
                  </span>
                  <span className="text-xs text-zinc-400">({pct}점)</span>
                  <span
                    className={`text-xs font-medium ${wrongCount > 0 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    오답 {wrongCount}
                  </span>
                  <ChevronRight
                    size={15}
                    className="text-zinc-300 group-hover:text-blue-600"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

// "오답노트" 탭: 과목별로 틀린 문제 수를 요약해서 보여주고, 과목을 누르면
// 문제 이미지까지 모아둔 과목 오답노트 페이지로 이어준다.
function WrongNotesTab({ groups }: { groups: WrongNoteSubjectGroup[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <BookOpenCheck size={18} className="text-blue-600" />
        오답노트
      </h2>
      {groups.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로
          자동으로 정리돼요.
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">
            틀린 문제를 과목별로 모아뒀어요. 가장 최근 응시에서 다시 맞힌 문제는
            &ldquo;극복&rdquo;으로 표시돼요.
          </p>
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.subject.id} className="rounded-xl border border-zinc-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(g.subject.slug)}`}
                  >
                    {g.subject.name}
                  </span>
                  <span className="text-sm text-zinc-500">
                    <span className="font-medium text-red-600">오답 {g.unresolvedCount}</span>
                    {g.resolvedCount > 0 && (
                      <>
                        {" · "}
                        <span className="font-medium text-emerald-600">
                          극복 {g.resolvedCount}
                        </span>
                      </>
                    )}
                  </span>
                  <Link
                    href={`/mypage/wrong-notes/${g.subject.slug}`}
                    className="ml-auto text-sm font-medium text-blue-600 hover:underline"
                  >
                    문제지 목록 →
                  </Link>
                </div>
                <div className="mt-2 flex flex-col divide-y divide-zinc-100">
                  {g.papers.map((p) => (
                    <Link
                      key={p.paper.id}
                      href={`/mypage/wrong-notes/${g.subject.slug}/${p.paper.id}`}
                      className="group flex items-center gap-2 py-2.5"
                    >
                      <span className="truncate text-sm group-hover:text-blue-600">
                        {p.paper.title}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
                        <span
                          className={`font-medium ${p.unresolvedCount > 0 ? "text-red-600" : "text-zinc-400"}`}
                        >
                          오답 {p.unresolvedCount}
                        </span>
                        {p.resolvedCount > 0 && (
                          <span className="font-medium text-emerald-600">
                            극복 {p.resolvedCount}
                          </span>
                        )}
                        <ChevronRight
                          size={14}
                          className="text-zinc-300 group-hover:text-blue-600"
                        />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
