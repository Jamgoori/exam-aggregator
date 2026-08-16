// 이 라우트가 어느 진입점에서든 즉시(정적 셸로) 이동되는지 빌드가 검증하게 한다 —
// Suspense 경계가 잘못 옮겨져 이동이 다시 막히면 빌드 에러로 잡힌다. level·examTypes는
// 하단 "같은 과목 목록" 필터 탭이 쓰는 검색 파라미터라 있음/없음 둘 다 선언해둔다.
export const unstable_instant = {
  prefetch: "static",
  samples: [
    { params: { id: "sample-paper-id" }, searchParams: { level: null, examTypes: null } },
    { params: { id: "sample-paper-id" }, searchParams: { level: "9급", examTypes: "국가직" } },
  ],
};

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpenCheck, Download, ExternalLink, Monitor } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor } from "@/lib/level-colors";
import { examTypeTabColor } from "@/lib/exam-type-colors";
import { DifficultyRating } from "@/components/difficulty-rating";
import { CommentsSection } from "@/components/comments-section";
import { ExamCard } from "@/components/exam-card";
import { BookmarkButton } from "@/components/bookmark-button";
import { MyCbtRecordModal } from "@/components/my-cbt-record-modal";
import { getPaperDisplayTitle, getSubjectDisplayName } from "@/lib/paper-title";
import {
  paperHref,
  paperCbtHref,
  paperExplanationsHref,
} from "@/lib/paper-href";
import { JsonLd } from "@/components/json-ld";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import {
  getPaper,
  getPaperDetailData,
  getRelatedPapersData,
} from "./paper-detail-data";
import type { ExamPaper } from "@gongmoa/core";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) return {};
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);

  const subject = paper.subjects;
  const examType = paper.exam_types;
  const title = `${displayTitle} 기출문제`;
  const description = `${examType?.name ?? ""} ${paper.level ?? ""} ${paper.year}년 ${subject?.name ?? ""} 기출문제를 정답과 함께 무료로 열람·다운로드하세요.`
    .replace(/\s+/g, " ")
    .trim();

  // 정본은 언제나 제목 기반 주소다. 옛 UUID 주소로 들어와도(프록시 301이 먼저
  // 잡지만) 여기서 새 주소를 가리켜, 두 주소가 각자 색인되는 일이 없게 한다.
  // 하단 목록 탭이 ?level=·?examTypes= 를 붙여 만들어내는 변형 URL들도 같이 접힌다.
  const canonical = paperHref(paper);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title,
      description,
    },
  };
}

