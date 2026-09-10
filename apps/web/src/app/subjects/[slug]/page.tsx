import { cache, Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getSubjectIndex } from "@/lib/subject-index";
import { ExamCard } from "@/components/exam-card";
import { Pagination } from "@/components/pagination";
import { levelColor } from "@/lib/level-colors";
import { examTypeTabColor } from "@/lib/exam-type-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import { JsonLd } from "@/components/json-ld";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import { getSubjectPapers } from "@/lib/exam-index";
import { getSubjectBySlug } from "@gongmoa/core";
import type { Metadata } from "next";

const PAGE_SIZE = 24;

// generateMetadata와 페이지 본문이 같은 slug로 중복 조회하지 않도록 감싼다.
const getSubject = cache(async (slug: string) => fetchSubjectBySlug(slug));

/**
 * 과목 한 건. **쿠키 클라이언트로 읽지 않고, 캐시에 담는다.** 둘 다 필요하다.
 *
 * - cookies() 를 건드리면(createClient) 이 값을 쓰는 generateMetadata 가 동적이 된다.
 * - 캐시하지 않으면 조회 자체가 "요청 시점에만 알 수 있는 값"이라 역시 동적이 된다.
 *
 * 둘 중 하나라도 남아 있으면 제목·정본이 프리렌더된 <head> 에 박히지 못하고 렌더링
 * 뒤 스트리밍으로 밀린다 — 실측(2026-08-18): 공개 클라이언트로 바꾸기만 하고 캐시를
 * 안 걸었더니 프리렌더 산출물(.next/server/app/subjects/korean-history.html)의 <head>
 * 에 <title> 이 아예 없었고, 캐시를 걸자 들어갔다.
 *
 * 과목 정보는 로그인 여부와 무관한 공개 자료이고(RLS: public read) 이름·slug 가 거의
 * 바뀌지 않는다. 관리자가 고치면 홈 데이터와 같은 태그로 함께 갱신된다.
 */
async function fetchSubjectBySlug(slug: string) {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  return getSubjectBySlug(createPublicClient(), slug);
}

// 과목 주소를 전부 미리 알려준다(자료가 있는 과목만 — getSubjectIndex 가 빈 과목을
// 이미 걸러 준다).
//
// **왜 필요한가.** generateStaticParams 가 없으면 Next 는 주소를 모르는 채로 만든
// "fallback 셸" 하나를 모든 과목에 돌려쓴다. 주소를 모르니 아래 generateMetadata 를
// 돌릴 수 없어 그 셸에는 제목·정본이 아예 들어가지 못하는데, CDN 은 그 셸을 캐시해
// 크롤러에게도 그대로 내준다.
//
// 실측(2026-08-18, 프로덕션 /papers/2019-국가직-9급-영어):
//
//     Yeti(네이버)  x-vercel-cache=BYPASS  <title> <head> 안  ✅
//     Bingbot       x-vercel-cache=BYPASS  <title> <head> 안  ✅
//     Googlebot     x-vercel-cache=HIT     <title> 없음       ❌
//
// Next 는 UA 가 htmlLimitedBots 에 걸리면 메타데이터를 <head> 에 담아 블로킹 렌더하고
// (next.config.ts 에서 Googlebot 을 그 목록에 넣어 뒀다), 그 UA 목록은 빌드 산출물의
// 캐시 우회 규칙으로도 나간다. 그런데 Vercel 은 네이버·빙에는 그 우회를 적용하면서
// Googlebot 에는 적용하지 않는다 — 함수까지 가지 못하니 설정만으로는 못 고친다.
// 캐시되는 산출물 자체에 메타데이터가 박혀 있어야 하고, 그러려면 이 함수가 필요하다.
//
// 문제지 상세(3,800장)에는 같은 처리를 하지 않았다. 프리렌더 산출물이 장당 305KB
// (PPR postponed 데이터가 194KB)라 전부 만들면 1.1GB 가 되고, 힙 8GB 로도 빌드가
// OOM 으로 죽는다. 과목은 200장 남짓이라 19MB 로 끝난다.
export async function generateStaticParams() {
  const { entries } = await getSubjectIndex();
  return entries.map((e) => ({ slug: e.slug }));
}

