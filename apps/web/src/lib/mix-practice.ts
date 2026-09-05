import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllPages } from "@/lib/fetch-paged";
import { fetchAllExamPapers } from "@/lib/all-papers";
import {
  collidingPaperIds,
  fetchPaperIdentitySignals,
  representativePaperIds,
} from "@/lib/dedup-papers";
import {
  fetchCorrectAnswers,
  fetchExplainedNumbers,
  fetchExplanations,
  fetchMemos,
  fetchQuestionMedia,
  fetchWrongNoteMarks,
  getSubjectBySlug,
} from "@/lib/wrong-notes";
import { createReviewSessionFromItems } from "@/lib/review-session";
import type { QuestionExplanationContent } from "@/components/explanation-body";
import {
  clampMixLimit,
  examLevelTier,
  filterMixCandidatesByLevel,
  filterMixCandidatesByYear,
  isApproxLevelTier,
  normalizeYearRange,
  getPaperDisplayTitle,
  applyExamTypeSubjectName,
  kstDayKey,
  labelMixSessions,
  mixCandidateKey,
  pickMixQuestions,
  MIX_MAX_LIMIT,
  MIX_NO_LEVEL,
  type MixCandidate,
  type MixYearRange,
  type Subject,
} from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 기출 섞어풀기 — 한 과목의 기출 전체(시행처 무관)에서 무작위로 뽑아 새 문제를 푼다.
//
// 오답 섞어풀기(review-session.ts)와 같은 테이블(review_sessions/items, scope='mix')과
// 같은 풀이·채점 경로를 쓴다. 다른 것은 **후보가 어디서 오는가**뿐이다 — 저쪽은 내
// 오답, 여기는 과목의 기출 코퍼스. 채점 결과는 똑같이 user_question_status 에 기록되므로
// 여기서 틀린 문항은 오답노트(문항 모아보기·복습 큐)에 그대로 합류하고, 세션 자체는
// 오답노트 과목 페이지에 "9월 5일 섞어풀기" 카드로 남는다.

export const MIX_SCOPE = "mix";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 조각난 조회를 몇 개씩 동시에 던진다. 출제 풀을 처음 만들 때(캐시가 빈 상태) 국어처럼
// 문제지가 수백 장인 과목은 조각이 수십 개가 되는데, 한 줄로 세워 기다리면 왕복 지연이
// 그대로 쌓여 서버리스 함수 제한 시간에 닿는다(2026-09-05 배포 직후 500 관측).
// 무료 티어 DB라 동시 요청을 무작정 늘리지는 않는다 — wrong-notes.ts 와 같은 값(8).
const POOL_CONCURRENCY = 8;

async function inParallel<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = POOL_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

type PoolPaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  level: string | null;
  track: string | null;
  title: string;
  created_at: string;
  exam_types: { name: string } | null;
};

export type MixLevelGroup = {
  // "9급"·"7급"… 또는 MIX_NO_LEVEL(어느 등급에도 안 묶인 문제지 — 승진시험 등).
  key: string;
  count: number;
  // 급수가 없어 환산된 문제지가 섞인 그룹. 화면이 "9급 수준"으로 이름을 바꿔 단다 —
  // 순경 준비생에게 "9급"은 자기 시험이 아니라는 신호라 그대로 두면 안 누른다.
  approx: boolean;
};

// (등급, 연도)별 문항 수. 급수와 연도를 함께 고르면 남는 문항이 몇 개인지 화면이
// 서버 왕복 없이 세려면 두 축을 교차한 표가 필요하다 — 등급 5종 × 연도 20년이면
// 100줄 남짓이라 후보 수천 개를 통째로 내려보내는 것보다 훨씬 가볍다.
export type MixCountCell = { level: string; year: number | null; count: number };

export type MixPool = {
  // 출제 가능한 (대표 문제지, 문항). 이미지가 있고, 정답이 등록돼 있고, voided 가 아닌 것.
  // level·conceptId 는 급수 필터와 개념 분산(pickMixQuestions)의 재료다.
  candidates: MixCandidate[];
  // 화면 안내용 통계. paperCount 는 중복 시험지를 합친 뒤의 수(과목 페이지와 같다).
  paperCount: number;
  examTypeNames: string[];
  // 등급별 출제 가능 문항 수와 라벨 정보. 시작 화면 급수 칩용.
  levelGroups: MixLevelGroup[];
  // (등급, 연도) 교차 문항 수. 화면이 두 필터를 함께 걸었을 때의 남는 수를 센다.
  cells: MixCountCell[];
  minYear: number | null;
  maxYear: number | null;
  // 실제 paper_id → 대표 paper_id. 사용자의 풀이 기록(실제 id 기준)을 후보 키(대표 id)에
  // 맞추는 데 쓴다. 'use cache' 가 결과를 직렬화하므로 Map 대신 객체.
  repByPaperId: Record<string, string>;
};

