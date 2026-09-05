import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Shuffle } from "lucide-react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getMixOverview, listMixSessions } from "@/lib/mix-practice";
import { MixPracticeStarter } from "@/components/mix-practice-starter";
import { MixSessionList } from "@/components/mix-session-list";
import { subjectColor } from "@/lib/subject-colors";

// 기출 섞어풀기 시작 화면. 과목 페이지의 "기출 섞어풀기" 버튼과 오답노트에서 들어온다.
// 고를 것은 급수와 문항 수뿐이고, 나머지(시행처·연도 범위, 순서, 안 푼 문제 우선, 개념 분산)는
// 기본값으로 흡수한다 — 공시생이 매일 쓰는 기능일수록 화면에서 결정할 게 적어야 한다.
//
// 로그인 전에도 화면은 보인다(뭘 하는 기능인지 먼저 닿아야 로그인할 이유가 생긴다).
// 시작을 누르면 로그인으로 보내고, 돌아오면 이 화면이다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const overview = await getMixOverview(slug);
  if (!overview) return {};
  return {
    title: `${overview.subject.name} 기출 섞어풀기`,
    description: `${overview.subject.name} 기출문제를 시행처 구분 없이 무작위로 섞어 원하는 문항 수만큼 풀어요. 결과는 오답노트에 날짜별로 남아요.`,
    // 사용자별 기능 화면이라 검색에 실릴 이유가 없다(과목 페이지가 대표 주소).
    robots: { index: false, follow: false },
  };
}

export default async function MixPracticePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const overview = await getMixOverview(slug);
  if (!overview) notFound();
  const { subject } = overview;

  const supabase = await createClient();
  // 로그인 여부만 필요하다 — 기록 목록 조회는 RLS 로 본인 것만 오므로 JWT 로컬 검증으로
  // 충분하다(과목 페이지의 회독 배지와 같은 판단).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const recent = userId ? await listMixSessions(supabase, userId, subject.id) : [];

  const examTypesLabel =
    overview.examTypeNames.length > 4
      ? `${overview.examTypeNames.slice(0, 4).join("·")} 등 ${overview.examTypeNames.length}개 시험`
      : overview.examTypeNames.join("·");
  const yearsLabel =
    overview.minYear && overview.maxYear
      ? overview.minYear === overview.maxYear
        ? `${overview.maxYear}년`
        : `${overview.minYear}~${overview.maxYear}년`
      : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-500 dark:text-zinc-500">
          <Link href={`/subjects/${slug}`} className="underline">
            ← {subject.name} 기출문제
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}>
            {subject.name}
          </span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Shuffle size={22} className="text-blue-600 dark:text-blue-400" />
          {subject.name} 기출 섞어풀기
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {examTypesLabel ? `${examTypesLabel}의 ` : ""}
          {subject.name} 기출을 시험 구분 없이 한 번에 섞어서 풀어요.
          {yearsLabel ? ` ${yearsLabel} 문제지 ${overview.paperCount}장,` : ""} 풀 수 있는 문항{" "}
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            {overview.questionCount.toLocaleString()}개
          </span>
          .
        </p>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/25">
        <MixPracticeStarter
          subjectSlug={subject.slug}
          subjectName={subject.name}
          questionCount={overview.questionCount}
          levelCounts={overview.levelCounts}
          loggedIn={!!userId}
        />
      </section>

      <ul className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        <li className="flex gap-2">
          <span className="shrink-0 text-blue-600 dark:text-blue-400">1</span>
          문제를 풀 때는 어느 시험 몇 번인지 보이지 않아요. 채점 후에 출처가 열려요.
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 text-blue-600 dark:text-blue-400">2</span>
          채점하면 오답노트 &gt; {subject.name}에 &ldquo;○월 ○일 섞어풀기&rdquo;로 남고,
          틀린 문제는 해설과 함께 과목 오답에 합쳐져요.
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 text-blue-600 dark:text-blue-400">3</span>
          다음에 또 시작하면 아직 안 풀어 본 문제부터 나와요. 과목 기출을 한 바퀴 다 돌면
          그때부터 다시 섞여요.
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 text-blue-600 dark:text-blue-400">4</span>
          같은 개념(예: 행정법의 처분성)이 한 번에 몰리지 않게 골라요. 한 세션에 여러 개념을
          고르게 만나야 시험처럼 풀 수 있어요.
        </li>
      </ul>

      {userId && recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">최근 섞어풀기 기록</h2>
            <Link
              href={`/mypage/wrong-notes/${slug}`}
              className="flex items-center gap-0.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              오답노트에서 전체 보기
              <ChevronRight size={14} />
            </Link>
          </div>
          <MixSessionList subjectSlug={slug} sessions={recent.slice(0, 3)} />
        </section>
      )}
    </div>
  );
}
