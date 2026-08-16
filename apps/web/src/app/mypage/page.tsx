// 홈 → 마이페이지 이동이 항상 즉시(스켈레톤 셸) 뜨는지 빌드가 검증하게 한다.
// tab 쿼리스트링이 실제로 쓰이는 세 가지 모양(없음/history/wrong-notes)을
// 샘플로 선언해야 검증이 "선언 안 된 검색 파라미터 접근"으로 막지 않는다.
export const unstable_instant = {
  prefetch: "static",
  samples: [
    { searchParams: { tab: null } },
    { searchParams: { tab: "history" } },
    { searchParams: { tab: "wrong-notes" } },
  ],
};

import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenCheck, ChevronRight, Star, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { FavoriteSubjectsEditor } from "@/components/favorite-subjects-editor";
import { MyPageTabs, type MyPageTabKey } from "@/components/mypage-tabs";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { DiagnosisBanner, type DiagnosisBannerState } from "@/components/diagnosis-banner";
import { ReviewDueCard, type ReviewDueCardProps } from "@/components/review-due-card";
import { getTodayDiagnosis, getDiagnosisEligibility } from "@/lib/ai-diagnosis";
import { getMembership, isAdminUser } from "@/lib/membership";
import { getDueReviewSummary } from "@/lib/review-queue";
import { findUnfinishedDueSession } from "@/lib/review-session";
import { getReviewSubjectOptions } from "@/lib/review-preferences";
import { isPremiumMembership, trialDaysLeft, DUE_QUEUE_LIMIT } from "@gongmoa/core";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { formatDuration } from "@gongmoa/core";
import { computeStreakDays, streakTier } from "@/lib/streak";
import { subjectColor } from "@/lib/subject-colors";
import { applyExamTypeSubjectName } from "@/lib/paper-title";
import {
  buildWrongNoteGroups,
  fetchQuestionStatusMap,
  fetchWrongAnswerRows,
  fetchWrongNoteMarks,
  getUnresolvedCountBySubject,
  type WrongNoteAttemptRow,
  type WrongNoteSubjectGroup,
} from "@/lib/wrong-notes";
import type { ExamPaper, Subject } from "@gongmoa/core";

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
    : "wrong-notes";

  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const [
    { data: bookmarkRows },
    { data: attemptRows },
    { data: subjectRows },
    { data: subjectBookmarkRows },
  ] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("id, created_at, exam_papers(*, subjects(*), exam_types(*))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("cbt_attempts")
      .select(
        "id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, round, track, choice_count, subjects(*), exam_types(*))",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("subjects").select("*").order("name"),
    supabase.from("subject_bookmarks").select("subject_id").eq("user_id", user.id),
  ]);

  const allSubjects = (subjectRows ?? []) as Subject[];
  const bookmarkedSubjectIds = (subjectBookmarkRows ?? []).map(
    (r) => r.subject_id as string,
  );

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

  // 멤버십 판정을 오답노트 집계보다 먼저 한다. 복습·진단이 멤버십 기능이고 오답노트
  // 탭의 과목 카드도 회원 여부에 따라 다르게 그리므로, 무료 회원에게는 아래의 무거운
  // 집계(문항별 오답 행 + 문항 상태 맵)를 돌리지 않는다. 관리자는 멤버십과 무관하게
  // 프리미엄으로 본다 — 검수·문의 대응을 하려면 사용자와 같은 화면을 볼 수 있어야 한다.
  const [membership, admin] = await Promise.all([
    getMembership(supabase, user.id),
    isAdminUser(supabase),
  ]);
  const premium = admin || isPremiumMembership(membership);

  // 오답노트 집계는 위에서 이미 받아온 응시 목록을 그대로 재사용하고, 문항별 오답
  // 행만 추가로 조회한다. 무료 회원에게는 돌리지 않는다 — 이 집계가 주는 건 과목
  // 카드의 "극복 진행률"뿐이고, 목록·이동은 아래 unresolvedBySubject 로 충분하다.
  let wrongNoteGroups: WrongNoteSubjectGroup[] = [];
  if (premium) {
    const myAttemptPaperIds = [
      ...new Set(
        myAttempts.map((a) => a.exam_papers?.id).filter((id): id is string => !!id),
      ),
    ];
    const [wrongRows, wrongNoteMarks, wrongNoteStatusOverrides] = await Promise.all([
      fetchWrongAnswerRows(
        supabase,
        myAttempts.map((a) => a.id),
      ),
      fetchWrongNoteMarks(supabase, user.id),
      fetchQuestionStatusMap(supabase, user.id, myAttemptPaperIds),
    ]);
    wrongNoteGroups = buildWrongNoteGroups(
      myAttempts as unknown as WrongNoteAttemptRow[],
      wrongRows,
      wrongNoteMarks.deleted,
      wrongNoteStatusOverrides,
    );
  }
  // 미극복 수는 user_question_status(CBT+섞어풀기 통합) 기준으로 센다 — 섞어풀기로
  // 극복한 게 헤드라인·과목·오늘 카드에 즉시 반영되고, 섞어풀기 후보 수와 일치한다.
  // 표가 비어 있으면(백필 전 등) 응시 기준(buildWrongNoteGroups)으로 폴백.
  //
  // 무료 회원에게도 이 값은 계산한다. 상단 "남은 오답" 요약과, 무료 회원 오답노트
  // 탭의 과목 카드(이름·slug·남은 오답)가 전부 이 결과로 그려진다.
  const unresolvedBySubject = await getUnresolvedCountBySubject(supabase, user.id);
  const totalUnresolved =
    unresolvedBySubject.size > 0
      ? [...unresolvedBySubject.values()].reduce((s, v) => s + v.unresolved, 0)
      : wrongNoteGroups.reduce((sum, g) => sum + g.unresolvedCount, 0);

  const streakDays = computeStreakDays(myAttempts.map((a) => a.created_at));
  const tier = streakTier(streakDays);

  // AI 약점 진단 배너 상태. 오늘 진단이 있으면 그 상태, 없으면 자격 판정으로 결정.
  // 진단도 멤버십 전용이라 무료 회원에게는 조회조차 하지 않는다.
  const todayDiag = premium ? await getTodayDiagnosis(supabase, user.id) : null;
  const diagEligibility =
    !premium || todayDiag ? null : await getDiagnosisEligibility(supabase, user.id);
  const diagnosisState: DiagnosisBannerState =
    todayDiag?.status === "ready"
      ? "ready"
      : todayDiag?.status === "pending"
        ? "pending"
        : diagEligibility?.eligible
          ? "eligible"
          : "locked";
  const diagnosisHint = diagEligibility?.hint ?? null;

  // 오늘의 복습(멤버십 전용). 무료 사용자에게는 요약을 조회하지도 않는다 — 못 누르는
  // 숫자는 압박만 되고, 후보 수집이 이미지 조회까지 도는 무거운 작업이라 값이다.
  // 체험 남은 일수는 관리자에게 보여주지 않는다 — 관리자는 체험이 끝나도 계속 쓸 수
  // 있으니 그 문구가 거짓말이 된다.
  const [dueSummary, subjectChoices, resumable] = premium
    ? await Promise.all([
        getDueReviewSummary(supabase, user.id),
        getReviewSubjectOptions(supabase, user.id),
        findUnfinishedDueSession(supabase, user.id),
      ])
    : [null, [], null];
  const reviewDue: ReviewDueCardProps = {
    premium,
    todayCount: dueSummary?.todayCount ?? 0,
    deferredCount: dueSummary?.deferredCount ?? 0,
    newCount: dueSummary?.newCount ?? 0,
    pendingTotal: dueSummary?.pendingTotal ?? 0,
    overdueTotal: dueSummary?.overdueTotal ?? 0,
    relearnCount: dueSummary?.relearnCount ?? 0,
    suspendedTotal: dueSummary?.suspendedTotal ?? 0,
    resumeSessionId: resumable?.sessionId ?? null,
    dailyLimit: dueSummary?.dailyLimit ?? DUE_QUEUE_LIMIT,
    subjects: dueSummary?.subjects.map((s) => ({ name: s.name, count: s.count })) ?? [],
    forecast: dueSummary?.forecast ?? [],
    nextDueOffset: dueSummary?.nextDueOffset ?? null,
    trialDaysLeft: admin ? null : trialDaysLeft(membership),
    subjectChoices,
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12 pt-6 sm:pt-8">
      {/* 홈 오답노트 배너의 #wrong-notes 딥링크가 스켈레톤 이후에도 확실히
          해당 섹션으로 스크롤되도록, 콘텐츠 마운트 후 클라이언트에서 처리한다. */}
      <ScrollToHash />
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{nickname}님의 마이페이지</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
          <Link href="/mypage/edit" className="text-blue-600 hover:underline dark:text-blue-400">
            내 정보 수정
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">CBT 응시</span>
          <span className="text-xl font-semibold">{myAttempts.length}</span>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">연속 학습</span>
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
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">남은 오답</span>
          <span
            className={`text-xl font-semibold ${totalUnresolved > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {totalUnresolved}문항
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
            allSubjects={allSubjects}
            bookmarkedSubjectIds={bookmarkedSubjectIds}
          />
        }
        history={
          <HistoryTab
            attempts={myAttempts}
            roundNumberByAttemptId={roundNumberByAttemptId}
          />
        }
        wrongNotes={
          <WrongNotesTab
            premium={premium}
            groups={wrongNoteGroups}
            unresolvedBySubject={unresolvedBySubject}
            diagnosisState={diagnosisState}
            diagnosisHint={diagnosisHint}
            reviewDue={reviewDue}
          />
        }
      />
    </div>
  );
}

// "즐겨찾기" 탭: 즐겨찾는 과목 편집 영역 + 북마크한 문제지 카드 그리드.
function BookmarksTab({
  papers,
  attemptsByPaper,
  cbtAvailability,
  allSubjects,
  bookmarkedSubjectIds,
}: {
  papers: ExamPaper[];
  attemptsByPaper: Map<string, MyAttempt[]>;
  cbtAvailability: Set<string>;
  allSubjects: Subject[];
  bookmarkedSubjectIds: string[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <FavoriteSubjectsEditor
        subjects={allSubjects}
        initialBookmarkedIds={bookmarkedSubjectIds}
      />
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Star size={18} className="text-amber-400" />
        즐겨찾기한 문제 ({papers.length})
      </h2>
      {papers.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
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
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          아직 CBT로 풀어본 문제가 없어요. 문제 상세 페이지에서 온라인 풀기를
          눌러보세요.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-700">
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
                className="group flex flex-col gap-1 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  {a.exam_papers ? (
                    <span className="text-sm font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {applyExamTypeSubjectName(a.exam_papers.title)}
                    </span>
                  ) : (
                    <span className="text-sm text-zinc-400 dark:text-zinc-600">삭제된 문제</span>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">
                    {new Date(a.created_at).toLocaleDateString("ko-KR")}
                    {a.duration_seconds != null &&
                      ` · ${formatDuration(a.duration_seconds)}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {roundNumberByAttemptId.has(a.id) && (
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                      {roundNumberByAttemptId.get(a.id)}회독
                    </span>
                  )}
                  <span className="font-semibold">
                    {a.score}/{a.total_questions}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">({pct}점)</span>
                  <span
                    className={`text-xs font-medium ${wrongCount > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    오답 {wrongCount}
                  </span>
                  <ChevronRight
                    size={15}
                    className="text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
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

// 오답노트가 돌아가는 사이클을 처음 온 사람에게 한 줄로 알려주는 스트립.
// "극복"이라는 용어의 정의가 앱 어디에도 없어서 여기서 처음 가르친다.
function HowItWorksStrip() {
  const steps = [
    { n: 1, text: "CBT에서 틀린 문제가 자동으로 저장돼요" },
    { n: 2, text: "모아서 다시 풀어요" },
    { n: 3, text: "다시 맞히면 '극복'으로 바뀌어요" },
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 dark:bg-zinc-800/50">
      {steps.map((s) => (
        <div key={s.n} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              s.n === 3
                ? "bg-emerald-500 text-white"
                : "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
            }`}
          >
            {s.n}
          </span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{s.text}</span>
        </div>
      ))}
    </div>
  );
}

