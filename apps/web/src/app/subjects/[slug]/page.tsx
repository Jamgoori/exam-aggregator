import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getSubjectIndex } from "@/lib/subject-index";
import { ExamCard } from "@/components/exam-card";
import { Pagination } from "@/components/pagination";
import { levelColor, compareLevels } from "@/lib/level-colors";
import { examTypeTabColor } from "@/lib/exam-type-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import { JsonLd } from "@/components/json-ld";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import {
  collapseDuplicatePapers,
  collidingPaperIds,
  fetchPaperIdentitySignals,
} from "@/lib/dedup-papers";
import type { ExamPaper } from "@gongmoa/core";
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

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ level?: string; examTypes?: string; page?: string }>;
}) {
  const { slug } = await params;
  const { level, examTypes: examTypesParam, page } = await searchParams;
  const selectedExamTypeIds = new Set(
    (examTypesParam ?? "").split(",").filter(Boolean),
  );
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  const subject = await getSubject(slug);

  if (!subject) {
    notFound();
  }

  // 회독 배지용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — cbt_attempts
  // 조회 자체가 RLS로 본인 것만 반환되므로 인증 서버 왕복(getUser)이 필요 없다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // 이 과목(+필터)의 문제지를 전부 받아 중복(직류만 다른 같은 시험지)을 합친 뒤에
  // 페이지를 자른다. SQL LIMIT/OFFSET으로 먼저 자르면 대표가 잘려나간 페이지에 걸려
  // 페이지 경계·총 개수가 흔들리므로, 합친 다음 메모리에서 페이지네이션한다.
  // PostgREST 기본 max_rows(1000)에 걸려 조용히 잘리지 않도록 1000건씩 이어받는다.
  async function fetchAllSubjectPapers(): Promise<ExamPaper[]> {
    const BATCH_SIZE = 1000;
    const rows: ExamPaper[] = [];
    let start = 0;
    while (true) {
      let q = supabase
        .from("exam_papers")
        .select("*, subjects(*), exam_types(*)")
        .eq("subject_id", subject!.id);
      if (level) q = q.eq("level", level);
      if (selectedExamTypeIds.size > 0)
        q = q.in("exam_type_id", [...selectedExamTypeIds]);
      const { data, error } = await q
        .order("year", { ascending: false })
        .order("round", { ascending: false })
        .order("id", { ascending: true })
        .range(start, start + BATCH_SIZE - 1);
      if (error || !data || data.length === 0) break;
      rows.push(...(data as unknown as ExamPaper[]));
      if (data.length < BATCH_SIZE) break;
      start += BATCH_SIZE;
    }
    return rows;
  }

  // 급수 탭은 이 과목에 존재하는 급수 종류만 필요하므로, 목록 전체를 받아오는 대신
  // level 컬럼만 가볍게 조회해서 만든다.
  const [
    { data: levelRows },
    { data: examTypeRows },
    allSubjectPapers,
    myRoundCounts,
    bookmarkedSubjectIds,
  ] = await Promise.all([
    supabase.from("exam_papers").select("level").eq("subject_id", subject.id),
    // 직렬 탭도 급수 탭과 같은 이유로, 이 과목에 실제 존재하는 직렬만 가볍게 조회한다.
    supabase
      .from("exam_papers")
      .select("exam_type_id, exam_types(id, name, display_order)")
      .eq("subject_id", subject.id),
    fetchAllSubjectPapers(),
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
    userId
      ? getMyBookmarkedSubjectIds(supabase, userId)
      : Promise.resolve(new Set<string>()),
  ]);

  // 메타데이터가 같아도 정답 배열까지 일치할 때만 합친 뒤, 이 페이지에 보일 만큼만
  // 자른다. 확인용 조회는 정말 겹칠 수 있는 문제지에 대해서만 한다.
  const signals = await fetchPaperIdentitySignals(
    supabase,
    collidingPaperIds(allSubjectPapers),
  );
  const dedupedPapers = collapseDuplicatePapers(allSubjectPapers, signals);
  const totalPages = Math.max(1, Math.ceil(dedupedPapers.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;

  const availableLevels = [
    ...new Set(
      (levelRows ?? []).map((r) => r.level).filter((l): l is string => !!l),
    ),
  ].sort(compareLevels);

  const examTypeById = new Map<
    string,
    { id: string; name: string; display_order: number }
  >();
  for (const row of examTypeRows ?? []) {
    const et = row.exam_types as unknown as
      | { id: string; name: string; display_order: number }
      | null;
    if (et) examTypeById.set(et.id, et);
  }
  const availableExamTypes = [...examTypeById.values()].sort(
    (a, b) => a.display_order - b.display_order,
  );

  const filteredPapers = dedupedPapers.slice(pageStart, pageStart + PAGE_SIZE);

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

  // 카드 목록이 정해진 뒤에야 그 문제지들의 id를 알 수 있어서, 메인 조회와
  // 병렬로 묶지 않고 그 다음 단계에서 한 번 더 병렬 조회한다.
  const filteredPaperIds = filteredPapers.map((p) => p.id);
  const [bookmarkedIds, cbtAvailability] = await Promise.all([
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, filteredPaperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, filteredPaperIds),
  ]);

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
          <SubjectBookmarkButton
            subjectId={subject.id}
            initialBookmarked={bookmarkedSubjectIds.has(subject.id)}
            loggedIn={!!userId}
          />
        </div>
        {dedupedPapers.length > 0 && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            {dedupedPapers.length.toLocaleString()}건
          </p>
        )}
      </div>

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
              {subject.name} 기출 섞어풀기
            </span>
            <span className="text-xs text-blue-800/80 dark:text-blue-300/80">
              시험 구분 없이 {subject.name} 기출을 무작위로 섞어 원하는 문항 수만큼 풀어요.
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
            {(levelRows ?? []).length === 0
              ? "아직 업로드된 기출문제가 없습니다."
              : "조건에 맞는 기출문제가 없습니다."}
          </p>
        )}
        {filteredPapers.map((paper) => (
          <ExamCard
            key={paper.id}
            paper={paper}
            linkLevel={level}
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
    </div>
  );
}
