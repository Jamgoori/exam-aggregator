import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import {
  getExamCombo,
  getExamIndex,
  getExamYearPapers,
  examHref,
  type ExamCombo,
} from "@/lib/exam-index";
import {
  examBreadcrumbLd,
  ExamCrumbs,
  ExamPaperGrid,
  ExamPaperGridSkeleton,
  ExamYearNav,
} from "../exam-page-parts";
import type { Metadata } from "next";

// 시험(시행처+급수) 한 칸의 기출문제. 연도는 ?year= 로 걸러 보여줄 뿐 별도 주소가
// 아니다 — 연도마다 라우트를 두면 250장짜리 페이지 무더기가 생기는데, 대부분
// 카드 몇 장이라 과목 페이지에 이미 실린 목록을 다시 늘어놓는 것뿐이었다.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ exam: string }>;
}): Promise<Metadata> {
  const { exam } = await params;
  const combo = await getExamCombo(decodeURIComponent(exam));
  if (!combo) return {};

  const title = `${combo.label} 기출문제`;
  const description = `${combo.label} 공무원 시험 기출문제 ${combo.count}건을 ${combo.years[combo.years.length - 1]}년부터 ${combo.years[0]}년까지 연도별로 모았습니다. 정답과 함께 무료로 열람·다운로드하세요.`;

  return {
    title,
    description,
    // ?year= 는 같은 목록을 걸러 보여줄 뿐이라 정본을 파라미터 없는 주소로 모은다
    // (과목 페이지의 ?level=·?examTypes= 와 같은 처리).
    alternates: { canonical: examHref(combo.slug) },
    openGraph: { url: examHref(combo.slug), title, description },
  };
}

export default async function ExamComboPage({
  params,
  searchParams,
}: {
  params: Promise<{ exam: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { exam } = await params;
  const combo = await getExamCombo(decodeURIComponent(exam));
  if (!combo) notFound();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <JsonLd data={examBreadcrumbLd(combo)} />
      <ExamCrumbs />
      {/* 제목이 이미 "국가직 9급 기출문제"라 급수 배지를 따로 달지 않는다. */}
      <h1 className="text-3xl font-bold">{combo.label} 기출문제</h1>

      {/* 여기부터는 ?year= 에 딸린 내용이다. Cache Components 아래서 searchParams는
          정적 셸에서 읽을 수 없으므로(빌드가 잡아준다) 경계 뒤로 미룬다 — 셸의
          제목·빵부스러기가 먼저 뜨고 목록이 이어서 스트리밍된다. */}
      <Suspense fallback={<ExamYearSectionSkeleton />}>
        <ExamYearSection combo={combo} searchParams={searchParams} />
      </Suspense>

      <section className="border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <Link
          href="/subjects"
          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          과목별 기출문제 →
        </Link>
      </section>
    </div>
  );
}

async function ExamYearSection({
  combo,
  searchParams,
}: {
  combo: ExamCombo;
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;

  // 없는 연도를 찍고 들어오면 404 대신 최신 연도를 보여준다 — 주소가 틀렸다기보다
  // 고를 수 있는 값 중 하나를 잘못 적은 것에 가깝고, 정본은 어차피 연도 없는 주소다.
  const requested = Number(yearParam);
  const year = combo.years.includes(requested) ? requested : combo.years[0];
  const papers = await getExamYearPapers(combo.slug, year);

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">연도별 기출문제</h2>
        <ExamYearNav combo={combo} activeYear={year} />
      </section>

      <section className="mt-6 flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">
          {year}년 {combo.label} 기출문제 {papers.length.toLocaleString()}건
        </h2>
        {/* 회독·즐겨찾기 배지는 사용자별 조회라, 연도 줄과 제목을 먼저 보여주고
            이 그리드만 한 번 더 스트리밍한다. */}
        <Suspense
          key={year}
          fallback={<ExamPaperGridSkeleton count={papers.length || 8} />}
        >
          <ExamPaperGrid papers={papers} />
        </Suspense>
      </section>
    </>
  );
}

function ExamYearSectionSkeleton() {
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">연도별 기출문제</h2>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton h-8 w-24 rounded-full" />
          ))}
        </div>
      </section>
      <section className="mt-6 flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <div className="skeleton h-6 w-64 rounded-lg" />
        <ExamPaperGridSkeleton />
      </section>
    </>
  );
}

// 시험 조합은 18개 남짓으로 고정돼 있어서 정적 셸을 전부 미리 만들어둔다. 검색
// 유입의 착지 지점이라 첫 응답이 빨라야 하고, 개수가 적어 빌드 시간도 늘지 않는다.
export async function generateStaticParams() {
  const { combos } = await getExamIndex();
  return combos.map((c) => ({ exam: c.slug }));
}
