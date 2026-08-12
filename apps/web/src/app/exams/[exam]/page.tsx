import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import {
  getExamCombo,
  getExamIndex,
  getExamRecentPapers,
  examHref,
} from "@/lib/exam-index";
import {
  examBreadcrumbLd,
  ExamCrumbs,
  ExamHeading,
  ExamPaperGrid,
  ExamPaperGridSkeleton,
  ExamYearNav,
} from "../exam-page-parts";
import type { Metadata } from "next";

// 시험 페이지 상단에 거는 최근 문제지 수. 최신 연도를 통째로 걸면 연도 페이지와
// 같은 목록이 두 주소로 나가므로 일부러 "최근 N장"으로 끊는다 (exam-index.ts의
// getExamRecentPapers 주석 참고).
const RECENT_COUNT = 12;

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
    alternates: { canonical: examHref(combo.slug) },
    openGraph: { url: examHref(combo.slug), title, description },
  };
}

export default async function ExamComboPage({
  params,
}: {
  params: Promise<{ exam: string }>;
}) {
  const { exam } = await params;
  const slug = decodeURIComponent(exam);
  const combo = await getExamCombo(slug);
  if (!combo) notFound();

  const recent = await getExamRecentPapers(slug, RECENT_COUNT);
  const oldestYear = combo.years[combo.years.length - 1];
  const newestYear = combo.years[0];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <JsonLd data={examBreadcrumbLd(combo)} />
      <ExamCrumbs combo={combo} />
      <ExamHeading combo={combo}>
        {combo.label} 공무원 시험 기출문제{" "}
        <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
          {combo.count.toLocaleString()}건
        </strong>
        을 모았어요.{" "}
        {oldestYear === newestYear
          ? `${newestYear}년`
          : `${oldestYear}년부터 ${newestYear}년까지`}{" "}
        연도별로 정리했으며, 문제지와 정답을 무료로 열람·다운로드할 수 있습니다.
        연도를 고르면 그 해에 출제된 과목별 기출문제를 한눈에 볼 수 있어요.
      </ExamHeading>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">연도별 기출문제</h2>
        <ExamYearNav combo={combo} />
      </section>

      {recent.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">최근 올라온 기출문제</h2>
            <Link
              href={examHref(combo.slug, newestYear)}
              className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {newestYear}년 전체보기
            </Link>
          </div>
          {/* 회독·즐겨찾기 배지는 사용자별 조회라, 머리말과 연도 목록을 먼저
              보여주고 이 그리드만 스트리밍한다. */}
          <Suspense fallback={<ExamPaperGridSkeleton count={RECENT_COUNT} />}>
            <ExamPaperGrid papers={recent} />
          </Suspense>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">과목으로 찾기</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {combo.label}뿐 아니라 다른 시험까지 한 과목만 몰아서 풀고 싶다면{" "}
          <Link
            href="/subjects"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            과목별 기출문제
          </Link>
          에서 국어·영어·한국사 등 과목을 골라보세요.
        </p>
      </section>
    </div>
  );
}

// 시험 조합은 18개 남짓으로 고정돼 있어서 정적 셸을 전부 미리 만들어둔다. 검색
// 유입의 착지 지점이라 첫 응답이 빨라야 하고, 개수가 적어 빌드 시간도 늘지 않는다.
export async function generateStaticParams() {
  const { combos } = await getExamIndex();
  return combos.map((c) => ({ exam: c.slug }));
}
