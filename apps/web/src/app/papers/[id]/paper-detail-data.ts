import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { resolvePaperId } from "@/lib/paper-slug-map";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { compareLevels } from "@/lib/level-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { countPaperExplanations } from "@/lib/wrong-notes";
import {
  collapseDuplicatePapers,
  collidingPaperIds,
  fetchPaperIdentitySignals,
  paperDedupKey,
  representativePaperIds,
} from "@/lib/dedup-papers";
import { fetchAllPages } from "@/lib/fetch-paged";
import { paperHref } from "@/lib/paper-href";
import type {
  MyCbtRecordItem,
  RoundAverage,
} from "@/components/my-cbt-record-modal";
import { getPaperSlug } from "@gongmoa/core";
import type { AnswerKey, Comment, ExamPaper } from "@gongmoa/core";

const RELATED_PAPERS_LIMIT = 12;
// 중복(직류만 다른 같은 시험지)을 합치면 개수가 줄기 때문에, 12개를 채우려면
// 합치기 전에 넉넉히 받아둬야 대표가 잘려나가지 않는다. 상세페이지는 자주 열리는
// 경로라 과목 전체를 받지는 않고, 미리보기에 충분한 만큼만 여유 있게 받는다.
const RELATED_FETCH_LIMIT = RELATED_PAPERS_LIMIT * 5;

// generateMetadata와 페이지 본문이 같은 주소로 중복 조회하지 않도록 캐싱.
//
// 인자는 주소 조각이다 — 새 주소(slug, "2021-국회직-8급-국어")도 옛 주소(UUID)도
// 받는다. 옛 주소는 색인·북마크·외부 링크에 남아 있어서 계속 열려야 하고,
// 새 주소로의 301은 proxy.ts가 렌더링 전에 보낸다.
export const getPaper = cache(async (param: string) => {
  const id = await resolvePaperId(param);
  if (!id) return null;
  return fetchPaperById(id);
});

/**
 * 문제지 한 장. **쿠키 클라이언트로 읽지 않는다** — 문제지는 로그인 여부와 무관하게
 * 모두에게 같은 공개 자료이고(RLS: `public read exam_papers`), 여기서 cookies() 를
 * 건드리는 순간 이 값을 쓰는 generateMetadata 까지 동적이 되기 때문이다.
 *
 * **왜 그게 SEO 문제인가:** generateMetadata 가 동적이면 <title>·description·
 * canonical 이 정적 셸의 <head> 에 실리지 못하고 렌더링 뒤에 스트리밍으로 딸려온다.
 * Next 는 이때 UA 를 보고 갈라지는데(htmlLimitedBots), Googlebot 은 "JS 를 실행하니
 * 스트리밍해도 된다"는 쪽으로 분류돼 **HTML 에 제목도 정본도 없는 응답**을 받는다
 * (실측: Googlebot UA 로 받으면 <title>·canonical 이 0개, 같은 주소를 Yeti·Bingbot·
 * 브라우저로 받으면 정상). 렌더링 대기열에 들어간 페이지는 색인이 늦거나 밀리고,
 * 문제지 3,800장이 "발견됨 - 현재 색인되지 않음"에 쌓인 이유가 이것이다.
 *
 * 공개 클라이언트로 읽고 캐시에 담으면 metadata 가 셸에 함께 프리렌더돼
 * (시험 페이지 /exams/[exam] 이 이미 이렇게 나간다) 모든 크롤러가 첫 HTML 에서
 * 제목과 정본을 본다. 조회 자체도 문제지당 한 번으로 줄어든다.
 */
async function fetchPaperById(id: string): Promise<ExamPaper | null> {
  "use cache";
  // 업로드된 문제지는 내용이 거의 바뀌지 않는다. 관리자가 제목·직류를 고치면
  // 홈 데이터와 같은 태그를 달아 revalidateTag("home-data") 에 묻어간다
  // (주소 표 getSlugMap 도 같은 태그로 함께 갱신된다).
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const { data } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .single();
  return data as ExamPaper | null;
}

/**
 * 최신 시험부터 `limit` 장의 문제지 주소(slug). page.tsx 의 generateStaticParams 가
 * 빌드에서 미리 만들 주소를 고르는 데 쓴다.
 *
 * 홈·사이트맵과 같은 목록(fetchAllExamPapers)을 쓴다 — 중복 시험지를 대표 한 장으로
 * 합친 뒤라 주소 집합이 사이트맵과 같고, 최신 시험이 앞에 온다. 빌드 시점에 도는
 * 함수라 쿠키 없는 공개 클라이언트여야 하고, 'use cache' 가 있어야 프리렌더 중의
 * 조회로 취급된다(홈 데이터와 같은 태그·수명).
 */