// 문항 id → 정본 개념 id. question_explanations 는 service_role 만 읽는다(정답 요약이
// 실려 있어서). 여기서는 concept_id 만 받고 본문은 건드리지 않는다.
async function fetchCanonicalConcepts(
  admin: ReturnType<typeof createAdminClient>,
  questionIds: string[],
): Promise<Map<string, string>> {
  const raw = new Map<string, string>();
  await inParallel(chunk(questionIds, 200), async (ids) => {
    const { data } = await admin
      .from("question_explanations")
      .select("question_id, concept_id")
      .in("question_id", ids)
      .not("concept_id", "is", null);
    for (const r of (data ?? []) as { question_id: string; concept_id: string | null }[]) {
      if (r.concept_id) raw.set(r.question_id, r.concept_id);
    }
  });
  if (raw.size === 0) return raw;

  // merged_into 를 끝까지 따라간다(보통 한 단계). 순환은 방어적으로 끊는다.
  const mergedInto = new Map<string, string | null>();
  await inParallel(chunk([...new Set(raw.values())], 200), async (ids) => {
    const { data } = await admin.from("concepts").select("id, merged_into").in("id", ids);
    for (const r of (data ?? []) as { id: string; merged_into: string | null }[]) {
      mergedInto.set(r.id, r.merged_into);
    }
  });
  const canonical = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 5; i++) {
      const next = mergedInto.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };
  const out = new Map<string, string>();
  for (const [qid, cid] of raw) out.set(qid, canonical(cid));
  return out;
}

