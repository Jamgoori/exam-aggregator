import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import {
  getExamCombo,
  getExamIndex,
  getExamYearPapers,
  examHref,
} from "@/lib/exam-index";
import { absoluteUrl } from "@/lib/site-url";
import {
  examBreadcrumbLd,
  ExamCrumbs,
  ExamHeading,
  ExamPaperGrid,
  ExamPaperGridSkeleton,
  ExamYearNav,
} from "../../exam-page-parts";
import type { Metadata } from "next";

// "2026 국가직 9급 기출문제" — 수험생이 실제로 검색창에 치는 말 그대로가 제목이
// 되는 페이지다. 시행처·급수·연도가 다 박힌 이 조합이 가장 의도가 뚜렷한 검색어라,
// 시험별 축에서 가장 중요한 착지 지점이다.

// 자료가 이보다 적은 연도는 색인에서 뺀다. 카드 한두 장짜리 페이지가 수백 개
// 생기면 사이트 전체가 "내용 없는 문서 뭉치"로 평가된다 — 페이지 자체는 그대로
// 열리고 링크도 따라가지만 검색 결과에는 올리지 않는다.
const MIN_INDEXABLE_PAPERS = 3;

async function loadYearPage(examParam: string, yearParam: string) {
  const slug = decodeURIComponent(examParam);
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return null;
  const combo = await getExamCombo(slug);
  if (!combo || !combo.years.includes(year)) return null;
  return { slug, year, combo };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ exam: string; year: string }>;
}): Promise<Metadata> {
  const { exam, year: yearParam } = await params;
  const loaded = await loadYearPage(exam, yearParam);
  if (!loaded) return {};
  const { combo, year } = loaded;

  const count = combo.yearCounts.find((y) => y.year === year)?.count ?? 0;
  const title = `${year} ${combo.label} 기출문제`;
  const description = `${year}년 ${combo.label} 공무원 시험 기출문제 ${count}건을 과목별로 모았습니다. 문제지와 정답을 무료로 열람·다운로드하고 온라인으로 풀어보세요.`;

  return {
    title,
    description,
    alternates: { canonical: examHref(combo.slug, year) },
    openGraph: { url: examHref(combo.slug, year), title, description },
    ...(count < MIN_INDEXABLE_PAPERS
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function ExamYearPage({
  params,
}: {
  params: Promise<{ exam: string; year: string }>;
}) {
  const { exam, year: yearParam } = await params;
  const loaded = await loadYearPage(exam, yearParam);
  if (!loaded) notFound();
  const { slug, year, combo } = loaded;

  const papers = await getExamYearPapers(slug, year);
  const subjectNames = [
    ...new Set(papers.flatMap((p) => (p.subjectName ? [p.subjectName] : []))),
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <JsonLd data={examBreadcrumbLd(combo, year)} />
      {/* 이 페이지가 무엇의 목록인지 기계에게도 알려준다. 항목 순서는 화면과 같다. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${year} ${combo.label} 기출문제`,
          url: absoluteUrl(examHref(combo.slug, year)),
          inLanguage: "ko-KR",
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: papers.length,
            itemListElement: papers.map((paper, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: `${year} ${combo.label} ${paper.subjectName ?? ""}`.trim(),
              url: absoluteUrl(`/papers/${paper.id}`),
            })),
          },
        }}
      />
      <ExamCrumbs combo={combo} showComboLink />
      <ExamHeading combo={combo} year={year}>
        {year}년 {combo.label} 공무원 시험에서 출제된 기출문제{" "}
        <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
          {papers.length.toLocaleString()}건
        </strong>
        입니다.
        {subjectNames.length > 0 &&
          ` ${subjectNames.slice(0, 6).join("·")}${subjectNames.length > 6 ? " 등" : ""} 과목의`}{" "}
        문제지와 정답을 무료로 열람·다운로드할 수 있고, 온라인 CBT가 준비된
        문제지는 실제 시험처럼 풀고 바로 채점할 수 있습니다.
      </ExamHeading>

      <Suspense fallback={<ExamPaperGridSkeleton count={papers.length || 8} />}>
        <ExamPaperGrid papers={papers} />
      </Suspense>

      <section className="flex flex-col gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">
          {combo.label} 다른 연도 기출문제
        </h2>
        <ExamYearNav combo={combo} activeYear={year} />
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          <Link
            href={examHref(combo.slug)}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {combo.label} 기출문제 전체보기
          </Link>
        </p>
      </section>
    </div>
  );
}

// 연도 페이지는 250장 남짓이라 전부 미리 만들어둔다. 가장 의도가 뚜렷한 검색어의
// 착지 지점이라 첫 응답이 빨라야 한다.
export async function generateStaticParams() {
  const { combos } = await getExamIndex();
  return combos.flatMap((combo) =>
    combo.years.map((year) => ({ exam: combo.slug, year: String(year) })),
  );
}