// "오답노트" 탭: 과목별로 틀린 문제 수를 요약해서 보여주고, 과목을 누르면
// 문제 이미지까지 모아둔 과목 오답노트 페이지로 이어준다.
function WrongNotesTab({
  premium,
  groups,
  unresolvedBySubject,
  diagnosisState,
  diagnosisHint,
  reviewDue,
}: {
  premium: boolean;
  groups: WrongNoteSubjectGroup[];
  unresolvedBySubject: Map<string, { name: string; slug: string; unresolved: number; due: number }>;
  diagnosisState: DiagnosisBannerState;
  diagnosisHint: string | null;
  reviewDue: ReviewDueCardProps;
}) {
  // 무료 회원: 오답노트는 열람도 정리도 섞어풀기도 그대로 쓴다. 다만 무거운
  // 집계(buildWrongNoteGroups)는 돌리지 않았으므로 과목 카드를 이미 계산해 둔
  // 미극복 집계로 그린다 — 극복 진행률 바만 빠지고 이동·기능은 같다. 잠기는 것은
  // 문항 해설과 오늘의 복습(간격 반복)·AI 진단뿐이고, 그건 아래 잠금 카드가 알린다.
  if (!premium) {
    const freeSubjects = [...unresolvedBySubject.values()].sort(
      (a, b) => b.unresolved - a.unresolved || a.name.localeCompare(b.name, "ko"),
    );
    return (
      <section id="wrong-notes" className="flex scroll-mt-4 flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpenCheck size={18} className="text-blue-600 dark:text-blue-400" />
          오답노트
        </h2>
        <HowItWorksStrip />
        {freeSubjects.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
              아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로
              자동으로 정리돼요.
            </p>
            <Link
              href="/"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              문제 풀러 가기
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {freeSubjects.map((s) => (
              <Link
                key={s.slug}
                href={`/mypage/wrong-notes/${s.slug}`}
                className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
              >
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${subjectColor(s.slug)}`}
                >
                  {s.name}
                </span>
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  남은 오답 {s.unresolved}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                  오답 보기
                  <ChevronRight size={15} />
                </span>
              </Link>
            ))}
          </div>
        )}
        <ReviewDueCard {...reviewDue} />
      </section>
    );
  }

  return (
    // 홈 오답노트 배너(#wrong-notes)가 페이지 최상단이 아닌 이 섹션으로 바로
    // 스크롤되도록 앵커를 건다. scroll-mt는 스크롤 정지 위치에 약간의 여백.
    <section id="wrong-notes" className="flex scroll-mt-4 flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <BookOpenCheck size={18} className="text-blue-600 dark:text-blue-400" />
        오답노트
      </h2>
      <DiagnosisBanner initialState={diagnosisState} hint={diagnosisHint} />
      <HowItWorksStrip />
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
            아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로
            자동으로 정리돼요.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            문제 풀러 가기
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const stat = unresolvedBySubject.get(g.subject.id);
            const unresolved = stat?.unresolved ?? g.unresolvedCount;
            const total = unresolved + g.resolvedCount;
            const pct = total > 0 ? Math.round((g.resolvedCount / total) * 100) : 0;
            return (
              <Link
                key={g.subject.id}
                href={`/mypage/wrong-notes/${g.subject.slug}`}
                className="group flex flex-col gap-2.5 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${subjectColor(g.subject.slug)}`}
                  >
                    {g.subject.name}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-500">
                    <span className="font-medium text-red-600 dark:text-red-400">
                      남은 오답 {unresolved}
                    </span>
                    {g.resolvedCount > 0 && (
                      <>
                        {" · "}
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          극복 {g.resolvedCount}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                    오답 보기
                    <ChevronRight size={15} />
                  </span>
                </div>
                {/* 극복 진행률 — "이 바를 초록으로 채우는 게 목표"라는 걸 한눈에 보여준다. */}
                {total > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
                      극복 {pct}%
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <ReviewDueCard {...reviewDue} />
    </section>
  );
}