// 과목 하나의 출제 풀. 문제지 수백 장 × 문항 수십 개를 훑는 조회라 요청마다 돌리지
// 않고 캐시한다 — 로그인 여부와 무관한 공개 자료(문항 이미지 존재 여부·정답 등록
// 여부)만 담고 정답 자체는 싣지 않는다. 새 문제지·정답이 올라오면 홈 데이터와 같은
// 태그로 함께 갱신되고, 그 전에도 한 시간이면 저절로 새로 만든다.
export async function getMixPool(subjectId: string): Promise<MixPool> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const papers = await fetchAllPages<PoolPaper>(
    (from, to) =>
      supabase
        .from("exam_papers")
        .select(
          "id, subject_id, exam_type_id, year, round, level, track, title, created_at, exam_types(name)",
        )
        .eq("subject_id", subjectId)
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: PoolPaper[] | null;
        error: { message: string } | null;
      }>,
    "섞어풀기 문제지",
  );
  const empty: MixPool = {
    candidates: [],
    paperCount: 0,
    examTypeNames: [],
    levelGroups: [],
    cells: [],
    minYear: null,
    maxYear: null,
    repByPaperId: {},
  };
  if (papers.length === 0) return empty;

  // 직류만 다른 같은 시험지는 하나로 접는다 — 안 접으면 같은 문항이 두 장에서 한 번씩
  // 뽑혀 한 세션에 두 번 나올 수 있다.
  const signals = await fetchPaperIdentitySignals(supabase, collidingPaperIds(papers));
  const { repByPaperId } = representativePaperIds(papers, signals);
  const repIds = [...new Set(papers.map((p) => repByPaperId.get(p.id) ?? p.id))];

  // 정답이 등록된 문제지만 채점할 수 있다. voided(전항정답·복수정답) 문항은 정답이
  // 없어 "맞다/틀리다"를 말할 수 없으므로 후보에서 뺀다(schema.sql 의 의도 그대로).
  const admin = createAdminClient();
  const voidedByPaper = new Map<string, Set<number>>();
  await inParallel(chunk(repIds, 200), async (ids) => {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, voided_questions")
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; voided_questions: number[] | null }[]) {
      voidedByPaper.set(row.paper_id, new Set(row.voided_questions ?? []));
    }
  });
  const answeredRepIds = repIds.filter((id) => voidedByPaper.has(id));
  if (answeredRepIds.length === 0) return { ...empty, paperCount: repIds.length };

  // 이미지가 잘려 있는 문항만(문제를 보여줄 수 없으면 못 푼다). question_images 를
  // inner 조인해 이미지가 하나라도 있는 문항만 받는다 — 이미지 경로 자체는 세션을
  // 그릴 때 fetchQuestionMedia 가 뽑힌 문항에 대해서만 다시 받는다.
  // 문제지별 난도 등급. 급수가 있으면 그대로, 없으면 시행처·직류로 환산한다.
  const tierByPaper = new Map(
    papers.map((p) => {
      const input = {
        level: p.level,
        examTypeName: p.exam_types?.name ?? null,
        track: p.track,
      };
      return [p.id, { tier: examLevelTier(input), approx: isApproxLevelTier(input) }];
    }),
  );
  type QRow = { id: string; paper_id: string; question_number: number };
  const rowsById = new Map<string, QRow>();
  await inParallel(chunk(answeredRepIds, 25), async (ids) => {
    const rows = await fetchAllPages<QRow>(
      (from, to) =>
        supabase
          .from("questions")
          .select("id, paper_id, question_number, question_images!inner(order_index)")
          .in("paper_id", ids)
          .order("paper_id", { ascending: true })
          .order("question_number", { ascending: true })
          .range(from, to) as unknown as Promise<{
          data: QRow[] | null;
          error: { message: string } | null;
        }>,
      "섞어풀기 문항",
    );
    for (const r of rows) {
      if (voidedByPaper.get(r.paper_id)?.has(r.question_number)) continue;
      rowsById.set(r.id, r);
    }
  });

  // 문항별 정본 개념. 해설 배치가 붙인 concept_id 를 읽고, 합쳐진 개념(merged_into)은
  // 합쳐진 쪽으로 되짚는다 — 같은 개념이 옛 id 와 새 id 로 갈라져 있으면 분산이 안 된다.
  // 해설이 없는 문항은 null 로 남는다(개념 분산에서 상한을 받지 않는다).
  const conceptByQuestionId = await fetchCanonicalConcepts(admin, [...rowsById.keys()]);

  const yearByPaper = new Map(papers.map((p) => [p.id, p.year ?? null]));
  const candidates: MixCandidate[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, { count: number; approx: boolean }>();
  const cellCounts = new Map<string, number>();
  for (const r of rowsById.values()) {
    const meta = tierByPaper.get(r.paper_id);
    const c: MixCandidate = {
      paperId: r.paper_id,
      questionNumber: r.question_number,
      level: meta?.tier ?? null,
      year: yearByPaper.get(r.paper_id) ?? null,
      conceptId: conceptByQuestionId.get(r.id) ?? null,
    };
    const key = mixCandidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
    const gk = c.level ?? MIX_NO_LEVEL;
    const g = groups.get(gk) ?? { count: 0, approx: false };
    g.count++;
    // 환산된 문제지가 하나라도 섞이면 그룹 전체를 "수준"으로 부른다.
    if (meta?.approx) g.approx = true;
    groups.set(gk, g);
    const ck = `${gk}|${c.year ?? ""}`;
    cellCounts.set(ck, (cellCounts.get(ck) ?? 0) + 1);
  }
  const levelGroups: MixLevelGroup[] = [...groups.entries()].map(([key, g]) => ({
    key,
    count: g.count,
    approx: g.approx,
  }));
  const cells: MixCountCell[] = [...cellCounts.entries()].map(([k, count]) => {
    const idx = k.lastIndexOf("|");
    const year = k.slice(idx + 1);
    return { level: k.slice(0, idx), year: year ? Number(year) : null, count };
  });

  const examTypeNames = [
    ...new Set(papers.map((p) => p.exam_types?.name).filter((n): n is string => !!n)),
  ];
  const years = papers.map((p) => p.year);

  return {
    candidates,
    paperCount: repIds.length,
    examTypeNames,
    levelGroups,
    cells,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    repByPaperId: Object.fromEntries(repByPaperId),
  };
}

// ── 섞어풀기 허브(/mix)의 급수 탭·과목 목록 ────────────────────────────────
//
// 허브에서 급수를 먼저 고르면 과목마다 다시 고를 필요가 없다. 그러려면 "어느 과목에
// 어느 등급 문항이 몇 개 있는지"를 과목 수십 개 분량으로 알아야 하는데, 과목별 출제
// 풀(getMixPool)을 전부 돌리면 문항 단위 조회가 과목 수만큼 붙는다. 그래서 목록 조회
// 한 번(fetchAllExamPapers — 홈·과목 색인이 쓰는 것과 같은 조회, 중복 시험지도 이미
// 합쳐져 있다) + 집계 함수 한 번(mix_playable_question_counts)으로 끝낸다.
//
// 단위는 시작 화면과 같은 **문항 수**다. 집계 함수가 아직 없는 환경에서는 문제지 수로
// 떨어지고(unit), 화면이 라벨을 "장"으로 바꿔 단다.