// **searchParams 를 읽지 않는다.** 여기서 ?page= 를 읽으면 metadata 가 요청마다
// 달라지는 값이 되어 셸에 미리 박힐 수 없고, 그러면 위의 generateStaticParams 를
// 붙여도 제목·정본이 다시 스트리밍으로 밀린다 — 크롤러가 못 보는 그 상태로 돌아간다.
//
// 그래서 정본은 언제나 파라미터 없는 주소다. 2페이지 이후가 1페이지를 정본으로
// 가리키게 되는 것은 감수한다: 문제지 3,800장이 전부 사이트맵에 실려 있어 발견
// 경로가 페이지네이션에 걸려 있지 않고(예전 주석이 걱정하던 부분이다), 실제로
// 검색 결과에 떠야 하는 것은 1페이지다. 급수·직렬 탭(?level=·?examTypes=)도 같은
// 이유로 파라미터 없는 주소로 모인다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const subject = await getSubject(slug);
  if (!subject) return {};

  const canonical = `/subjects/${slug}`;
  const title = `${subject.name} 기출문제 모음`;
  const description = `${subject.name} 과목의 공무원 기출문제를 국가직·지방직 등 시행처별, 연도별·급수별로 모아 정답과 함께 무료로 제공합니다.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { url: canonical, title, description },
  };
}

// 본문 머리(빵부스러기·h1·자료 수)는 정적 셸에 들어간다 — searchParams 와 cookies() 를
// 이 함수에서 읽지 않는다. 필터 탭·카드 그리드는 searchParams 에 달려 있으므로
// SubjectPaperGrid 가 Suspense 안에서 읽고, 즐겨찾기 별은 SubjectBookmarkIsland 가
// 따로 채운다. 목록 자체는 'use cache' 값(getSubjectPapers)이라 요청 시점 DB 조회는
// 로그인 사용자의 개인화 값(회독·즐겨찾기)과 CBT 가능 여부 한 번뿐이다.
//
// 예전에는 페이지 최상단에서 둘 다 읽어 본문 전체가 동적이었고(정적 셸은 loading.tsx
// 뼈대뿐), 과목 행 전체 select → 중복 판별 → 즐겨찾기/CBT 확인이 직렬 세 단계로
// 이어져 크롤러까지 그 왕복을 다 기다렸다.
export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ level?: string; examTypes?: string; page?: string }>;
}) {
  const { slug } = await params;
  const subject = await getSubject(slug);

  if (!subject) {
    notFound();
  }

  const { papers: allPapers } = await getSubjectPapers(subject.id);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      {/* 검색 결과에 "공모아 > 과목별 기출문제 > 국어" 경로가 URL 대신 표시되게 한다.
          화면의 "← 홈으로 / 과목별 기출문제" 링크와 같은 계층이라 구조상 정직하다. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
            {
              "@type": "ListItem",
              position: 2,
              name: "과목별 기출문제",
              item: absoluteUrl("/subjects"),
            },
            { "@type": "ListItem", position: 3, name: `${subject.name} 기출문제` },
          ],
        }}
      />
      <div>
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-500 dark:text-zinc-500">
          <Link href="/" className="underline">
            ← 홈으로
          </Link>
          <span aria-hidden>·</span>
          <Link href="/subjects" className="underline">
            과목별 기출문제
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {/* 제목에 "기출문제"까지 넣어 <title>과 h1이 같은 말을 하게 한다 —
              과목명 한 단어짜리 제목은 이 페이지가 무엇의 목록인지 알려주지 못한다. */}
          <h1 className="text-3xl font-semibold">{subject.name} 기출문제</h1>
          <Suspense fallback={<div className="skeleton h-8 w-8 rounded-full" />}>
            <SubjectBookmarkIsland subjectId={subject.id} />
          </Suspense>
        </div>
        {allPapers.length > 0 && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            {allPapers.length.toLocaleString()}건
          </p>
        )}
      </div>

      <Suspense fallback={<SubjectPaperGridSkeleton />}>
        <SubjectPaperGrid
          slug={slug}
          subjectName={subject.name}
          subjectId={subject.id}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  );
}

// 과목 즐겨찾기 별. 사용자별 값이라 h1 옆 이 자리만 따로 채운다.
async function SubjectBookmarkIsland({ subjectId }: { subjectId: string }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const bookmarkedSubjectIds = userId
    ? await getMyBookmarkedSubjectIds(supabase, userId)
    : new Set<string>();
  return (
    <SubjectBookmarkButton
      subjectId={subjectId}
      initialBookmarked={bookmarkedSubjectIds.has(subjectId)}
      loggedIn={!!userId}
    />
  );
}

// 섞어풀기 입구 + 급수·직렬 탭 + 카드 그리드 + 페이지네이션. searchParams 를 읽는
// 유일한 자리다.
async function SubjectPaperGrid({
  slug,
  subjectName,
  subjectId,
  searchParams,
}: {
  slug: string;
  subjectName: string;
  subjectId: string;
  searchParams: Promise<{ level?: string; examTypes?: string; page?: string }>;
}) {
  const { level, examTypes: examTypesParam, page } = await searchParams;
  const selectedExamTypeIds = new Set(
    (examTypesParam ?? "").split(",").filter(Boolean),
  );
  const currentPage = Math.max(1, Number(page) || 1);

  const [{ papers: allPapers, availableLevels, availableExamTypes }, supabase] =
    await Promise.all([getSubjectPapers(subjectId), createClient()]);

  // 이 과목의 문제지 전체(중복은 이미 합쳐진 상태)에서 필터를 적용한 뒤 페이지를
  // 자른다. SQL LIMIT/OFFSET으로 먼저 자르면 대표가 잘려나간 페이지에 걸려
  // 페이지 경계·총 개수가 흔들리므로, 합친 다음 메모리에서 페이지네이션한다.
  const dedupedPapers = allPapers.filter(
    (p) =>
      (!level || p.level === level) &&
      (selectedExamTypeIds.size === 0 ||
        (p.exam_types != null && selectedExamTypeIds.has(p.exam_types.id))),
  );
  const totalPages = Math.max(1, Math.ceil(dedupedPapers.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const filteredPapers = dedupedPapers.slice(pageStart, pageStart + PAGE_SIZE);

  // 회독 배지용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — cbt_attempts
  // 조회 자체가 RLS로 본인 것만 반환되므로 인증 서버 왕복(getUser)이 필요 없다.
  // 카드 목록이 정해진 뒤라 그 문제지들의 id 로만 좁혀 한 번에 병렬 조회한다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const filteredPaperIds = filteredPapers.map((p) => p.id);
  const [myRoundCounts, bookmarkedIds, cbtAvailability] = await Promise.all([
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, filteredPaperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, filteredPaperIds),
  ]);

  // 급수 탭·직렬 탭이 서로의 선택 상태를 지우지 않도록, 두 탭 모두 이 헬퍼로
  // href를 만든다 — 인자로 넘긴 값만 바꾸고 나머지는 현재 선택을 그대로 유지한다.
  function buildFilterHref(
    nextLevel: string | undefined,
    nextExamTypeIds: Set<string>,
  ) {
    const usp = new URLSearchParams();
    if (nextLevel) usp.set("level", nextLevel);
    if (nextExamTypeIds.size > 0)
      usp.set("examTypes", [...nextExamTypeIds].join(","));
    const qs = usp.toString();
    return qs ? `/subjects/${slug}?${qs}` : `/subjects/${slug}`;
  }

  return (
    <>
      {/* 기출 섞어풀기 입구. 문제지 한 장씩 고르는 목록 위에 "이 과목 전체에서 아무거나
          N문항"이라는 다른 진입로를 하나 둔다 — 국가직·지방직·경찰 등 시행처를 가리지
          않고 섞이는 것이 이 기능의 요점이라, 시행처 탭보다 위에 둔다. 설정(문항 수)은
          다음 화면에서 고르므로 여기서는 링크 하나면 된다. 검색 색인 대상이 아닌 화면
          (robots noindex)이라 크롤러가 따라가지 않게 nofollow. */}
      {dedupedPapers.length > 0 && !level && selectedExamTypeIds.size === 0 && (
        <Link
          href={`/subjects/${slug}/mix`}
          rel="nofollow"
          className="group flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 transition-colors hover:border-blue-300 hover:bg-blue-100/70 dark:border-blue-900/50 dark:bg-blue-950/25 dark:hover:bg-blue-950/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            <Shuffle size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold text-blue-900 dark:text-blue-200">
              {subjectName} 기출 섞어풀기
            </span>
            <span className="text-xs text-blue-800/80 dark:text-blue-300/80">
              시험 구분 없이 {subjectName} 기출을 무작위로 섞어 원하는 문항 수만큼 풀어요.
              결과는 오답노트에 날짜별로 남아요.
            </span>
          </span>
          <ChevronRight
            size={18}
            className="shrink-0 text-blue-400 transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      )}
      {/* 필터 탭은 전부 rel="nofollow" 다 — 누르면 같은 목록을 걸러 보여줄 뿐이라
          정본은 파라미터 없는 주소 하나고, 직렬은 다중 선택이라 크롤러가 따라가면
          조합이 폭발한다. robots.txt 가 크롤 자체를 막지만, 여기서 nofollow 로
          링크를 끊어야 "발견됨" 목록에 쌓이는 것까지 멈춘다. */}
      {availableLevels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterHref(undefined, selectedExamTypeIds)}
            rel="nofollow"
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !level
                ? "bg-zinc-800 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            전체
          </Link>
          {availableLevels.map((lv) => (
            <Link
              key={lv}
              href={buildFilterHref(lv, selectedExamTypeIds)}
              rel="nofollow"
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                level === lv
                  ? levelColor(lv)
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              {lv}
            </Link>
          ))}
        </div>
      )}

      {/* 직렬(국가직/지방직/지역인재 등)은 여러 개를 동시에 켤 수 있는 다중 선택
          탭이라, 한 번 눌러도 급수 탭처럼 다른 선택지가 꺼지지 않고 눌린 것만
          토글된다. */}
      {availableExamTypes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterHref(level, new Set())}
            rel="nofollow"
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              selectedExamTypeIds.size === 0
                ? "bg-zinc-800 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            전체
          </Link>
          {availableExamTypes.map((et) => {
            const isSelected = selectedExamTypeIds.has(et.id);
            const nextExamTypeIds = new Set(selectedExamTypeIds);
            if (isSelected) nextExamTypeIds.delete(et.id);
            else nextExamTypeIds.add(et.id);
            return (
              <Link
                key={et.id}
                href={buildFilterHref(level, nextExamTypeIds)}
                rel="nofollow"
                aria-pressed={isSelected}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  isSelected
                    ? examTypeTabColor(et.name)
                    : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                {et.name}
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredPapers.length === 0 && (
          <p className="col-span-full py-12 text-center text-zinc-500 dark:text-zinc-500">
            {allPapers.length === 0
              ? "아직 업로드된 기출문제가 없습니다."
              : "조건에 맞는 기출문제가 없습니다."}
          </p>
        )}
        {filteredPapers.map((paper) => (
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

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        params={{
          level,
          examTypes: selectedExamTypeIds.size > 0 ? [...selectedExamTypeIds].join(",") : undefined,
        }}
        basePath={`/subjects/${slug}`}
      />
    </>
  );
}

// loading.tsx 의 탭·그리드 블록과 같은 모양 — 셸에서 실제 화면으로 바뀔 때 자리가
// 그대로 이어지게 한다.
function SubjectPaperGridSkeleton() {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-8 w-14 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
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
    </>
  );
}