export default async function PaperDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ level?: string; examTypes?: string }>;
}) {
  const { id } = await params;
  const { level, examTypes: examTypesParam } = await searchParams;
  const selectedExamTypeIds = new Set(
    (examTypesParam ?? "").split(",").filter(Boolean),
  );

  const paper = await getPaper(id);

  if (!paper) {
    notFound();
  }
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);

  const {
    userId,
    loggedIn,
    isAdmin,
    comments,
    averageScore,
    voteCount,
    myScore,
    isBookmarked,
    hasCbtAnswers,
    hasFullExplanations,
    roundAverages,
    myCbtRecordItems,
    paperFileUrl,
    answerKey,
    answerKeyFileUrl,
  } = await getPaperDetailData(paper);

  const subject = paper.subjects;
  const examType = paper.exam_types;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 pb-12 pt-6 sm:pt-8">
      {/* 검색 결과에 "공모아 > 국어 > 2026 지방직 9급 국어" 경로가 URL 대신 표시되게
          하는 빵부스러기. 화면에는 "← 홈으로" 링크만 있고 시각적 breadcrumb은 없지만,
          과목 목록이 실제로 존재하는 상위 페이지라 구조상 정직한 계층이다. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
                ...(subject
                  ? [
                      {
                        "@type": "ListItem",
                        position: 2,
                        name: subject.name,
                        item: absoluteUrl(`/subjects/${subject.slug}`),
                      },
                    ]
                  : []),
                {
                  "@type": "ListItem",
                  position: subject ? 3 : 2,
                  name: displayTitle,
                },
              ],
            },
            {
              "@type": "LearningResource",
              name: `${displayTitle} 기출문제`,
              url: absoluteUrl(paperHref(paper)),
              inLanguage: "ko-KR",
              learningResourceType: "기출문제",
              educationalLevel: paper.level ?? undefined,
              about: subject?.name,
              datePublished: String(paper.year),
              isAccessibleForFree: true,
              publisher: { "@id": `${SITE_URL}/#organization` },
              ...(paper.question_count
                ? { numberOfItems: paper.question_count }
                : {}),
              ...(voteCount > 0 && averageScore !== null
                ? {
                    aggregateRating: {
                      "@type": "AggregateRating",
                      // 화면의 난이도 별점(1~5)을 그대로 노출한다.
                      ratingValue: Number(averageScore.toFixed(1)),
                      ratingCount: voteCount,
                      bestRating: 5,
                      worstRating: 1,
                    },
                  }
                : {}),
            },
          ],
        }}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-14">
      <div className="flex flex-col gap-4">
        {/* 상위 계층으로 올라가는 링크. JSON-LD breadcrumb과 같은 경로를 화면에도
            실제 <a>로 두어야 크롤러가 과목 허브까지 되짚어 올라갈 수 있다. */}
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-500 dark:text-zinc-500">
          <Link href="/" className="hover:text-blue-600 dark:hover:text-blue-400">
            ← 홈으로
          </Link>
          {subject && (
            <>
              <span aria-hidden>·</span>
              <Link
                href={`/subjects/${subject.slug}`}
                className="hover:text-blue-600 dark:hover:text-blue-400"
              >
                {subject.name} 기출문제
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {paper.level && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}
              >
                {paper.level}
              </span>
            )}
            {subject && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
              >
                {/* 이 문제지의 과목명이라 시행처 표기를 따른다(군무원 → 행정법).
                    위 "…기출문제" 링크와 아래 "…기출문제 목록"은 여러 시행처가
                    모이는 과목 페이지로 가는 길이라 DB 이름을 그대로 쓴다. */}
                {getSubjectDisplayName(subject.name, examType?.name)}
              </span>
            )}
          </div>
          <BookmarkButton
            paperId={paper.id}
            initialBookmarked={isBookmarked}
            loggedIn={loggedIn}
          />
        </div>

        <div>
          <h1 className="text-[27px] font-bold leading-snug sm:text-3xl">
            {displayTitle}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            {examType?.name}
            {examType?.name ? " · " : ""}
            {paper.year}년
            {paper.round > 1 ? ` · ${paper.round}회차` : ""}
            {paper.question_count
              ? ` · ${paper.question_count}문제`
              : ""}
          </p>
          {paper.tags.length > 0 && (
            <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-600">
              {paper.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* 주 동선인 "온라인에서 풀기"를 맨 위 + 단색(primary)으로 두고, 나머지
            열기 버튼들은 연한 파랑으로 통일한다. CBT를 지원하지 않는 문제지는
            primary 자리가 비므로 문제 열기가 단색을 물려받는다. */}
        {hasCbtAnswers && (
          <Link
            href={paperCbtHref(paper)}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-4 text-lg font-medium text-white hover:bg-blue-700"
          >
            <Monitor size={20} />
            온라인에서 풀기
          </Link>
        )}

        <div className="flex items-stretch gap-2">
          <a
            href={paperFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-4 text-lg font-medium ${
              hasCbtAnswers
                ? "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            <ExternalLink size={20} />
            문제 열기
          </a>
          <a
            href={`/download/${paper.id}`}
            aria-label="문제 다운로드"
            title="문제 다운로드"
            className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
          >
            <Download size={20} />
          </a>
        </div>

        {answerKey && answerKeyFileUrl && (
          <div className="flex items-stretch gap-2">
            <a
              href={answerKeyFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-lg font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
            >
              <ExternalLink size={20} />
              정답 열기
            </a>
            <a
              href={`/download/answer/${answerKey.id}`}
              aria-label="정답 다운로드"
              title="정답 다운로드"
              className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
            >
              <Download size={20} />
            </a>
          </div>
        )}

        {/* 전 문항 해설이 준비된 문제지에만 노출. 학습 자료라는 성격이 드러나게
            오답노트의 "정답/극복"과 같은 에메랄드 계열로 살짝 구분해준다. 문제/정답과
            같은 자리에 다운로드 아이콘을 따로 둔다 — 해설은 저장 파일이 아니라
            페이지를 인쇄해 PDF로 저장하는 방식이라, 이 아이콘은 같은 페이지를
            ?download=1로 열어 자동으로 인쇄창을 띄운다. */}
        {hasFullExplanations && (
          <div className="flex items-stretch gap-2">
            <Link
              href={paperExplanationsHref(paper)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-lg font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
            >
              <BookOpenCheck size={20} />
              해설 열기
            </Link>
            <Link
              href={`${paperExplanationsHref(paper)}?download=1`}
              aria-label="해설 다운로드"
              title="해설 다운로드"
              className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400"
            >
              <Download size={20} />
            </Link>
          </div>
        )}

        {myCbtRecordItems.length > 0 && (
          <div className="mt-1 flex items-center justify-end gap-2 text-xs text-zinc-400 dark:text-zinc-600">
            <MyCbtRecordModal attempts={myCbtRecordItems} roundAverages={roundAverages} />
          </div>
        )}
      </div>

      <DifficultyRating
        paperId={paper.id}
        averageScore={averageScore}
        voteCount={voteCount}
        loggedIn={loggedIn}
        initialMyScore={myScore}
      />

      <CommentsSection
        paperId={paper.id}
        comments={comments}
        currentUserId={userId}
        loggedIn={loggedIn}
        isAdmin={isAdmin}
      />
      </div>

      {/* 하단 "같은 과목 목록"은 목록 조회 → 중복 통합 신호 → 카드 배지 확인이
          직렬로 이어지는 가장 느린 구간이라, 상단(제목·버튼·평점·댓글)을 먼저
          보여주고 이 섹션만 Suspense 뒤에서 스트리밍한다. */}
      {subject ? (
        <Suspense fallback={<RelatedPapersSkeleton />}>
          <RelatedPapers
            paper={paper}
            subject={subject}
            level={level}
            selectedExamTypeIds={selectedExamTypeIds}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

// Suspense 경계 안에서 자기 데이터를 직접 기다렸다가 그리는 비동기 섹션.
async function RelatedPapers({
  paper,
  subject,
  level,
  selectedExamTypeIds,
}: {
  paper: ExamPaper;
  subject: NonNullable<ExamPaper["subjects"]>;
  level?: string;
  selectedExamTypeIds: Set<string>;
}) {
  const related = await getRelatedPapersData(paper, level, selectedExamTypeIds);
  if (!related || related.subjectPapers.length === 0) return null;

  return (
    <RelatedPapersSection
      subject={subject}
      papers={related.subjectPapers}
      availableLevels={related.availableLevels}
      level={level}
      availableExamTypes={related.availableExamTypes}
      selectedExamTypeIds={selectedExamTypeIds}
      currentPaperId={paper.id}
      currentPaperHref={paperHref(paper)}
      myRoundCounts={related.myRoundCounts}
      bookmarkedIds={related.subjectBookmarkedIds}
      cbtAvailability={related.subjectCbtAvailability}
      loggedIn={related.loggedIn}
    />
  );
}

// 스트리밍이 끝나기 전 하단 섹션 자리에 깔리는 스켈레톤 — loading.tsx의 하단
// 블록과 같은 모양이라, 전체 스켈레톤에서 실제 페이지로 바뀔 때 이 자리만
// 그대로 이어져 화면이 덜컹거리지 않는다.
function RelatedPapersSkeleton() {
  return (
    <div className="flex flex-col gap-4 border-t border-zinc-100 pt-14 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-4">
        <div className="skeleton h-5 w-40 rounded-lg" />
        <div className="skeleton h-4 w-14 rounded-lg" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-8 w-14 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
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
    </div>
  );
}

// "같은 과목 기출문제 목록" 섹션: 급수 탭(그 과목에 실제 존재하는 급수가 2개
// 이상일 때만) + 최근 문제지 카드 그리드.
function RelatedPapersSection({
  subject,
  papers,
  availableLevels,
  level,
  availableExamTypes,
  selectedExamTypeIds,
  currentPaperId,
  currentPaperHref,
  myRoundCounts,
  bookmarkedIds,
  cbtAvailability,
  loggedIn,
}: {
  subject: NonNullable<ExamPaper["subjects"]>;
  papers: ExamPaper[];
  availableLevels: string[];
  level?: string;
  availableExamTypes: { id: string; name: string; display_order: number }[];
  selectedExamTypeIds: Set<string>;
  // 지금 보고 있는 카드를 표시하기 위한 id 비교용.
  currentPaperId: string;
  // 필터 탭이 되돌아올 자기 주소. id가 아니라 제목 기반 slug라 따로 받는다.
  currentPaperHref: string;
  myRoundCounts: Map<string, number>;
  bookmarkedIds: Set<string>;
  cbtAvailability: Set<string>;
  loggedIn: boolean;
}) {
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
    return qs ? `${currentPaperHref}?${qs}` : currentPaperHref;
  }

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-100 pt-14 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {subject.name} 기출문제 목록
        </h2>
        <Link
          href={`/subjects/${subject.slug}${level ? `?level=${encodeURIComponent(level)}` : ""}`}
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          전체보기
        </Link>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {papers.length === 0 && (
          <p className="col-span-full py-8 text-center text-zinc-500 dark:text-zinc-500">
            조건에 맞는 기출문제가 없습니다.
          </p>
        )}
        {papers.map((p) => (
          <ExamCard
            key={p.id}
            paper={p}
            isCurrent={p.id === currentPaperId}
            linkLevel={level}
            myRoundCount={myRoundCounts.get(p.id)}
            isBookmarked={bookmarkedIds.has(p.id)}
            loggedIn={loggedIn}
            hasCbtAnswers={cbtAvailability.has(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