export type MixHubTier = { key: string; approx: boolean; count: number };

export type MixHubSubject = {
  slug: string;
  name: string;
  count: number;
  // 등급별 수(급수 탭으로 걸렀을 때 카드에 보일 수).
  byTier: Record<string, number>;
};

// 허브 숫자의 단위. 집계 함수(mix_playable_question_counts)가 있으면 "문항"이고,
// 아직 없는 환경(마이그레이션 전)에서는 문제지 수로 떨어져 "장"이 된다.
export type MixHubUnit = "question" | "paper";

export type MixHubIndex = {
  tiers: MixHubTier[];
  subjects: MixHubSubject[];
  unit: MixHubUnit;
};

// 문제지별 "출제 가능 문항 수". 집계는 DB 함수 한 번으로 받는다 — 과목마다 출제 풀을
// 돌리면 문항 조회가 과목 수만큼 붙어 허브가 통째로 느려진다. RPC 도 PostgREST 기본
// 상한(1000행)에 걸리므로 range 로 이어받는다.
//
// 함수가 아직 없는 환경(마이그레이션 전)에서는 null 을 돌려주고, 호출부가 문제지 수로
// 떨어진다 — 전국 오답률 배지(fetchPaperWrongRates)와 같은 처리다.
async function fetchPlayableQuestionCounts(): Promise<Record<string, number> | null> {
  const supabase = createPublicClient();
  const out: Record<string, number> = {};
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .rpc("mix_playable_question_counts")
      .range(from, from + SIZE - 1);
    if (error) {
      console.error("mix_playable_question_counts 실패", error.message);
      return null;
    }
    const rows = (data ?? []) as { paper_id: string; question_count: number }[];
    for (const r of rows) out[r.paper_id] = r.question_count;
    if (rows.length < SIZE) break;
    from += SIZE;
  }
  return out;
}

export async function getMixHubIndex(): Promise<MixHubIndex> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const [{ papers, examTypes }, { data: subjectRows }, playable] = await Promise.all([
    fetchAllExamPapers(supabase),
    supabase.from("subjects").select("id, slug, name"),
    fetchPlayableQuestionCounts(),
  ]);
  // 문항 수를 못 받았으면(함수 미적용) 문제지 수로 센다 — 화면이 단위를 따라 바꾼다.
  const unit: MixHubUnit = playable ? "question" : "paper";
  const countOf = (paperId: string) => (playable ? (playable[paperId] ?? 0) : 1);
  const examTypeName = new Map(examTypes.map((t) => [t.id, t.name]));
  const subjects = new Map(
    ((subjectRows ?? []) as { id: string; slug: string; name: string }[]).map((r) => [
      r.id,
      r,
    ]),
  );

  const tierStats = new Map<string, { approx: boolean; count: number }>();
  const bySubject = new Map<string, MixHubSubject>();
  for (const p of papers) {
    const subject = subjects.get(p.subject_id);
    if (!subject) continue;
    // 풀 수 있는 문항이 하나도 없는 문제지(정답 미등록·크롭 전)는 세지 않는다 —
    // 세면 "기출 40문항"이라고 해 놓고 시작 화면이 "준비 중"이 된다.
    const count = countOf(p.id);
    if (count === 0) continue;
    const input = {
      level: p.level,
      examTypeName: examTypeName.get(p.exam_type_id) ?? null,
      track: p.track,
    };
    const key = examLevelTier(input) ?? MIX_NO_LEVEL;

    const t = tierStats.get(key) ?? { approx: false, count: 0 };
    t.count += count;
    // 환산된 문제지가 하나라도 있으면 그 등급은 "9급 수준"으로 부른다.
    if (isApproxLevelTier(input)) t.approx = true;
    tierStats.set(key, t);

    const entry =
      bySubject.get(subject.id) ??
      ({ slug: subject.slug, name: subject.name, count: 0, byTier: {} } as MixHubSubject);
    entry.count += count;
    entry.byTier[key] = (entry.byTier[key] ?? 0) + count;
    bySubject.set(subject.id, entry);
  }

  return {
    tiers: [...tierStats.entries()].map(([key, t]) => ({
      key,
      approx: t.approx,
      count: t.count,
    })),
    subjects: [...bySubject.values()],
    unit,
  };
}