export async function getNewestPaperSlugs(limit: number): Promise<string[]> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const { papers } = await fetchAllExamPapers(createPublicClient());
  return papers
    .slice(0, limit)
    .map((p) => getPaperSlug(p.title, p.round, p.track));
}

type RepresentativeSourceRow = {
  id: string;
  title: string;
  level: string | null;
  track: string | null;
  year: number;
  round: number;
  subject_id: string;
  exam_type_id: string;
  created_at: string;
};

/**
 * 중복 그룹(직류만 다른 같은 시험지)에서 대표가 아닌 문제지 id → 대표 문제지의 slug.
 * 대표 자신과 단독 문제지는 표에 없다(대부분이 그렇다 — 표는 작다).
 *
 * 목록·사이트맵·RSS 는 대표 한 장만 싣지만 비대표 문제지 주소도 200 으로 열리고
 * 자기 자신을 canonical 로 선언하고 있었다. 같은 내용의 두 주소가 각자 정본을 주장하니
 * Google 이 하나를 골랐다(서치콘솔 "중복 페이지, Google 에서 사용자와 다른 표준을
 * 선택함" 49건). 비대표의 canonical 을 대표로 돌려 그 판단을 우리가 대신 한다.
 * 대표 선정은 목록 통합과 같은 규칙(representativePaperIds)이라 사이트맵의 주소와
 * 어긋나지 않는다. exam_papers 행은 건드리지 않는다(docs/agents/dedup-papers.md).
 */
async function getRepresentativeSlugById(): Promise<Record<string, string>> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const rows = await fetchAllPages<RepresentativeSourceRow>(
    (from, to) =>
      supabase
        .from("exam_papers")
        .select("id, title, level, track, year, round, subject_id, exam_type_id, created_at")
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: RepresentativeSourceRow[] | null;
        error: { message: string } | null;
      }>,
    "대표 문제지 표",
  );
  const signals = await fetchPaperIdentitySignals(supabase, collidingPaperIds(rows));
  const { repByPaperId } = representativePaperIds(rows, signals);

  const byId = new Map(rows.map((r) => [r.id, r]));
  // 'use cache' 는 반환값을 직렬화해 보관하므로 Map 대신 평범한 객체로 돌려준다.
  const out: Record<string, string> = {};
  for (const [id, repId] of repByPaperId) {
    if (id === repId) continue;
    const rep = byId.get(repId);
    if (rep) out[id] = getPaperSlug(rep.title, rep.round, rep.track);
  }
  return out;
}

/** 이 문제지의 정본 주소. 중복 그룹의 비대표면 대표의 주소, 아니면 자기 주소. */
export async function getCanonicalPaperHref(paper: ExamPaper): Promise<string> {
  const repSlug = (await getRepresentativeSlugById())[paper.id];
  return repSlug ? `/papers/${encodeURIComponent(repSlug)}` : paperHref(paper);
}

