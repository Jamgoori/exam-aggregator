import Link from "next/link";
import { CONSONANTS, initialConsonant } from "@gongmoa/core";
import { JsonLd } from "@/components/json-ld";
import { getSubjectIndex, type SubjectIndexEntry } from "@/lib/subject-index";
import { getExamIndex, examHref } from "@/lib/exam-index";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import type { Metadata } from "next";

// 과목 전체 목록 허브.
//
// 왜 필요했나: 과목 페이지(/subjects/*)로 가는 서버 렌더 링크가 사실상 없었다 —
// 홈의 ㄱㄴㄷ 탭은 눌러야 모달이 열리는 클라이언트 상태라 HTML에 <a>가 안 담기고,
// 즐겨찾기 목록은 마이페이지(robots에서 차단)에 있다. 그래서 과목 페이지 수백 장이
// 사이트맵에만 존재하는 고아 페이지였고, 그 아래 걸린 문제지 3천여 장까지 크롤
// 경로가 얕게 이어지지 못했다. 이 페이지 + 푸터 링크로 모든 화면에서
// 홈 → 과목 목록 → 과목 → 문제지 로 두 단계 만에 닿게 만든다.
export const metadata: Metadata = {
  title: "과목별 기출문제 목록",
  description:
    "국어·영어·한국사·행정법 등 공무원 시험 과목별 기출문제를 한눈에. 과목을 고르면 연도별·급수별 기출문제와 정답을 무료로 볼 수 있습니다.",
  alternates: { canonical: "/subjects" },
  openGraph: { url: "/subjects", title: "과목별 기출문제 목록" },
};

// ㄱㄴㄷ 묶음 안에서는 가나다순, 묶음 자체는 CONSONANTS 순서를 그대로 따른다.
function groupByConsonant(entries: SubjectIndexEntry[]) {
  const groups = new Map<string, SubjectIndexEntry[]>();
  for (const entry of entries) {
    // initialConsonant는 한글 음절이 아니면 null을 준다 — 영문·숫자로 시작하는
    // 과목명은 맨 뒤 "기타"로 모은다.
    const key = initialConsonant(entry.name);
    const bucket =
      key && (CONSONANTS as readonly string[]).includes(key) ? key : "기타";
    const list = groups.get(bucket);
    if (list) list.push(entry);
    else groups.set(bucket, [entry]);
  }
  const order = [...CONSONANTS, "기타"];
  return order.flatMap((key) => {
    const list = groups.get(key);
    if (!list || list.length === 0) return [];
    return [
      { key, items: [...list].sort((a, b) => a.name.localeCompare(b.name, "ko")) },
    ];
  });
}

function yearRange(entry: SubjectIndexEntry) {
  return entry.minYear === entry.maxYear
    ? `${entry.maxYear}년`
    : `${entry.minYear}~${entry.maxYear}년`;
}

export default async function SubjectsIndexPage() {
  const [{ entries, totalCount }, { combos }] = await Promise.all([
    getSubjectIndex(),
    getExamIndex(),
  ]);
  const groups = groupByConsonant(entries);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      {/* 목록형 페이지라 ItemList로 항목을 그대로 알려준다 — 검색 결과에 사이트
          내부 목록으로 인식될 여지를 만든다. 순서는 화면과 동일하다. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "과목별 기출문제 목록",
          url: absoluteUrl("/subjects"),
          inLanguage: "ko-KR",
          isPartOf: { "@id": `${SITE_URL}/#website` },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: entries.length,
            itemListElement: groups.flatMap((g) => g.items).map((entry, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: `${entry.name} 기출문제`,
              url: absoluteUrl(`/subjects/${entry.slug}`),
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
        <h1 className="text-3xl font-bold">과목별 기출문제</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          국가직·지방직·법원직·국회직·경찰·소방 등 공무원 시험 기출문제{" "}
          <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
            {totalCount.toLocaleString()}건
          </strong>
          을 {entries.length}개 과목으로 정리했어요. 과목을 고르면 연도별·급수별
          기출문제를 정답·해설과 함께 무료로 볼 수 있습니다.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 border-b border-zinc-100 pb-2 text-lg font-semibold dark:border-zinc-800">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-sm text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              {group.key}
            </span>
            <span className="text-sm font-normal text-zinc-400 dark:text-zinc-600">
              {group.items.length}과목
            </span>
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((entry) => (
              <li key={entry.slug}>
                <Link
                  href={`/subjects/${entry.slug}`}
                  className="flex items-baseline justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
                >
                  <span className="font-medium">{entry.name}</span>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                    {entry.count.toLocaleString()}건 · {yearRange(entry)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 과목축의 짝인 시험축(시행처+급수)으로 건너가는 자리. 홈의 급수 버튼으로
          보내지 않는 이유는 그쪽이 클라이언트 필터라 크롤러가 따라갈 <a>가 없고,
          같은 URL(/)에 머무르므로 검색 결과에 오를 페이지도 아니기 때문이다. */}
      <section className="flex flex-col gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">시험으로 찾기</h2>
        <div className="flex flex-wrap gap-2">
          {combos.map((combo) => (
            <Link
              key={combo.slug}
              href={examHref(combo.slug)}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
            >
              {combo.label} 기출문제
            </Link>
          ))}
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          <Link
            href="/exams"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            시험별 기출문제 전체보기
          </Link>
        </p>
      </section>
    </div>
  );
}
