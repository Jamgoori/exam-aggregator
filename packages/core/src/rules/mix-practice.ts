import type { SupabaseClient } from "@supabase/supabase-js";
import { collidingPaperIds, representativePaperIds } from "../dedup-papers";
import { examLevelTier, isApproxLevelTier } from "../exam-level-tier";
import { chunk, kstDayKey } from "../format";
import {
  clampMixLimit,
  filterMixCandidatesByLevel,
  filterMixCandidatesByYear,
  labelMixSessions,
  mixCandidateKey,
  normalizeYearRange,
  pickMixQuestions,
  MIX_MAX_LIMIT,
  MIX_NO_LEVEL,
  type MixCandidate,
  type MixYearRange,
} from "../mix-practice";
import { getPaperDisplayTitle } from "../paper-title";
import { applyExamTypeSubjectName } from "../subject-label";
import type { Subject } from "../types";
import { fetchPaperIdentitySignals } from "../data/dedup-signals";
import { fetchQuestionMedia } from "../data/question-media";
import { fetchAllPages, inParallel } from "../data/query-utils";
import { getSubjectBySlug } from "../data/subjects";
import {
  fetchCorrectAnswers,
  fetchExplainedNumbers,
  fetchExplanations,
  fetchMemos,
  fetchWrongNoteMarks,
} from "../data/wrong-notes";
import type { QuestionExplanationContent } from "./explanations";
import { createReviewSessionFromItems, type CreateReviewSessionResult } from "./review-session";

// 기출 섞어풀기 — 한 과목의 기출 전체(시행처 무관)에서 무작위로 뽑아 새 문제를 푼다.
// 웹 lib/mix-practice.ts 에서 옮겼다 — 웹 서버 액션·페이지와 앞으로 생길 Edge
// `mix-create`(§6.7 #14)가 이 함수들의 얇은 어댑터다. 'use cache' 로 감싸는 조회
// (getMixPool·getMixHubIndex·getMixOverview)는 웹 파일에 남고 여기의 순수/DB 부분
// (buildMixPool·buildMixHubIndex·toMixOverview)을 부른다.
//
// 오답 섞어풀기(rules/review-session.ts)와 같은 테이블(review_sessions/items, scope='mix')과
// 같은 풀이·채점 경로를 쓴다. 다른 것은 **후보가 어디서 오는가**뿐이다 — 저쪽은 내
// 오답, 여기는 과목의 기출 코퍼스. 채점 결과는 똑같이 user_question_status 에 기록되므로
// 여기서 틀린 문항은 오답노트(문항 모아보기·복습 큐)에 그대로 합류하고, 세션 자체는
// 오답노트 과목 페이지에 "9월 5일 섞어풀기" 카드로 남는다.

export const MIX_SCOPE = "mix";

// PostgREST 임베드(`subjects(slug, name)`)는 관계 하나여도 배열로 올 때가 있다. 그대로
// `row.subjects.slug` 를 읽으면 값이 조용히 undefined 가 되는데, 그 slug 는 화면에서
// 색 해시(subjectColorIndex — undefined.length)로 들어가 페이지를 통째로 500 으로
// 떨어뜨린다(2026-09-05 /mix 실측: 최근 기록이 있는 로그인 사용자만 재현). 읽는 자리를
// 전부 이 함수로 통일한다 — 엣지 함수(review-history)도 같은 이유로 두 모양을 다 받는다.
export function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
  exam_types: { name: string } | { name: string }[] | null;
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

// 과목 id → 출제 풀. 웹은 'use cache' 로 감싼 getMixPool 을, Edge 는 buildMixPool 을
// 그대로 넘긴다(캐시 계층이 런타임마다 달라 규칙이 직접 부르지 않는다).
export type MixPoolLoader = (subjectId: string) => Promise<MixPool>;

export const EMPTY_MIX_POOL: MixPool = {
  candidates: [],
  paperCount: 0,
  examTypeNames: [],
  levelGroups: [],
  cells: [],
  minYear: null,
  maxYear: null,
  repByPaperId: {},
};