// 상세페이지 상단(제목·버튼·평점·댓글)에 필요한 데이터만 모아서 돌려준다.
// 하단 "같은 과목 목록"은 getRelatedPapersData로 분리해 Suspense로 스트리밍한다 —
// 그 섹션은 목록 조회 뒤에 dedup 신호·북마크 확인이 직렬로 이어져 왕복이 많아,
// 페이지 전체 첫 표시를 그만큼 잡아먹고 있었다. 어떤 쿼리를 어떻게 묶어서
// 날리는지(왕복 횟수)는 전부 이 파일에서 결정하고, 페이지 컴포넌트는 받은 값을
// 그리기만 한다.
export async function getPaperDetailData(paper: ExamPaper) {
  const supabase = await createClient();

  // 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — 아래의 개인화 쿼리
  // (북마크/내 평가/내 응시 기록)는 전부 RLS가 본인 것만 돌려주므로 인증 서버
  // 왕복(getUser) 없이 곧바로 나머지 조회 전체를 한 번에 병렬로 날릴 수 있다
  // (예전에는 getUser 결과를 기다리는 단계들이 줄줄이 이어져 왕복이 5~6번이었다).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const loggedIn = !!userId;

  // 정답표는 (시험종류+연도+급수+회차)당 1장이 원칙이고 track은 대개 null이다 —
  // 법원직처럼 정답표 한 장에 전 직류가 실려 있기 때문. track 붙은 문제지(서기보 등)
  // 에서 track 일치만 요구하면 정답표를 못 찾아 "정답 열기/다운로드" 버튼이 아예
  // 사라진다(2026-07-17 실측, docs/agents/answer-keys-tracks.md의 세 번째 track 버그).
  // 그래서 track 조건 없이 다 받아 exact track 정답표(근로감독 등 특수모집 전용)를
  // 우선하고, 없으면 공용(track null) 정답표로 폴백한다.
  let answerKeyQuery = supabase
    .from("answer_keys")
    .select("*")
    .eq("exam_type_id", paper.exam_type_id)
    .eq("year", paper.year)
    .eq("round", paper.round);
  answerKeyQuery = paper.level
    ? answerKeyQuery.eq("level", paper.level)
    : answerKeyQuery.is("level", null);

  const [
    { data: comments },
    { data: ratings },
    { data: answerKeyRows },
    { data: hasCbtAnswers },
    { data: roundAverageRows },
    { data: isAdminData },
    { data: bookmarkData },
    { data: myRatingData },
    { data: myCbtAttemptRows },
    explanationCount,
  ] = await Promise.all([
    supabase
      .from("comments")
      .select("id, paper_id, user_id, nickname, content, created_at, updated_at, parent_id")
      .eq("paper_id", paper.id)
      .order("created_at", { ascending: true }),
    supabase.from("difficulty_ratings").select("score").eq("paper_id", paper.id),
    answerKeyQuery,
    supabase.rpc("has_cbt_answers", { target_paper_id: paper.id }),
    supabase.rpc("avg_score_by_round", { target_paper_id: paper.id }),
    loggedIn ? supabase.rpc("is_admin") : Promise.resolve({ data: false }),
    userId
      ? supabase
          .from("bookmarks")
          .select("id")
          .eq("user_id", userId)
          .eq("paper_id", paper.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("difficulty_ratings")
          .select("score")
          .eq("paper_id", paper.id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("cbt_attempts")
          .select("id, score, total_questions, created_at")
          .eq("paper_id", paper.id)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
    // "해설 열기" 버튼 노출 판단용. question_explanations는 관리자 전용 RLS라
    // service role로 개수만 센다 (해설 내용은 /papers/[id]/explanations에서 렌더링).
    countPaperExplanations(paper.id),
  ]);

  // 전 문항 해설이 준비된 문제지에만 상세페이지 "해설 열기"를 열어준다 —
  // 반쪽짜리 해설집을 "지원"으로 표시하지 않기 위한 기준.
  const hasFullExplanations =
    !!paper.question_count && explanationCount >= paper.question_count;

  // 표본 3명 미만인 회차는 DB 함수에서 이미 제외하고 내려주므로 여기서는 그대로 매핑만 한다.
  const roundAverages: RoundAverage[] = (
    (roundAverageRows ?? []) as { round: number; avg_pct: number; attempt_count: number }[]
  ).map((r) => ({
    round: r.round,
    avgPct: r.avg_pct,
    attemptCount: r.attempt_count,
  }));

  const scores = (ratings ?? []).map((r) => r.score as number);
  const averageScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const myCbtAttempts = (myCbtAttemptRows ?? []) as {
    id: string;
    score: number;
    total_questions: number;
    created_at: string;
  }[];
  // 이 페이지는 문제지 하나만 다루므로, 오래된 순으로 이미 받아온 목록에 순서대로
  // 회차 번호(1회독, 2회독...)를 매기면 된다.
  const myCbtRecordItems: MyCbtRecordItem[] = myCbtAttempts.map((a, i) => ({
    id: a.id,
    round: i + 1,
    score: a.score,
    totalQuestions: a.total_questions,
    createdAt: a.created_at,
  }));

  // 정답표 원본 URL도 여기서 만들지 않는다. "열기"·"다운로드" 둘 다 /download/answer
  // 라우트를 거쳐야 로그인 검사·카운트가 붙는다(app/download/answer/[id]/route.ts) —
  // 화면에 Storage 공개 URL을 그대로 내려주면 비로그인도 그 주소로 바로 받아갈 수 있다.
  //
  // exact track 정답표 우선, 없으면 공용(track null) 정답표.
  const answerKeys = (answerKeyRows ?? []) as AnswerKey[];
  const typedAnswerKey =
    answerKeys.find((k) => k.track != null && k.track === paper.track) ??
    answerKeys.find((k) => k.track == null) ??
    null;

  return {
    userId,
    loggedIn,
    isAdmin: isAdminData === true,
    comments: (comments ?? []) as Comment[],
    averageScore,
    voteCount: scores.length,
    myScore: myRatingData ? (myRatingData.score as number) : null,
    isBookmarked: !!bookmarkData,
    hasCbtAnswers,
    hasFullExplanations,
    roundAverages,
    myCbtRecordItems,
    answerKey: typedAnswerKey,
  };
}

// 하단 "같은 과목 기출문제 목록" 섹션 전용 데이터. 목록 조회 → dedup 신호 조회 →
// 카드용 북마크/바로풀기 확인이 데이터 의존 때문에 직렬로 이어질 수밖에 없어,
// 상단 데이터(getPaperDetailData)와 분리해 Suspense 뒤에서 따로 스트리밍한다.
export async function getRelatedPapersData(
  paper: ExamPaper,
  level?: string,
  examTypeIds?: Set<string>,
) {
  if (!paper.subject_id) return null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // "같은 과목 목록"은 미리보기 성격이라 최근 RELATED_PAPERS_LIMIT개만 보여주고,
  // 전체 목록은 /subjects/[slug] 페이지(페이지네이션 적용됨)로 넘긴다.
  let subjectPapersQuery = supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("subject_id", paper.subject_id);
  if (level) {
    subjectPapersQuery = subjectPapersQuery.eq("level", level);
  }
  if (examTypeIds && examTypeIds.size > 0) {
    subjectPapersQuery = subjectPapersQuery.in("exam_type_id", [...examTypeIds]);
  }

  const [
    { data: subjectPapers },
    { data: subjectLevelRows },
    { data: subjectExamTypeRows },
    myRoundCounts,
  ] = await Promise.all([
    subjectPapersQuery
      .order("year", { ascending: false })
      .order("round", { ascending: false })
      .limit(RELATED_FETCH_LIMIT),
    // 급수 탭은 이 과목에 존재하는 급수 종류만 필요하므로 level 컬럼만 가볍게 조회한다.
    supabase.from("exam_papers").select("level").eq("subject_id", paper.subject_id),
    // 직렬 탭도 급수 탭과 같은 이유로, 이 과목에 실제 존재하는 직렬만 가볍게 조회한다.
    supabase
      .from("exam_papers")
      .select("exam_type_id, exam_types(id, name, display_order)")
      .eq("subject_id", paper.subject_id),
    // 카드에 회독 배지를 달아주기 위한 문제지별 응시 횟수.
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
  ]);

  // 급수 탭에는 이 과목에 실제로 존재하는 급수만 보여준다.
  const availableLevels = [
    ...new Set(
      (subjectLevelRows ?? [])
        .map((r) => r.level)
        .filter((l): l is string => !!l),
    ),
  ].sort(compareLevels);

  // 직렬 탭에는 이 과목에 실제로 존재하는 직렬만 보여준다.
  const examTypeById = new Map<
    string,
    { id: string; name: string; display_order: number }
  >();
  for (const row of subjectExamTypeRows ?? []) {
    const et = row.exam_types as unknown as
      | { id: string; name: string; display_order: number }
      | null;
    if (et) examTypeById.set(et.id, et);
  }
  const availableExamTypes = [...examTypeById.values()].sort(
    (a, b) => a.display_order - b.display_order,
  );

  // 홈·과목 목록과 똑같이, 직류만 다른 데다 정답까지 같은 시험지를 하나로 합쳐
  // 대표만 남긴다.
  const relatedRaw = (subjectPapers as ExamPaper[] | null) ?? [];
  const relatedSignals = await fetchPaperIdentitySignals(
    supabase,
    collidingPaperIds(relatedRaw),
  );
  const relatedDeduped = collapseDuplicatePapers(relatedRaw, relatedSignals);
  // 지금 보고 있는 문제지가 중복으로 합쳐져 목록에서 빠졌다면, 그 그룹 대표 자리에
  // 현재 문제지를 대신 넣어 "현재 보는 중" 카드가 그대로 보이게 한다.
  if (!relatedDeduped.some((p) => p.id === paper.id)) {
    const currentKey = paperDedupKey(paper);
    const idx = relatedDeduped.findIndex((p) => paperDedupKey(p) === currentKey);
    if (idx !== -1) relatedDeduped[idx] = paper;
  }
  const relatedPapers = relatedDeduped.slice(0, RELATED_PAPERS_LIMIT);

  // 카드에 북마크/바로풀기를 달아주기 위한 배치 조회. 대상 id는 위 조회가 끝나야
  // 알 수 있어서 그 안에 묶지 못하고 여기서 한 번 더 병렬 조회한다(현재 보는
  // 문제지 자신은 카드에서 두 기능 다 안 쓰니 제외).
  const subjectPaperIds = relatedPapers
    .map((p) => p.id)
    .filter((pid) => pid !== paper.id);
  const [subjectBookmarkedIds, subjectCbtAvailability] = await Promise.all([
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, subjectPaperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, subjectPaperIds),
  ]);

  return {
    loggedIn: !!userId,
    subjectPapers: relatedPapers,
    availableLevels,
    availableExamTypes,
    myRoundCounts,
    subjectBookmarkedIds,
    subjectCbtAvailability,
  };
}
