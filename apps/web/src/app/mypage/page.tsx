// 홈 → 마이페이지 이동이 항상 즉시(스켈레톤 셸) 뜨는지 빌드가 검증하게 한다.
// tab 쿼리스트링이 실제로 쓰이는 다섯 가지 모양(없음/history/wrong-notes/bookmarks/
// attendance)을 샘플로 선언해야 검증이 "선언 안 된 검색 파라미터 접근"으로 막지 않는다.
export const unstable_instant = {
  prefetch: "static",
  samples: [
    { searchParams: { tab: null } },
    { searchParams: { tab: "history" } },
    { searchParams: { tab: "wrong-notes" } },
    { searchParams: { tab: "bookmarks" } },
    { searchParams: { tab: "attendance" } },
  ],
};

import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenCheck, ChevronRight, Shuffle, Star, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { FavoriteSubjectsEditor } from "@/components/favorite-subjects-editor";
import { MyPageTabs, type MyPageTabKey } from "@/components/mypage-tabs";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { Avatar } from "@/components/user-menu";
import { avatarUrl } from "@/lib/avatars";
import { ReviewDueCard, type ReviewDueCardProps } from "@/components/review-due-card";
import { AttendanceCard } from "@/components/attendance-card";
import { DiagnosisProgress } from "@/components/diagnosis-progress";
import { getDiagnosisEligibility, getWeeklyDiagnosis } from "@/lib/ai-diagnosis";
import { getMembership, isAdminUser } from "@/lib/membership";
import { getDueReviewSummary } from "@/lib/review-queue";
import { getAttendanceSummary } from "@/lib/attendance";
import { findUnfinishedDueSession } from "@/lib/review-session";
import { getReviewSubjectOptions } from "@/lib/review-preferences";
import {
  isPremiumMembership,
  isAttendanceOpen,
  isFreeForAll,
  FREE_UNTIL_LABEL,
  membershipDaysLeft,
  trialDaysLeft,
  DUE_QUEUE_LIMIT,
  // "N회독" 계산은 core(data/attempts.ts) — 앱 마이페이지가 같은 회독 번호를 붙인다.
  computeAttemptRounds,
} from "@gongmoa/core";
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

const TAB_KEYS: MyPageTabKey[] = ["wrong-notes", "history", "attendance", "bookmarks"];

// 지금 열 수 있는 탭인지. 출석체크는 전면 무료 이벤트 동안 닫혀 있어(core 의
// isAttendanceOpen) ?tab=attendance 로 들어와도 기본 탭으로 떨어뜨린다 — 예전 링크나
// 북마크로 들어온 사람이 빈 화면을 만나지 않게.
function isOpenTab(key: MyPageTabKey): boolean {
  return key !== "attendance" || isAttendanceOpen();
}

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

// 만료일을 "9월 29일까지" 로. 해가 바뀌면 연도까지 적는다 — 12월에 보는 "1월 5일"이
// 올해인지 내년인지 헷갈리면 남은 일수를 다시 세게 된다.
//
// 타임존을 반드시 명시한다: 안 하면 서버는 UTC, 브라우저는 KST 로 그려 날짜가 하루
// 어긋난 채 hydration 경고가 난다(payments/page.tsx 의 formatDateTime 과 같은 이유).
//
// now 를 인자로 받는 이유(Cache Components): 서버 컴포넌트 안에서 요청 데이터를 읽기
// 전에 new Date() 를 부르면 Next 가 프리렌더를 거부한다. 그래서 "지금"을 읽는 일은
// 이미 searchParams·쿠키를 읽은 페이지 본문에서 한 번만 하고, 아래 타일에는 다 만든
// 문자열만 넘긴다 — 타일은 시간을 모르는 순수 컴포넌트로 둔다.
function formatExpiry(iso: string, now: Date): string {
  const KST = "Asia/Seoul";
  const year = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: KST }).slice(0, 4);
  const expiry = new Date(iso);
  return expiry.toLocaleDateString("ko-KR", {
    timeZone: KST,
    ...(year(expiry) === year(now) ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
  });
}

