import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { examTypeFilledColor } from "@/lib/exam-type-colors";
import { getExamIndex, examHref, type ExamCombo } from "@/lib/exam-index";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import type { Metadata } from "next";

// 시험(시행처+급수)별 기출문제 허브.
//
// 왜 필요했나: 수험생이 실제로 치는 검색어는 "국가직 9급 기출문제", "지방직 9급
// 기출" 처럼 시행처와 급수를 묶은 말인데, 그 제목을 가진 페이지가 사이트에 하나도
// 없었다. 과목축(/subjects)만 있었기 때문이다. 여기서부터 시험 → 연도로 내려가는
// 축을 하나 더 만든다.
export const metadata: Metadata = {
  title: "시험별 기출문제 - 국가직·지방직·법원직·경찰",
  description:
    "국가직 9급·7급, 지방직 9급, 법원직, 국회직, 경찰, 소방 등 공무원 시험별 기출문제를 연도별로 모았습니다. 정답과 함께 무료로 열람·다운로드하세요.",
  alternates: { canonical: "/exams" },
  openGraph: { url: "/exams", title: "시험별 기출문제" },
};

// 같은 시행처의 급수들을 한 덩어리로 보여준다 — "국가직" 아래 9급·7급·5급이
// 나란히 서야 사람이 자기 시험을 한 번에 찾는다.
function groupByExamType(combos: ExamCombo[]) {
  const groups = new Map<string, ExamCombo[]>();
  for (const combo of combos) {
    const list = groups.get(combo.examTypeName);
    if (list) list.push(combo);
    else groups.set(combo.examTypeName, [combo]);
  }
  return [...groups.entries()].map(([examTypeName, items]) => ({
    examTypeName,
    items,
  }));
}

export default async function ExamsIndexPage() {
  const { combos, totalCount } = await getExamIndex();
  const groups = groupByExamType(combos);
  const newestYear = Math.max(...combos.flatMap((c) => c.years));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "시험별 기출문제",
          url: absoluteUrl("/exams"),
          inLanguage: "ko-KR",
          isPartOf: { "@id": `${SITE_URL}/#website` },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: combos.length,
            itemListElement: combos.map((combo, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: `${combo.label} 기출문제`,
              url: absoluteUrl(examHref(combo.slug)),
            })),
          },
        }}
      />

      <div className="flex flex-col gap-3">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 홈으로
        </Link>
        <h1 className="text-3xl font-bold">시험별 기출문제</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          국가직·지방직·법원직·국회직·군무원·경찰·소방 등 공무원 시험 기출문제{" "}
          <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
            {totalCount.toLocaleString()}건
          </strong>
          을 시험별로 정리했어요. 최신 자료는 {newestYear}년까지 올라와 있고,
          시험을 고르면 연도별 기출문제를 정답과 함께 무료로 볼 수 있습니다.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.examTypeName} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 border-b border-zinc-100 pb-2 text-lg font-semibold dark:border-zinc-800">
            {/* 시행처를 눈으로 구분하는 색 표식. 배지에 이름을 또 넣으면 바로 뒤
                제목과 같은 말이 두 번 나오므로 색만 남긴다. */}
            <span
              aria-hidden
              className={`h-4 w-1.5 rounded-full ${examTypeFilledColor(group.examTypeName)}`}
            />
            {group.examTypeName} 기출문제
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((combo) => (
              <li key={combo.slug}>
                <Link
                  href={examHref(combo.slug)}
                  className="flex h-full flex-col gap-1 rounded-lg border border-zinc-200 px-3 py-2.5 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
                >
                  {/* 급수 배지는 달지 않는다 — 바로 옆 이름이 이미 "국가직 9급"
                      이라 같은 말이 두 번 보인다. */}
                  <span className="font-medium">{combo.label} 기출문제</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">
                    {combo.count.toLocaleString()}건 ·{" "}
                    {combo.years[combo.years.length - 1]}~{combo.years[0]}년
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">과목으로 찾기</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          국어·영어·한국사·행정법처럼 과목 하나만 몰아서 풀고 싶다면{" "}
          <Link
            href="/subjects"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            과목별 기출문제
          </Link>
          에서 찾을 수 있습니다.
        </p>
      </section>
    </div>
  );
}