export type MixOverview = {
  subject: Subject;
  questionCount: number;
  paperCount: number;
  examTypeNames: string[];
  // 등급별 출제 가능 문항 수·라벨 정보.
  levelGroups: MixLevelGroup[];
  // (등급, 연도) 교차 문항 수 — 화면이 급수·연도를 함께 걸었을 때의 남는 수를 센다.
  cells: MixCountCell[];
  minYear: number | null;
  maxYear: number | null;
};

// 시작 화면용 요약. 로그인과 무관한 공개 통계라 사용자 클라이언트가 필요 없고,
// generateMetadata 와 본문이 같은 요청에서 두 번 부르므로 통째로 캐시한다.
export async function getMixOverview(slug: string): Promise<MixOverview | null> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const subject = await getSubjectBySlug(createPublicClient(), slug);
  if (!subject) return null;
  const pool = await getMixPool(subject.id);
  return {
    subject,
    questionCount: pool.candidates.length,
    paperCount: pool.paperCount,
    examTypeNames: pool.examTypeNames,
    levelGroups: pool.levelGroups,
    cells: pool.cells,
    minYear: pool.minYear,
    maxYear: pool.maxYear,
  };
}

// 이 사용자가 어디서든(CBT·복습·섞어풀기) 한 번이라도 채점받은 문항을 대표 id 키로
// 모은다. user_question_status 는 select-own RLS 라 사용자 클라이언트로 읽으면 본인
// 행만 온다. 회독이 쌓인 계정은 수천 행이 될 수 있어 1000 씩 이어받는다.
async function fetchSeenKeys(
  supabase: Supabase,
  userId: string,
  repByPaperId: Record<string, string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number")
      .eq("user_id", userId)
      .range(from, from + SIZE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as { paper_id: string; question_number: number }[]) {
      const rep = repByPaperId[r.paper_id] ?? r.paper_id;
      out.add(`${rep}#${r.question_number}`);
    }
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return out;
}

export type CreateMixSessionResult = {
  sessionId?: string;
  error?: string;
  // 뽑힌 문항 중 처음 보는 문항 수. 전부 새 문항이면 total 과 같다.
  unseenCount?: number;
  // 새 문항만으로 정원을 못 채워 푼 문항이 섞였다(= 이 과목 기출을 한 바퀴 돌았다).
  coveredAll?: boolean;
};

// 기출 섞어풀기 세션 생성. 세션·문항 저장은 오답 섞어풀기와 같은 함수를 쓴다 —
// 뽑은 순서(문제지 라운드로빈 + 섞기)를 그대로 쓰므로 keepOrder.
export async function createMixSessionForUser(
  supabase: Supabase,
  userId: string,
  // levels: 급수 필터(빈 배열 = 전체). 풀에 실제로 있는 급수 키만 받아들인다.
  // year: 연도 범위(둘 다 null 이면 전체). 자료가 있는 구간 안으로 정리해서 쓴다.
  input: {
    subjectSlug: string;
    limit?: number;
    levels?: string[];
    year?: Partial<MixYearRange> | null;
  },
): Promise<CreateMixSessionResult> {
  const subject = await getSubjectBySlug(supabase, input.subjectSlug);
  if (!subject) return { error: "과목을 찾을 수 없어요." };

  const pool = await getMixPool(subject.id);
  if (pool.candidates.length === 0) {
    return {
      error:
        "이 과목은 아직 섞어풀기를 준비 중이에요. 문항 이미지와 정답이 등록된 문제지가 생기면 열려요.",
    };
  }

  const known = new Set(pool.levelGroups.map((g) => g.key));
  const levels = (input.levels ?? []).filter((l) => known.has(l));
  const year = normalizeYearRange(input.year, { min: pool.minYear, max: pool.maxYear });
  const candidates = filterMixCandidatesByYear(
    filterMixCandidatesByLevel(pool.candidates, levels),
    year,
  );
  if (candidates.length === 0) {
    const narrowed = [levels.length > 0 ? "급수" : null, year.from != null || year.to != null ? "연도" : null]
      .filter(Boolean)
      .join("·");
    return {
      error: narrowed
        ? `고른 ${narrowed} 범위에는 아직 풀 수 있는 문항이 없어요. 범위를 넓혀보세요.`
        : "출제할 문항이 없어요.",
    };
  }

  const limit = clampMixLimit(input.limit);
  const seen = await fetchSeenKeys(supabase, userId, pool.repByPaperId);
  const { picked, unseenCount, coveredAll } = pickMixQuestions(candidates, limit, seen);
  if (picked.length === 0) return { error: "출제할 문항이 없어요." };

  const res = await createReviewSessionFromItems(supabase, userId, picked, picked.length, {
    keepOrder: true,
    scope: MIX_SCOPE,
    subjectId: subject.id,
    maxLimit: MIX_MAX_LIMIT,
  });
  if (res.error || !res.sessionId) return { error: res.error ?? "세션 생성에 실패했어요." };
  return { sessionId: res.sessionId, unseenCount, coveredAll };
}

