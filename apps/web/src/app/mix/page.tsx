import Link from "next/link";
import { ChevronRight, Shuffle } from "lucide-react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getMixHubIndex, listRecentMixSessions } from "@/lib/mix-practice";
import { MixSubjectPicker } from "@/components/mix-subject-picker";
import { subjectColor } from "@/lib/subject-colors";
import { compareLevels, levelColor } from "@/lib/level-colors";
import { KST_TIME_ZONE, MIX_NO_LEVEL } from "@gongmoa/core";

// 메뉴바의 "섞어풀기" 입구. 섞어풀기는 과목 하나를 정해야 시작할 수 있으므로, 이
// 화면은 급수와 과목만 묻는다 — 문항 수·연도는 과목을 고른 다음 화면
// (/subjects/[slug]/mix)에 있다.
//
// 카드 숫자는 시작 화면과 같은 단위(풀 수 있는 문항 수)다 — "20문항 풀기"를 고르는
// 화면으로 가는 자리라, 여기서 "12장"을 보여주면 단위가 어긋난다.
//
// 급수를 여기서 먼저 고르는 이유: 공시생은 자기 급수가 바뀌지 않는다. 과목을 옮길
// 때마다 9급을 다시 고르게 하면 매번 같은 선택을 반복시키는 셈이라, 여기서 한 번
// 고르면 과목 시작 화면까지 그대로 이어진다(?level=).
//
// 과목 목록(/subjects)과 겹쳐 보이지만 목적이 다르다. 그쪽은 자료를 찾는 색인이고
// 여기는 바로 풀기 시작하는 자리라, 카드가 문제지 수 대신 "섞어풀기"로 간다.
// 색인 가치는 /subjects 가 이미 가져가므로 이 화면은 검색에 싣지 않는다.
export const metadata: Metadata = {
  title: "기출 섞어풀기",
  description:
    "급수와 과목을 고르면 그 과목 기출문제를 시행처 구분 없이 무작위로 섞어 원하는 문항 수만큼 풀 수 있어요.",
  robots: { index: false, follow: false },
};

export default async function MixHubPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const { level: levelParam } = await searchParams;
  const supabase = await createClient();
  // 로그인 여부와 즐겨찾기만 필요하다 — 조회는 RLS 로 본인 것만 오므로 JWT 로컬
  // 검증으로 충분하다(과목 페이지의 회독 배지와 같은 판단).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // 최근 기록·즐겨찾기는 곁다리다. 이 둘 때문에 화면 전체가 500 이 되면 안 된다
  // (2026-09-05 실측: 최근 기록의 과목 임베드 하나가 페이지를 통째로 떨어뜨렸다).
  // 본문인 과목 목록(getMixHubIndex)이 실패할 때만 에러로 남긴다.
  const [index, favoriteIds, recent] = await Promise.all([
    getMixHubIndex(),
    userId
      ? getMyBookmarkedSubjectIds(supabase, userId).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    userId
      ? listRecentMixSessions(userId).catch((e) => {
          console.error("섞어풀기 최근 기록 조회 실패", e);
          return [];
        })
      : Promise.resolve([]),
  ]);

  // 급수 탭. 9급 → 7급 → … 순이고 "기타"(승진시험처럼 어느 급수에도 안 묶이는 것)는 뒤로.
  const tiers = [...index.tiers].sort((a, b) => {
    if (a.key === MIX_NO_LEVEL) return 1;
    if (b.key === MIX_NO_LEVEL) return -1;
    return compareLevels(a.key, b.key);
  });
  // 주소로 아무 값이나 들어올 수 있어, 실제로 있는 등급일 때만 필터로 인정한다.
  const level = tiers.some((t) => t.key === levelParam) ? levelParam! : null;
  const tierLabel = (t: { key: string; approx: boolean }) =>
    t.key === MIX_NO_LEVEL ? "기타" : t.approx ? `${t.key} 수준` : t.key;
  const selectedTier = tiers.find((t) => t.key === level) ?? null;

  const favoriteSlugs = await resolveFavoriteSlugs(supabase, favoriteIds).catch(
    () => new Set<string>(),
  );
  // 고른 급수의 문제지가 있는 과목만. 즐겨찾는 과목을 앞으로 — 공시생은 보통 5과목만
  // 도는데 목록에는 수십 과목이 있어, 즐겨찾기가 곧 "내 과목 목록"이다.
  const subjects = index.subjects
    .map((s) => ({ ...s, count: level ? (s.byTier[level] ?? 0) : s.count }))
    .filter((s) => s.count > 0)
    .sort((a, b) => {
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
          급수와 과목을 고르면 그 과목 기출을 국가직·지방직·경찰·소방 구분 없이 섞어서
          풀어요. 연도·문항 수는 다음 화면에서 고르고, 결과는 오답노트에 날짜별로 남아요.
        </p>
      </div>

      {tiers.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">급수</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/mix"
              aria-current={level === null ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                level === null
                  ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              전체
            </Link>
            {tiers.map((t) => {
              const active = level === t.key;
              return (
                <Link
                  key={t.key}
                  href={`/mix?level=${encodeURIComponent(t.key)}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    active
                      ? t.key === MIX_NO_LEVEL
                        ? "bg-zinc-500 text-white"
                        : levelColor(t.key)
                      : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  {tierLabel(t)}
                </Link>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
            {selectedTier
              ? `${tierLabel(selectedTier)} 문제지만 나오게 골랐어요. 과목을 고르면 이 급수가 그대로 이어져요.`
              : tiers.some((t) => t.approx)
                ? "경찰·소방·해경·계리직처럼 급수가 없는 시험은 난도가 비슷한 급수에 묶여 있어요(간부후보는 7급 수준, 승진시험은 기타)."
                : "급수를 고르면 과목 시작 화면까지 그대로 이어져요."}
          </p>
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            최근 섞어풀기
          </h2>
          <div className="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-700/70 dark:border-zinc-700">
            {recent
              .filter((s) => s.subjectSlug && s.subjectName)
              .map((s) => (
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

        {/* 목록·검색은 클라이언트에서. 과목이 수십 개라 스크롤로 찾게 두지 않고,
            사이트 검색과 같은 규칙(초성 포함)으로 그 자리에서 걸러낸다. */}
        <MixSubjectPicker
          subjects={subjects.map((s) => ({
            slug: s.slug,
            name: s.name,
            count: s.count,
            favorite: favoriteSlugs.has(s.slug),
          }))}
          level={level}
          unit={index.unit}
          emptyMessage={
            level
              ? "이 급수에는 아직 기출문제가 없어요. 다른 급수를 골라보세요."
              : "아직 풀 수 있는 과목이 없어요."
          }
        />
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