// 요약 타일 줄(CBT 응시·연속 학습·남은 오답) 옆에 붙는 멤버십 칸.
//
// 왜 제목 옆 배지가 아니라 타일인가: 사용자가 "내 숫자"를 찾는 곳이 이 줄이다.
// 제목 옆의 작은 알약은 장식으로 읽혀 그냥 지나치는데, 멤버십 잔여일은 지나치면
// 안 되는 값이다 — 모르고 있다가 끊기면 그건 서비스 잘못이 된다.
//
// 적는 건 둘뿐이다: 며칠 남았나(숫자)와 언제까지인가(날짜). "42일 남음"만 있으면
// 달력을 열어 직접 세야 한다.
//
// 기간의 출처(무료 체험·출석 보상·결제)는 일부러 적지 않는다. 사용자가 이 칸에서
// 알고 싶은 건 "언제까지 쓰나" 하나이고, 출처는 그 답을 바꾸지 않는다 — 궁금하면
// 눌러서 요금제 페이지(CurrentStatus)에서 볼 수 있다.
//
// 만료가 가까우면(D-7) 색을 바꾼다. 끊기기 전에 한 번은 눈에 걸려야 한다는 게
// 이 칸의 존재 이유다 — 평상시엔 조용하고, 급할 때만 목소리를 낸다.
const MEMBERSHIP_SOON_DAYS = 7;

function MembershipTile({
  admin,
  premium,
  freeForAll,
  daysLeft,
  expiryLabel,
}: {
  admin: boolean;
  premium: boolean;
  // 전면 무료 이벤트 기간인지. 이때는 남은 일수를 세지 않으므로(core 의 expiryDaysLeft)
  // daysLeft 가 언제나 null 이라, 아무 말도 안 하면 "무제한"만 덩그러니 남는다.
  freeForAll: boolean;
  // 며칠 남았는지(출처 무관). 무기한이거나 무료 회원이면 null.
  daysLeft: number | null;
  // "9월 29일" — 페이지 본문에서 이미 만들어 넘긴다(위 formatExpiry 주석 참고).
  expiryLabel: string | null;
}) {
  const soon = daysLeft != null && daysLeft <= MEMBERSHIP_SOON_DAYS;

  // 관리자는 멤버십과 무관하게 모든 기능을 쓴다 — 만료가 있는 것처럼 보이면 거짓말이다.
  //
  // note 가 null 이면 아랫줄을 아예 안 그린다. 무료 회원에게 "출석체크로 받으세요"
  // 같은 권유를 붙이지 않는 건, 이 칸이 상태를 알려주는 자리이지 파는 자리가
  // 아니기 때문이다 — 출석으로 늘리는 길은 출석 탭·홈 팝업이 이미 안내한다.
  const { value, note }: { value: string; note: string | null } = admin
    ? { value: "무제한", note: "관리자 계정" }
    : freeForAll
      ? { value: "전체 무료", note: `${FREE_UNTIL_LABEL}까지` }
    : premium && daysLeft != null && expiryLabel
      ? { value: `${daysLeft}일`, note: `${expiryLabel}까지` }
      : premium
        ? { value: "무제한", note: null }
        : { value: "무료 회원", note: null };

  return (
    <Link
      href="/membership"
      className={`flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border px-4 py-3 transition-colors ${
        soon
          ? "border-amber-300 bg-amber-50/50 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/20"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
      }`}
    >
      <span className="text-xs text-zinc-500 dark:text-zinc-500">멤버십</span>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-xl font-semibold ${
            soon
              ? "text-amber-700 dark:text-amber-400"
              : premium || admin
                ? "text-blue-600 dark:text-blue-400"
                : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {value}
        </span>
        {/* "42일"만 있으면 쓴 기간인지 남은 기간인지 모른다. 숫자가 있을 때만 붙인다. */}
        {daysLeft != null && !admin && premium && (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">남음</span>
        )}
      </div>
      {note && (
        <span
          className={`text-[11px] ${
            soon
              ? "font-medium text-amber-700 dark:text-amber-400"
              : "text-zinc-400 dark:text-zinc-600"
          }`}
        >
          {note}
        </span>
      )}
    </Link>
  );
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

  const initialTab: MyPageTabKey =
    TAB_KEYS.includes(tab as MyPageTabKey) && isOpenTab(tab as MyPageTabKey)
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
  // 헤더 배지용 "며칠 남았는지". 체험·결제·출석 보상을 가리지 않는다 — 여기서는
  // 왜 프리미엄인지가 아니라 언제까지인지만 말하면 된다(출처별 문구는 /membership
  // 의 CurrentStatus 가 이미 맡고 있다). 관리자는 멤버십과 무관하게 프리미엄이라
  // "N일 남음"을 보여주면 거짓말이 된다.
  const now = new Date();
  const daysLeft = admin ? null : membershipDaysLeft(membership, now);
  const membershipExpiry = membership.expiresAt
    ? formatExpiry(membership.expiresAt, now)
    : null;

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

  // 상단 "다음 행동" 카드용. 진단 자격(응시 3회 또는 오답 15개)과 이번 주기 진단
  // 유무 — 둘 다 count/단건 조회라 가볍다. 무료 회원에게도 보여준다: 잠긴 사실보다
  // "세 번 풀면 열린다"가 먼저 닿아야 세 번 온다(진단 페이지가 멤버십 안내를 맡는다).
  const [diagnosisEligibility, weeklyDiagnosis] = await Promise.all([
    getDiagnosisEligibility(supabase, user.id),
    getWeeklyDiagnosis(supabase, user.id),
  ]);

  // 월간 출석 카드. 본인 행만 읽으므로(select-own) 세션 클라이언트로 충분하다.
  // 기능이 닫혀 있으면 조회조차 하지 않는다 — 그릴 화면이 없다.
  const attendance = isAttendanceOpen()
    ? await getAttendanceSummary(supabase, user.id)
    : null;

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
        {/* 프로필 사진을 이름 옆에 둔다 — 사진을 올릴 수 있다는 사실을 알리는 자리가
            "내 정보 수정" 안쪽뿐이면 아무도 모른다(아바타를 누르면 그 화면으로 간다). */}
        <div className="mt-2 flex items-center gap-3">
          <Link
            href="/mypage/edit"
            aria-label="프로필 사진 변경"
            className="rounded-full focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
          >
            <Avatar
              nickname={nickname}
              avatarUrl={avatarUrl(user.user_metadata?.avatar_path as string | undefined)}
              size="xl"
            />
          </Link>
          <div>
            <h1 className="text-3xl font-semibold">{nickname}님의 마이페이지</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
              <Link href="/mypage/edit" className="text-blue-600 hover:underline dark:text-blue-400">
                내 정보 수정
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* 지금 이 사람이 할 다음 한 가지. 응시가 없으면 첫 모의고사, 있으면 진단까지
          얼마나 남았는지(또는 진단 받기). 요약 타일 위에 두는 건 타일 넷을 읽고 나서
          "그래서 뭘 하지"가 남지 않게 하려는 것이다. */}
      <NextActionCard
        attemptCount={myAttempts.length}
        wrongCount={diagnosisEligibility.wrongCount}
        weeklyStatus={weeklyDiagnosis?.status ?? null}
      />

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
        <MembershipTile
          admin={admin}
          premium={premium}
          freeForAll={isFreeForAll(now)}
          daysLeft={daysLeft}
          expiryLabel={membershipExpiry}
        />
      </div>

      <MyPageTabs
        initialTab={initialTab}
        attendance={attendance && <AttendanceCard {...attendance} />}
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
            reviewDue={reviewDue}
          />
        }
      />
    </div>
  );
}

