import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

// generateMetadata와 페이지 본문이 같은 slug로 중복 조회하지 않도록 캐싱
const getSubject = cache(async (slug: string) => {
  const supabase = await createClient();
  return getSubjectBySlug(supabase, slug);
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ level?: string; examTypes?: string; page?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { page } = await searchParams;
  const subject = await getSubject(slug);
  if (!subject) return {};

  // 급수·직렬 탭(?level=·?examTypes=)은 같은 목록을 걸러 보여줄 뿐이라 정본을
  // 파라미터 없는 주소로 모은다. 반면 ?page= 는 내용이 실제로 다른 페이지다 —
  // 2페이지 이후까지 1페이지를 정본으로 가리키면 크롤러가 그 페이지들을 중복으로
  // 보고 덜 방문하게 되고, 거기서만 링크되는 문제지가 발견되지 않는다.
  // 그래서 페이지 번호만 정본에 남긴다.
  const pageNum = Math.max(1, Number(page) || 1);
  const canonical =
    pageNum > 1 ? `/subjects/${slug}?page=${pageNum}` : `/subjects/${slug}`;

  const title =
    pageNum > 1
      ? `${subject.name} 기출문제 모음 (${pageNum}페이지)`
      : `${subject.name} 기출문제 모음`;
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

      {availableLevels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterHref(undefined, selectedExamTypeIds)}
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