// ── 오답노트 기록 ─────────────────────────────────────────────────────────────

export type MixSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  score: number;
  total: number;
  // 이 세션에서 틀린 문항 수와 그중 지금은 극복한(가장 최근 채점에서 맞힌) 수.
  wrongCount: number;
  resolvedCount: number;
};

type SessionRow = { id: string; created_at: string; score: number | null; total_questions: number };

async function fetchSubmittedMixSessions(
  userId: string,
  subjectId: string,
): Promise<SessionRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_sessions")
    .select("id, created_at, score, total_questions")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .eq("scope", MIX_SCOPE)
    .not("submitted_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as SessionRow[];
}

// 극복 여부는 user_question_status(모든 채점 경로 통합)의 가장 최근 결과로 본다.
// 세션 문항은 dedup 대표 id 로 저장돼 있고 상태 행은 실제 응시 id 에 있을 수 있어,
// 대표로 접힌 형제 문제지의 행도 함께 본다(status-targets.ts 와 같은 문제).
async function fetchResolvedKeys(
  supabase: Supabase,
  userId: string,
  items: { paperId: string; questionNumber: number }[],
  repByPaperId: Record<string, string>,
): Promise<{ resolved: Set<string>; wrongCount: Map<string, number> }> {
  const resolved = new Set<string>();
  const wrongCount = new Map<string, number>();
  if (items.length === 0) return { resolved, wrongCount };
  const wantedReps = new Set(items.map((it) => it.paperId));
  const realIds = new Set<string>(wantedReps);
  for (const [real, rep] of Object.entries(repByPaperId)) {
    if (wantedReps.has(rep)) realIds.add(real);
  }
  const latest = new Map<string, { correct: boolean; at: string }>();
  await inParallel(chunk([...realIds], 200), async (ids) => {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at, wrong_count")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      last_is_correct: boolean;
      last_answered_at: string;
      wrong_count: number | null;
    }[]) {
      const key = `${repByPaperId[r.paper_id] ?? r.paper_id}#${r.question_number}`;
      wrongCount.set(key, Math.max(wrongCount.get(key) ?? 0, r.wrong_count ?? 0));
      const ex = latest.get(key);
      if (!ex || r.last_answered_at > ex.at) {
        latest.set(key, { correct: r.last_is_correct, at: r.last_answered_at });
      }
    }
  });
  for (const [key, v] of latest) if (v.correct) resolved.add(key);
  return { resolved, wrongCount };
}

// 과목 오답노트 "문제지별" 탭에 붙는 섞어풀기 기록 카드 목록(최신순).
export async function listMixSessions(
  supabase: Supabase,
  userId: string,
  subjectId: string,
): Promise<MixSessionSummary[]> {
  const sessions = await fetchSubmittedMixSessions(userId, subjectId);
  if (sessions.length === 0) return [];

  const admin = createAdminClient();
  type ItemRow = { session_id: string; paper_id: string; question_number: number };
  const wrongBySession = new Map<string, ItemRow[]>();
  await inParallel(chunk(sessions.map((s) => s.id), 50), async (ids) => {
    const { data } = await admin
      .from("review_session_items")
      .select("session_id, paper_id, question_number")
      .in("session_id", ids)
      .eq("is_correct", false);
    for (const r of (data ?? []) as ItemRow[]) {
      const list = wrongBySession.get(r.session_id) ?? [];
      list.push(r);
      wrongBySession.set(r.session_id, list);
    }
  });

  const pool = await getMixPool(subjectId);
  const allWrong = [...wrongBySession.values()].flat();
  const { resolved } = await fetchResolvedKeys(
    supabase,
    userId,
    allWrong.map((r) => ({ paperId: r.paper_id, questionNumber: r.question_number })),
    pool.repByPaperId,
  );

  const titles = labelMixSessions(
    sessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey,
  );

  return sessions.map((s) => {
    const wrong = wrongBySession.get(s.id) ?? [];
    const resolvedCount = wrong.filter((r) =>
      resolved.has(`${r.paper_id}#${r.question_number}`),
    ).length;
    return {
      id: s.id,
      title: titles.get(s.id) ?? "섞어풀기",
      createdAt: s.created_at,
      score: s.score ?? 0,
      total: s.total_questions,
      wrongCount: wrong.length,
      resolvedCount,
    };
  });
}

