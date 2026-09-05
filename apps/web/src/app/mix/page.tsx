import Link from "next/link";
import { ChevronRight, Shuffle } from "lucide-react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSubjectIndex } from "@/lib/subject-index";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { listRecentMixSessions } from "@/lib/mix-practice";
import { subjectColor } from "@/lib/subject-colors";
import { KST_TIME_ZONE } from "@gongmoa/core";

// 메뉴바의 "섞어풀기" 입구. 섞어풀기는 과목 하나를 정해야 시작할 수 있으므로, 이
// 화면은 "어느 과목을 풀지" 하나만 묻는다 — 문항 수·급수·연도 같은 설정은 과목을
// 고른 다음 화면(/subjects/[slug]/mix)에 있다.
//
// 과목 목록(/subjects)과 겹쳐 보이지만 목적이 다르다. 그쪽은 자료를 찾는 색인이고
// 여기는 바로 풀기 시작하는 자리라, 카드가 문제지 수 대신 "섞어풀기 시작"으로 간다.
// 색인 가치는 /subjects 가 이미 가져가므로 이 화면은 검색에 싣지 않는다.
export const metadata: Metadata = {
  title: "기출 섞어풀기",
  description:
    "과목을 고르면 그 과목 기출문제를 시행처 구분 없이 무작위로 섞어 원하는 문항 수만큼 풀 수 있어요.",
  robots: { index: false, follow: false },
};

export default async function MixHubPage() {
  const supabase = await createClient();
  // 로그인 여부와 즐겨찾기만 필요하다 — 조회는 RLS 로 본인 것만 오므로 JWT 로컬
  // 검증으로 충분하다(과목 페이지의 회독 배지와 같은 판단).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  const [{ entries }, favoriteIds, recent] = await Promise.all([
    getSubjectIndex(),
    userId
      ? getMyBookmarkedSubjectIds(supabase, userId)
      : Promise.resolve(new Set<string>()),
    userId ? listRecentMixSessions(userId) : Promise.resolve([]),
  ]);

  // 즐겨찾는 과목을 앞으로. 공시생은 보통 5과목만 도는데 목록에는 수십 과목이 있어,
  // 즐겨찾기를 해 둔 사람에게는 그게 곧 "내 과목 목록"이다.
  // getSubjectIndex 는 slug 만 주므로 즐겨찾기(과목 id)와 맞추려면 slug 로 환원한다.
  const favoriteSlugs = await resolveFavoriteSlugs(supabase, favoriteIds);
  const sorted = [...entries].sort((a, b) => {
    const fa = favoriteSlugs.has(a.slug) ? 0 : 1;
    const fb = favoriteSlugs.has(b.slug) ? 0 : 1;
    return fa - fb || a.name.localeCompare(b.name, "ko");
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Shuffle size={22} className="text-blue-600 dark:text-blue-400" />
          기출 섞어풀기
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          과목을 고르면 그 과목 기출을 국가직·지방직·경찰·소방 구분 없이 섞어서 풀어요.
          급수·연도·문항 수는 다음 화면에서 고르고, 결과는 오답노트에 날짜별로 남아요.
        </p>
      </div>

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            최근 섞어풀기
          </h2>
          <div className="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-700/70 dark:border-zinc-700">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/mypage/wrong-notes/${s.subjectSlug}/mix/${s.id}`}
                className="group flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${subjectColor(s.subjectSlug)}`}
                >
                  {s.subjectName}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-700 group-hover:text-blue-600 dark:text-zinc-300 dark:group-hover:text-blue-400">
                  {s.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-500">
                  {s.score}/{s.total}
                </span>
                <span className="hidden shrink-0 text-xs text-zinc-400 sm:inline dark:text-zinc-600">
                  {new Date(s.createdAt).toLocaleDateString("ko-KR", {
                    timeZone: KST_TIME_ZONE,
                    month: "numeric",
                    day: "numeric",
                  })}
                </span>
                <ChevronRight
                  size={14}
                  className="shrink-0 text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            과목 고르기
          </h2>
          {favoriteSlugs.size > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">
              즐겨찾는 과목이 위에 있어요
            </span>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
            아직 풀 수 있는 과목이 없어요.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sorted.map((entry) => (
              <Link
                key={entry.slug}
                href={`/subjects/${entry.slug}/mix`}
                className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
              >
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${subjectColor(entry.slug)}`}
                >
                  {entry.name}
                </span>
                <span className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-500">
                  {favoriteSlugs.has(entry.slug) && (
                    <span className="mr-1 text-amber-500">★</span>
                  )}
                  기출 {entry.count.toLocaleString()}장
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                  섞어풀기
                  <ChevronRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// 즐겨찾기는 과목 id로 저장되는데 목록은 slug 축이라, 고른 id 만 slug 로 환원한다.
// 즐겨찾기가 없으면 조회 자체를 하지 않는다.
async function resolveFavoriteSlugs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: Set<string>,
): Promise<Set<string>> {
  if (ids.size === 0) return new Set();
  const { data } = await supabase
    .from("subjects")
    .select("slug")
    .in("id", [...ids]);
  return new Set((data ?? []).map((r) => r.slug as string));
}