// 문항 id → 정본 개념 id. question_explanations 는 service_role 만 읽는다(정답 요약이
// 실려 있어서). 여기서는 concept_id 만 받고 본문은 건드리지 않는다.
async function fetchCanonicalConcepts(
  admin: SupabaseClient,
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
// 않고 호출부가 캐시한다(웹 getMixPool: 'use cache' 1시간) — 로그인 여부와 무관한 공개
// 자료(문항 이미지 존재 여부·정답 등록 여부)만 담고 정답 자체는 싣지 않는다.
//
// client — 공개 테이블(exam_papers·questions)을 읽는 클라이언트(웹은 공개 anon 클라이언트).
// admin  — paper_answers(voided)·question_explanations(concept_id) 읽기.
//
// opts.includeConcepts — 문항별 정본 개념(concept_id)을 함께 읽을지. 기본 true.
//   개념은 **출제(pickMixQuestions)의 분산에만** 쓰이고 화면 요약(toMixOverview)·기록
//   (listMixSessions 의 repByPaperId)에는 전혀 쓰이지 않는다. 그런데 이 조회만 문항
//   200개당 한 번씩 붙어(fetchCanonicalConcepts), 문항 수천 개짜리 과목에서는 왕복이
//   십수 번 는다. 웹은 'use cache' 로 한 시간에 한 번만 치르지만 **Edge 에는 캐시 계층이
//   없어 요청마다 치른다**(설계서 §6.2 — 규칙이 캐시를 모르게 두려는 선택). 그래서
//   개념이 필요 없는 호출부(EF mix-create 의 overview, review-history 의 mix 기록 목록)는
//   false 로 끈다.
//
//   ⚠ false 로 만든 풀은 **createMixSessionForUser 에 넘기지 말 것** — 후보의 conceptId 가
//   전부 null 이 되어 개념 분산이 조용히 사라진다(한 개념이 세션을 도배한다).
export async function buildMixPool(
  client: SupabaseClient,
  admin: SupabaseClient,
  subjectId: string,
  opts: { includeConcepts?: boolean } = {},
): Promise<MixPool> {
  const papers = await fetchAllPages<PoolPaper>(
    (from, to) =>
      client
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
  if (papers.length === 0) return EMPTY_MIX_POOL;

  // 직류만 다른 같은 시험지는 하나로 접는다 — 안 접으면 같은 문항이 두 장에서 한 번씩
  // 뽑혀 한 세션에 두 번 나올 수 있다.
  const signals = await fetchPaperIdentitySignals(client, collidingPaperIds(papers), admin);
  const { repByPaperId } = representativePaperIds(papers, signals);
  const repIds = [...new Set(papers.map((p) => repByPaperId.get(p.id) ?? p.id))];

  // 정답이 등록된 문제지만 채점할 수 있다. voided(전항정답·복수정답) 문항은 정답이
  // 없어 "맞다/틀리다"를 말할 수 없으므로 후보에서 뺀다(schema.sql 의 의도 그대로).
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
  if (answeredRepIds.length === 0) return { ...EMPTY_MIX_POOL, paperCount: repIds.length };

  // 문제지별 난도 등급. 급수가 있으면 그대로, 없으면 시행처·직류로 환산한다.
  const tierByPaper = new Map(
    papers.map((p) => {
      const input = {
        level: p.level,
        examTypeName: embedOne(p.exam_types)?.name ?? null,
        track: p.track,
      };
      return [p.id, { tier: examLevelTier(input), approx: isApproxLevelTier(input) }];
    }),
  );
  // 이미지가 잘려 있는 문항만(문제를 보여줄 수 없으면 못 푼다). question_images 를
  // inner 조인해 이미지가 하나라도 있는 문항만 받는다 — 이미지 경로 자체는 세션을
  // 그릴 때 fetchQuestionMedia 가 뽑힌 문항에 대해서만 다시 받는다.
  type QRow = { id: string; paper_id: string; question_number: number };
  const rowsById = new Map<string, QRow>();
  await inParallel(chunk(answeredRepIds, 25), async (ids) => {
    const rows = await fetchAllPages<QRow>(
      (from, to) =>
        client
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
  const conceptByQuestionId =
    opts.includeConcepts === false
      ? new Map<string, string>()
      : await fetchCanonicalConcepts(admin, [...rowsById.keys()]);

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
    ...new Set(
      papers.map((p) => embedOne(p.exam_types)?.name).filter((n): n is string => !!n),
    ),
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
// 풀(buildMixPool)을 전부 돌리면 문항 단위 조회가 과목 수만큼 붙는다. 그래서 목록 조회
// 한 번(웹 fetchAllExamPapers — 홈·과목 색인이 쓰는 것과 같은 조회, 중복 시험지도 이미
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
export async function fetchPlayableQuestionCounts(
  client: SupabaseClient,
): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await client
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

// buildMixHubIndex 가 문제지에서 읽는 필드(웹 PaperCore 의 부분집합).
export type MixHubPaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  level: string | null;
  track: string | null;
};

// 허브 집계의 순수 부분. 조회(문제지 목록·과목 목록·집계 RPC)는 호출부가 한다.
export function buildMixHubIndex(input: {
  papers: MixHubPaper[];
  examTypes: { id: string; name: string }[];
  subjects: { id: string; slug: string; name: string }[];
  // null 이면(집계 함수 미적용) 문제지 수로 센다 — 화면이 단위를 따라 바꾼다.
  playable: Record<string, number> | null;
}): MixHubIndex {
  const { papers, examTypes, playable } = input;
  const unit: MixHubUnit = playable ? "question" : "paper";
  const countOf = (paperId: string) => (playable ? (playable[paperId] ?? 0) : 1);
  const examTypeName = new Map(examTypes.map((t) => [t.id, t.name]));
  const subjects = new Map(input.subjects.map((r) => [r.id, r]));

  const tierStats = new Map<string, { approx: boolean; count: number }>();
  const bySubject = new Map<string, MixHubSubject>();
  for (const p of papers) {
    const subject = subjects.get(p.subject_id);
    if (!subject) continue;
    // 풀 수 있는 문항이 하나도 없는 문제지(정답 미등록·크롭 전)는 세지 않는다 —
    // 세면 "기출 40문항"이라고 해 놓고 시작 화면이 "준비 중"이 된다.
    const count = countOf(p.id);
    if (count === 0) continue;
    const tierInput = {
      level: p.level,
      examTypeName: examTypeName.get(p.exam_type_id) ?? null,
      track: p.track,
    };
    const key = examLevelTier(tierInput) ?? MIX_NO_LEVEL;

    const t = tierStats.get(key) ?? { approx: false, count: 0 };
    t.count += count;
    // 환산된 문제지가 하나라도 있으면 그 등급은 "9급 수준"으로 부른다.
    if (isApproxLevelTier(tierInput)) t.approx = true;
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

// 시작 화면용 요약(출제 풀 → 화면 값). 로그인과 무관한 공개 통계다.
export function toMixOverview(subject: Subject, pool: MixPool): MixOverview {
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
  client: SupabaseClient,
  userId: string,
  repByPaperId: Record<string, string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data } = await client
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

export type CreateMixSessionInput = {
  subjectSlug: string;
  limit?: number;
  // levels: 급수 필터(빈 배열 = 전체). 풀에 실제로 있는 급수 키만 받아들인다.
  levels?: string[];
  // year: 연도 범위(둘 다 null 이면 전체). 자료가 있는 구간 안으로 정리해서 쓴다.
  year?: Partial<MixYearRange> | null;
  requestId?: string | null;
};

// 기출 섞어풀기 세션 생성. 세션·문항 저장은 오답 섞어풀기와 같은 함수를 쓴다 —
// 뽑은 순서(문제지 라운드로빈 + 섞기)를 그대로 쓰므로 keepOrder.
export async function createMixSessionForUser(
  client: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  input: CreateMixSessionInput,
  deps: { getMixPool: MixPoolLoader },
): Promise<CreateMixSessionResult> {
  const subject = await getSubjectBySlug(client, input.subjectSlug);
  if (!subject) return { error: "과목을 찾을 수 없어요." };

  const pool = await deps.getMixPool(subject.id);
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
  const seen = await fetchSeenKeys(client, userId, pool.repByPaperId);
  const { picked, unseenCount, coveredAll } = pickMixQuestions(candidates, limit, seen);
  if (picked.length === 0) return { error: "출제할 문항이 없어요." };

  const res = await createReviewSessionFromItems(admin, userId, picked, picked.length, {
    keepOrder: true,
    scope: MIX_SCOPE,
    subjectId: subject.id,
    maxLimit: MIX_MAX_LIMIT,
    requestId: input.requestId ?? null,
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
  admin: SupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SessionRow[]> {
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
// 대표로 접힌 형제 문제지의 행도 함께 본다(rules/status-targets.ts 와 같은 문제).
async function fetchResolvedKeys(
  client: SupabaseClient,
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
    const { data } = await client
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
  client: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  subjectId: string,
  deps: { getMixPool: MixPoolLoader },
): Promise<MixSessionSummary[]> {
  const sessions = await fetchSubmittedMixSessions(admin, userId, subjectId);
  if (sessions.length === 0) return [];

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

  const pool = await deps.getMixPool(subjectId);
  const allWrong = [...wrongBySession.values()].flat();
  const { resolved } = await fetchResolvedKeys(
    client,
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

// 세션 행 → 화면용 목록. 임베드 모양(배열/객체) 정규화와 같은 날 순번 붙이기가 여기
// 다 들어 있어, 조회와 떼어 테스트할 수 있다(mix-practice.test.ts).
export type MixSessionRow = {
  id: string;
  created_at: string;
  score: number | null;
  total_questions: number;
  subjects: { slug: string; name: string } | { slug: string; name: string }[] | null;
};

export function toMixSessionBriefs(
  rows: MixSessionRow[],
  limit: number,
): MixSessionBrief[] {
  // 과목이 지워졌거나(세션은 남는다 — subject_id 는 on delete set null) 임베드가 비면
  // 링크를 만들 수 없으므로 목록에서 뺀다. slug 가 빈 행을 그대로 그리면 화면이 죽는다.
  const usable = rows.flatMap((row) => {
    const subject = embedOne(row.subjects);
    return subject?.slug ? [{ row, subject }] : [];
  });

  const titles = labelMixSessions(
    usable.map(({ row }) => ({ id: row.id, createdAt: row.created_at })),
    kstDayKey,
  );
  return usable.slice(0, limit).map(({ row, subject }) => ({
    id: row.id,
    title: titles.get(row.id) ?? "섞어풀기",
    createdAt: row.created_at,
    score: row.score ?? 0,
    total: row.total_questions,
    subjectSlug: subject.slug,
    subjectName: subject.name,
  }));
}

export async function listRecentMixSessions(
  admin: SupabaseClient,
  userId: string,
  limit = 5,
): Promise<MixSessionBrief[]> {
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
  return toMixSessionBriefs((data ?? []) as unknown as MixSessionRow[], limit);
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
  client: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  includeExplanations: boolean,
  deps: { getMixPool: MixPoolLoader },
): Promise<MixSessionWrongNote | null> {
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

  const { data: subjectRow } = await client
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
    exam_types: { name: string } | { name: string }[] | null;
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
      ? client
          .from("exam_papers")
          .select("id, title, level, track, choice_count, exam_types(name)")
          .in("id", paperIds)
      : Promise.resolve({ data: [] as PaperRow[] }),
    fetchQuestionMedia(client, paperIds, wanted),
    fetchCorrectAnswers(admin, paperIds),
    includeExplanations
      ? fetchExplanations(admin, paperIds, wanted)
      : Promise.resolve(new Map<string, Map<number, QuestionExplanationContent>>()),
    includeExplanations
      ? Promise.resolve(new Map<string, Set<number>>())
      : fetchExplainedNumbers(admin, paperIds, wanted),
    fetchMemos(client, userId, paperIds),
    fetchWrongNoteMarks(client, userId, paperIds),
    deps.getMixPool(session.subject_id as string),
    fetchSubmittedMixSessions(admin, userId, session.subject_id as string),
  ]);
  const paperById = new Map(
    ((paperRows ?? []) as unknown as PaperRow[]).map((p) => [p.id, p]),
  );
  const { resolved, wrongCount } = await fetchResolvedKeys(
    client,
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
      examTypeName: embedOne(paper?.exam_types)?.name ?? null,
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
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  opts: { requestId?: string | null; random?: () => number } = {},
): Promise<CreateReviewSessionResult> {
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

  return createReviewSessionFromItems(admin, userId, items, items.length, {
    subjectId: (session.subject_id as string | null) ?? null,
    maxLimit: MIX_MAX_LIMIT,
    requestId: opts.requestId ?? null,
    random: opts.random,
  });
}