// 메뉴에서 들어오는 섞어풀기 허브(/mix)의 "최근 기록" 줄. 과목을 가리지 않고 최근
// 것부터 몇 개만 보여주므로, 과목 페이지 카드(MixSessionSummary)와 달리 극복 진행률은
// 계산하지 않는다 — 그 계산은 과목별 출제 풀·문항 상태 조회가 붙어 허브에는 무겁다.
export type MixSessionBrief = {
  id: string;
  title: string;
  createdAt: string;
  score: number;
  total: number;
  subjectSlug: string;
  subjectName: string;
};

export async function listRecentMixSessions(
  userId: string,
  limit = 5,
): Promise<MixSessionBrief[]> {
  const admin = createAdminClient();
  type Row = {
    id: string;
    created_at: string;
    score: number | null;
    total_questions: number;
    subjects: { slug: string; name: string } | null;
  };
  // 같은 날 순번("(2)")은 그날 만든 세션 전체를 알아야 매길 수 있어, 화면에 보일
  // 개수보다 넉넉히 받아 이름을 붙인 뒤 자른다.
  const { data } = await admin
    .from("review_sessions")
    .select("id, created_at, score, total_questions, subjects(slug, name)")
    .eq("user_id", userId)
    .eq("scope", MIX_SCOPE)
    .not("submitted_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.subjects);

  const titles = labelMixSessions(
    rows.map((r) => ({ id: r.id, createdAt: r.created_at })),
    kstDayKey,
  );
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: titles.get(r.id) ?? "섞어풀기",
    createdAt: r.created_at,
    score: r.score ?? 0,
    total: r.total_questions,
    subjectSlug: r.subjects!.slug,
    subjectName: r.subjects!.name,
  }));
}

export type MixSessionQuestion = {
  position: number;
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  examTypeName: string | null;
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  isCorrect: boolean;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  explanationLocked: boolean;
  memo: string | null;
  pinned: boolean;
  // 통합 상태 기준(모든 채점 경로). 이 세션에서 틀렸어도 그 뒤 다른 곳에서 맞혔으면 극복.
  wrongCount: number;
  resolved: boolean;
};

export type MixSessionWrongNote = {
  session: { id: string; title: string; createdAt: string; score: number; total: number };
  subject: Subject;
  questions: MixSessionQuestion[];
  wrongCount: number;
  resolvedCount: number;
};