// 상단 "다음 행동" 카드. 상태 기계는 셋뿐이다:
//   응시 0회          → 첫 모의고사 풀기(/papers)
//   자격 미달         → 진단까지 진행 바(응시 N/3 또는 오답 N/15)
//   자격 충족         → 진단 받기 / 이번 주 진단 보기 / 준비 중(요청은 했고 생성 대기)
function NextActionCard({
  attemptCount,
  wrongCount,
  weeklyStatus,
}: {
  attemptCount: number;
  wrongCount: number;
  weeklyStatus: "ready" | "pending" | null;
}) {
  if (attemptCount === 0) {
    return (
      <Link
        href="/papers"
        className="group flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <Trophy size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-blue-900 dark:text-blue-100">
            첫 모의고사를 풀어보세요
          </span>
          <span className="block text-xs text-blue-700/80 dark:text-blue-300/70">
            제출 즉시 채점 · 틀린 문제는 오답노트에 자동 저장
          </span>
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-blue-400 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    );
  }
  const eligibleLabel =
    weeklyStatus === "ready"
      ? "이번 주 약점 진단 보기"
      : weeklyStatus === "pending"
        ? "약점 진단 준비 중 · 개념 그래프 먼저 보기"
        : "AI 약점 진단 받기";
  return (
    <DiagnosisProgress
      attemptCount={attemptCount}
      wrongCount={wrongCount}
      eligibleLabel={eligibleLabel}
    />
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
  reviewDue,
}: {
  premium: boolean;
  groups: WrongNoteSubjectGroup[];
  unresolvedBySubject: Map<string, { name: string; slug: string; unresolved: number; due: number }>;
  reviewDue: ReviewDueCardProps;
}) {
  // 무료 회원: 오답노트는 열람도 정리도 섞어풀기도 그대로 쓴다. 다만 무거운
  // 집계(buildWrongNoteGroups)는 돌리지 않았으므로 과목 카드를 이미 계산해 둔
  // 미극복 집계로 그린다 — 극복 진행률 바만 빠지고 이동·기능은 같다. 잠기는 것은
  // 문항 해설과 오늘의 복습(간격 반복)뿐이고, 그건 아래 잠금 카드가 알린다.
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
        <MixPracticeEntry subjects={freeSubjects} />
        {freeSubjects.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
              아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로
              자동으로 정리돼요.
            </p>
            <Link
              href="/papers"
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
        <DiagnosisEntryLink />
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
      <HowItWorksStrip />
      <MixPracticeEntry
        subjects={[...unresolvedBySubject.values()].sort(
          (a, b) => b.unresolved - a.unresolved || a.name.localeCompare(b.name, "ko"),
        )}
      />
      {/* 응시는 없어도 기출 섞어풀기로 생긴 오답(상태 기준 집계)이 있으면 빈 안내를
          띄우지 않는다 — 아래 목록이 그 과목을 그린다. */}
      {groups.length === 0 && unresolvedBySubject.size === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
            아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로
            자동으로 정리돼요.
          </p>
          <Link
            href="/papers"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            문제 풀러 가기
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 응시 없이 채점된 오답(기출 섞어풀기)만 있는 과목은 응시 기준 집계(groups)에
              없다. 통합 상태 기준 집계에만 있는 과목을 뒤에 붙여 오답노트에서 사라지지
              않게 한다(무료 회원 카드와 같은 모양). */}
          {[...unresolvedBySubject.entries()]
            .filter(([id]) => !groups.some((g) => g.subject.id === id))
            .sort(([, a], [, b]) => b.unresolved - a.unresolved)
            .map(([id, s]) => (
              <Link
                key={id}
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
      <DiagnosisEntryLink />
    </section>
  );
}

// 오답노트 탭 안의 기출 섞어풀기 진입점. 오답을 "다시" 푸는 기능들 사이에서 유일하게
// "새" 문제를 내는 자리라, 과목 카드 목록과 헷갈리지 않게 한 줄짜리 띠로 둔다.
// 과목 칩은 오답이 있는 과목(= 지금 공부 중인 과목) 순이고, 그 밖의 과목은 과목
// 목록으로 보낸다 — 여기서 과목 전체를 늘어놓으면 오답노트가 과목 색인이 된다.
function MixPracticeEntry({ subjects }: { subjects: { slug: string; name: string }[] }) {
  const chips = subjects.slice(0, 6);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <div className="flex items-center gap-2">
        <Shuffle size={16} className="shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-semibold text-blue-900 dark:text-blue-200">
          기출 섞어풀기
        </span>
        <span className="hidden text-xs text-blue-800/80 sm:inline dark:text-blue-300/80">
          시험 구분 없이 과목 기출을 섞어 새 문제를 풀어요. 결과는 여기 날짜별로 남아요.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((s) => (
          <Link
            key={s.slug}
            href={`/subjects/${s.slug}/mix`}
            className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-zinc-900 dark:text-blue-300 dark:hover:bg-blue-950/60"
          >
            {s.name}
          </Link>
        ))}
        <Link
          href="/subjects"
          className="flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
        >
          {chips.length > 0 ? "다른 과목" : "과목 고르기"}
          <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  );
}

// 오답노트 탭 안의 AI 약점 진단 진입점. 모든 회원에게 보인다 — 멤버십이 없는
// 사람이 눌러도 진단 페이지가 멤버십 안내를 대신 띄우므로, 여기서 미리 숨기지
// 않는다(기능이 있다는 사실 자체가 닿아야 한다).
function DiagnosisEntryLink() {
  return (
    <Link
      href="/mypage/diagnosis"
      // 프리페치를 끈다. 이 링크가 가리키는 페이지는 진입 즉시 계정 전체 오답을 훑는
      // 무거운 집계를 돌리는데, 프리페치는 화면에 보이기만 해도 그 렌더를 시켜 버린다.
      prefetch={false}
      className="group flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/20 dark:hover:bg-violet-950/40"
    >
      <span className="flex-1 text-sm font-semibold text-violet-900 dark:text-violet-200">
        AI 약점 진단
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
