import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { examHref, type ExamCombo, type ExamComboPaper } from "@/lib/exam-index";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";

// /exams/[exam] 과 /exams/[exam]/[year] 가 함께 쓰는 조각들. 두 페이지는 보여주는
// 목록만 다르고 머리말·빵부스러기·카드 그리드는 같다.

// JSX가 아니라 JsonLd에 넘길 데이터를 만드는 함수라 소문자로 둔다.
export function examBreadcrumbLd(combo: ExamCombo, year?: number) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "시험별 기출문제",
        item: absoluteUrl("/exams"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${combo.label} 기출문제`,
        ...(year ? { item: absoluteUrl(examHref(combo.slug)) } : {}),
      },
      ...(year
        ? [
            {
              "@type": "ListItem",
              position: 4,
              name: `${year} ${combo.label} 기출문제`,
            },
          ]
        : []),
    ],
  };
}

/** 상위 계층으로 되짚어 올라가는 실제 링크 — JSON-LD 빵부스러기와 같은 경로다. */
export function ExamCrumbs({
  combo,
  showComboLink = false,
}: {
  combo: ExamCombo;
  showComboLink?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-500 dark:text-zinc-500">
      <Link href="/" className="hover:text-blue-600 dark:hover:text-blue-400">
        ← 홈으로
      </Link>
      <span aria-hidden>·</span>
      <Link
        href="/exams"
        className="hover:text-blue-600 dark:hover:text-blue-400"
      >
        시험별 기출문제
      </Link>
      {showComboLink && (
        <>
          <span aria-hidden>·</span>
          <Link
            href={examHref(combo.slug)}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            {combo.label} 기출문제
          </Link>
        </>
      )}
    </div>
  );
}

/** 연도 이동 줄. 지금 보고 있는 연도는 눌러도 제자리라 링크 대신 표시만 한다. */
export function ExamYearNav({
  combo,
  activeYear,
}: {
  combo: ExamCombo;
  activeYear?: number;
}) {
  if (combo.yearCounts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {combo.yearCounts.map(({ year, count }) =>
        year === activeYear ? (
          <span
            key={year}
            aria-current="page"
            className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-200 dark:text-zinc-900"
          >
            {year}년 {count}건
          </span>
        ) : (
          <Link
            key={year}
            href={examHref(combo.slug, year)}
            className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
          >
            {year}년 {count}건
          </Link>
        ),
      )}
    </div>
  );
}

export function ExamHeading({
  combo,
  year,
  children,
}: {
  combo: ExamCombo;
  year?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 제목이 이미 "2026 국가직 9급 기출문제"라 급수 배지를 따로 달지 않는다. */}
      <h1 className="text-3xl font-bold">
        {year ? `${year} ` : ""}
        {combo.label} 기출문제
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">{children}</p>
    </div>
  );
}

/**
 * 카드 그리드. 회독 배지·즐겨찾기는 사용자마다 다른 값이라 여기서 그때그때
 * 조회한다 — 목록 자체(문제지 데이터)는 호출한 페이지가 이미 캐시에서 받아온다.
 */
export async function ExamPaperGrid({ papers }: { papers: ExamComboPaper[] }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const paperIds = papers.map((p) => p.id);

  const [myRoundCounts, bookmarkedIds, cbtAvailability] = await Promise.all([
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, paperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, paperIds),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {papers.map((paper) => (
        <ExamCard
          key={paper.id}
          paper={paper}
          myRoundCount={myRoundCounts.get(paper.id)}
          isBookmarked={bookmarkedIds.has(paper.id)}
          loggedIn={!!userId}
          hasCbtAnswers={cbtAvailability.has(paper.id)}
        />
      ))}
    </div>
  );
}

export function ExamPaperGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="skeleton h-5 w-10 rounded" />
              <div className="skeleton h-5 w-14 rounded" />
            </div>
            <div className="skeleton h-7 w-7 shrink-0 rounded-full" />
          </div>
          <div className="skeleton h-4 w-full rounded-lg" />
          <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-700">
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="skeleton h-4 w-16 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