// "9월 5일 섞어풀기" 기록 페이지. 본인 세션이 아니거나, 기출 섞어풀기가 아니거나,
// 아직 채점 전이면 null(채점 전 세션의 정답·출처는 절대 내보내지 않는다).
export async function getMixSessionWrongNote(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  includeExplanations = true,
): Promise<MixSessionWrongNote | null> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, subject_id, scope, score, total_questions, created_at, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (
    !session ||
    session.user_id !== userId ||
    session.scope !== MIX_SCOPE ||
    session.submitted_at == null ||
    !session.subject_id
  ) {
    return null;
  }

  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("*")
    .eq("id", session.subject_id)
    .maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow as Subject;

  type ItemRow = {
    paper_id: string;
    question_number: number;
    position: number;
    selected_choice: number | null;
    is_correct: boolean | null;
  };
  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position, selected_choice, is_correct")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];

  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const wanted = new Map<string, Set<number>>();
  for (const it of items) {
    const set = wanted.get(it.paper_id) ?? new Set<number>();
    set.add(it.question_number);
    wanted.set(it.paper_id, set);
  }

  type PaperRow = {
    id: string;
    title: string;
    level: string | null;
    track: string | null;
    choice_count: number;
    exam_types: { name: string } | null;
  };
  const [
    { data: paperRows },
    mediaByPaper,
    answersByPaper,
    explanationsByPaper,
    explainedByPaper,
    memoByKey,
    marks,
    pool,
    allSessions,
  ] = await Promise.all([
    paperIds.length > 0
      ? supabase
          .from("exam_papers")
          .select("id, title, level, track, choice_count, exam_types(name)")
          .in("id", paperIds)
      : Promise.resolve({ data: [] as PaperRow[] }),
    fetchQuestionMedia(supabase, paperIds, wanted),
    fetchCorrectAnswers(paperIds),
    includeExplanations
      ? fetchExplanations(paperIds, wanted)
      : Promise.resolve(new Map<string, Map<number, QuestionExplanationContent>>()),
    includeExplanations
      ? Promise.resolve(new Map<string, Set<number>>())
      : fetchExplainedNumbers(paperIds, wanted),
    fetchMemos(supabase, userId, paperIds),
    fetchWrongNoteMarks(supabase, userId, paperIds),
    getMixPool(session.subject_id as string),
    fetchSubmittedMixSessions(userId, session.subject_id as string),
  ]);
  const paperById = new Map(
    ((paperRows ?? []) as unknown as PaperRow[]).map((p) => [p.id, p]),
  );
  const { resolved, wrongCount } = await fetchResolvedKeys(
    supabase,
    userId,
    items.map((it) => ({ paperId: it.paper_id, questionNumber: it.question_number })),
    pool.repByPaperId,
  );

  const questions: MixSessionQuestion[] = items.map((it) => {
    const key = `${it.paper_id}#${it.question_number}`;
    const paper = paperById.get(it.paper_id);
    const media = mediaByPaper.get(it.paper_id)?.get(it.question_number);
    return {
      position: it.position,
      paperId: it.paper_id,
      paperTitle: paper
        ? applyExamTypeSubjectName(getPaperDisplayTitle(paper.title, paper.track))
        : "삭제된 문제지",
      paperLevel: paper?.level ?? null,
      examTypeName: paper?.exam_types?.name ?? null,
      questionNumber: it.question_number,
      selectedChoice: it.selected_choice,
      correctChoice: answersByPaper.get(it.paper_id)?.[it.question_number - 1] ?? null,
      isCorrect: it.is_correct === true,
      choiceCount: media?.choiceCount ?? paper?.choice_count ?? 4,
      images: media?.images ?? [],
      explanation: explanationsByPaper.get(it.paper_id)?.get(it.question_number) ?? null,
      explanationLocked: explainedByPaper.get(it.paper_id)?.has(it.question_number) ?? false,
      memo: memoByKey.get(key) ?? null,
      pinned: marks.pinned.has(key),
      wrongCount: wrongCount.get(key) ?? (it.is_correct === false ? 1 : 0),
      resolved: resolved.has(key),
    };
  });

  const titles = labelMixSessions(
    allSessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey,
  );
  const wrong = questions.filter((q) => !q.isCorrect);

  return {
    session: {
      id: session.id as string,
      title: titles.get(session.id as string) ?? "섞어풀기",
      createdAt: session.created_at as string,
      score: (session.score as number | null) ?? 0,
      total: session.total_questions as number,
    },
    subject,
    questions,
    wrongCount: wrong.length,
    resolvedCount: wrong.filter((q) => q.resolved).length,
  };
}

// 기록 페이지·결과 화면의 "틀린 N문항 다시 풀기". 세션 소유자 확인을 서버가 하므로
// 클라이언트가 문항 목록을 보낼 필요가 없다(정답 유출 경로가 생기지 않는다).
export async function createRetryFromMixSession(
  supabase: Supabase,
  userId: string,
  sessionId: string,
): Promise<{ sessionId?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, subject_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  if (session.submitted_at == null) return { error: "채점 후에 다시 풀 수 있어요." };

  const { data: rows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position")
    .eq("session_id", sessionId)
    .eq("is_correct", false)
    .order("position", { ascending: true });
  const items = ((rows ?? []) as { paper_id: string; question_number: number }[]).map((r) => ({
    paperId: r.paper_id,
    questionNumber: r.question_number,
  }));
  if (items.length === 0) return { error: "다시 풀 틀린 문항이 없어요." };

  return createReviewSessionFromItems(supabase, userId, items, items.length, {
    subjectId: (session.subject_id as string | null) ?? null,
    maxLimit: MIX_MAX_LIMIT,
  });
}
