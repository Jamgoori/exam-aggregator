import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collapseDuplicatePapers,
  collidingPaperIds,
  paperDedupKey,
  type DedupablePaper,
  type PaperIdentitySignal,
} from "../dedup-papers";
import { chunk } from "../format";
import { compareLevels } from "../levels";
import { getPaperSlug } from "../paper-slug";
import { getSubjectDisplayName } from "../subject-label";
import type { ExamPaper, Subject } from "../types";
import { fetchAllPages, inParallel } from "./query-utils";

// 문제지 카탈로그(목록·검색·과목 인덱스) — 웹 lib/paper-search.ts(순수 계산)·lib/all-papers.ts·
// lib/home-data.ts·lib/cbt-availability.ts·lib/subject-index.ts·lib/my-round-counts.ts 를
// DI(SupabaseClient 주입) 형태로 옮긴 것. 앱은 웹처럼 전체 목록(PaperWire + cbtMask)을 받아
// 클라이언트에서 거른다(설계서 §6.2 카탈로그 행).
//
// 순수 계산(encode/decode/filter/group)은 웹 lib/paper-search.ts 가 여기서 재노출한다.

// ── 순수 타입·계산 (웹 lib/paper-search.ts 와 동일) ──────────────────────────

// 홈 화면 카드 렌더링/필터링/정렬에 필요한 필드만 담은 가벼운 문제지 타입.
// 전체 목록을 클라이언트에 통째로 보내는 방식이라 필드를 최소로 유지한다.
export type PaperCore = {
  id: string;
  title: string;
  level: string | null;
  // 중복 시험지(같은 시험지를 직류만 다르게 올린 것)를 목록에서 하나로 합칠 때,
  // 대표로 남긴 카드의 title에서 " (전산서기보)" 같은 접미사를 떼기 위해 필요하다.
  track: string | null;
  year: number;
  round: number;
  subject_id: string;
  exam_type_id: string;
};

// 화면에서 실제로 쓰는 형태 — 과목·시행처 객체가 붙어 있다. 전송은 아래 PaperWire 로 하고
// 클라이언트에서 decodePapers 로 이 모양을 복원한다.
export type LightPaper = PaperCore & {
  subjects: { id: string; name: string; slug: string } | null;
  exam_types: { id: string; name: string } | null;
};

// 서버 → 클라이언트 전송용 압축 표현(웹 RSC 페이로드 축소용 튜플 — 앱은 디스크 퍼시스트
// 블롭 크기를 같은 이유로 줄인다).
// 순서: [id, title, level, track, year, round, subjectIdx, examTypeIdx]
// subjectIdx/examTypeIdx는 HomePayload.subjects / HomePayload.examTypes의 인덱스이며,
// 대응하는 행이 없으면 -1이다.
export type PaperWire = [
  string,
  string,
  string | null,
  string | null,
  number,
  number,
  number,
  number,
];

export type ExamTypeRef = { id: string; name: string };

export type HomePayload = {
  subjects: Subject[];
  examTypes: ExamTypeRef[];
  papers: PaperWire[];
};

export function encodePapers(
  papers: PaperCore[],
  subjects: Subject[],
  examTypes: ExamTypeRef[],
): PaperWire[] {
  const subjectIdx = new Map(subjects.map((s, i) => [s.id, i]));
  const examTypeIdx = new Map(examTypes.map((t, i) => [t.id, i]));
  return papers.map((p) => [
    p.id,
    p.title,
    p.level,
    p.track,
    p.year,
    p.round,
    subjectIdx.get(p.subject_id) ?? -1,
    examTypeIdx.get(p.exam_type_id) ?? -1,
  ]);
}

// 압축 표현을 화면용 LightPaper로 되돌린다. 과목·시행처는 "복사"하지 않고 같은
// 객체를 여러 문제지가 함께 가리키게 하므로 복원 비용은 배열 순회 한 번 수준이다.
export function decodePapers({ subjects, examTypes, papers }: HomePayload): LightPaper[] {
  const subjectRefs = subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
  return papers.map(
    ([id, title, level, track, year, round, sIdx, tIdx]): LightPaper => ({
      id,
      title,
      level,
      track,
      year,
      round,
      subject_id: subjects[sIdx]?.id ?? "",
      exam_type_id: examTypes[tIdx]?.id ?? "",
      subjects: subjectRefs[sIdx] ?? null,
      exam_types: examTypes[tIdx] ?? null,
    }),
  );
}

// papers에 실제로 등장하는 시행처(exam_types.name) 집합. 검색어 토큰과 정확히 일치할
// 때만 매칭에 쓸 후보 목록이라 DB에 없는 이름을 오매칭할 일이 없다.
export function getExamTypeNames(papers: LightPaper[]): string[] {
  const set = new Set<string>();
  for (const p of papers) {
    if (p.exam_types?.name) set.add(p.exam_types.name);
  }
  return [...set];
}

export function filterPapers(
  papers: LightPaper[],
  {
    level,
    year,
    examType,
    matchedSubjectIds,
    isSearching,
    favOnly,
    bookmarkedSubjectIds,
  }: {
    level?: string;
    year?: number;
    examType?: string;
    matchedSubjectIds: string[];
    isSearching: boolean;
    // "즐겨찾기한 과목만 보기" 토글 상태. true면 즐겨찾기한 과목의 문제지만 남긴다.
    favOnly?: boolean;
    bookmarkedSubjectIds?: Set<string>;
  },
): LightPaper[] {
  return papers.filter((p) => {
    if (level && p.level !== level) return false;
    if (year && p.year !== year) return false;
    if (examType && p.exam_types?.name !== examType) return false;
    if (isSearching && !matchedSubjectIds.includes(p.subject_id)) return false;
    if (favOnly && !bookmarkedSubjectIds?.has(p.subject_id)) return false;
    return true;
  });
}

// 묶음 제목에 쓸 과목명. 문제지마다 시행처를 알고 있으므로 그 시행처가 쓰는 표기를 따른다.
function groupSubjectName(paper: LightPaper): string {
  const name = paper.subjects?.name;
  if (!name) return "기타";
  return getSubjectDisplayName(name, paper.exam_types?.name, paper.level, paper.track);
}

// "즐겨찾기한 과목만 보기" 화면은 연도 내림차순 → 같은 연도 안에서는 과목명 가나다순으로
// 묶어서 보여준다. 같은 연도·과목 안에서는 들어온 순서를 그대로 유지한다(안정 정렬).
export function groupByYearAndSubject(
  papers: LightPaper[],
): Map<number, Map<string, LightPaper[]>> {
  const sorted = [...papers].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return groupSubjectName(a).localeCompare(groupSubjectName(b), "ko");
  });

  const byYear = new Map<number, Map<string, LightPaper[]>>();
  for (const paper of sorted) {
    if (!byYear.has(paper.year)) byYear.set(paper.year, new Map());
    const bySubject = byYear.get(paper.year)!;
    const subjectName = groupSubjectName(paper);
    if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
    bySubject.get(subjectName)!.push(paper);
  }
  return byYear;
}

// ── 전체 문제지 목록 (웹 lib/all-papers.ts) ──────────────────────────────────

// 각 직렬(시험 종류)의 관례적 필기 시행 월(대략). 같은 연도 안에서 "최근에 치른 시험"이
// 먼저 보이도록 직렬별 관례 월을 타이브레이커로 쓴다. 여기 없는 직렬은 0(그 해 맨 뒤).
const TYPICAL_EXAM_MONTH: Record<string, number> = {
  소방: 3,
  계리직: 3,
  국가직: 4,
  기상직: 4,
  지방직: 6,
  서울시: 6,
  법원직: 6,
  간호직: 6,
  지역인재: 7,
  경찰: 8,
  해경: 8,
  국회직: 9,
};

// 정렬만 하고 **중복 통합은 하지 않은** 전체 행. 통합은 호출부가 신호를 구해 collapse 한다
// (웹은 service_role 정답 대조, 앱은 RPC paper_identity_signals / 문항 수).
export async function fetchExamPaperRows(
  client: SupabaseClient,
): Promise<{ rows: PaperCore[]; examTypes: ExamTypeRef[] }> {
  const { data: examTypeRows } = await client.from("exam_types").select("id, name");
  const examTypes = (examTypeRows ?? []) as ExamTypeRef[];
  const monthByExamTypeId = new Map(
    examTypes.map((t) => [t.id, TYPICAL_EXAM_MONTH[t.name] ?? 0]),
  );

  const rows = await fetchAllPages<PaperCore>(
    (from, to) =>
      client
        .from("exam_papers")
        .select("id, title, level, track, year, round, subject_id, exam_type_id")
        .order("year", { ascending: false })
        .order("round", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: PaperCore[] | null;
        error: { message: string } | null;
      }>,
    "문제지 목록",
  );

  rows.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    const am = monthByExamTypeId.get(a.exam_type_id) ?? 0;
    const bm = monthByExamTypeId.get(b.exam_type_id) ?? 0;
    if (am !== bm) return bm - am;
    if (a.round !== b.round) return b.round - a.round;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { rows, examTypes };
}

// ── 중복 통합 신호 ──────────────────────────────────────────────────────────

// RPC paper_identity_signals 는 한 번에 500건까지(schema.sql). answer_cluster 는 요청 집합
// 안에서만 유효한 dense_rank 라, 같은 dedup 키 그룹이 두 요청에 갈라지면 같은 정답이 다른
// 번호를 받는다 → 그룹 단위로 묶어 청크를 만들고 지문은 `청크:번호` 로 구분한다.
const SIGNAL_RPC_LIMIT = 500;

// 로그인 사용자용 내용 신호(문항 수 + 정답 클러스터). 정답 원문·해시는 받지 않는다.
// authenticated 전용 RPC 라 비로그인은 부르지 말 것(42501).
export async function fetchPaperIdentitySignalsRpc(
  client: SupabaseClient,
  papers: DedupablePaper[],
): Promise<Map<string, PaperIdentitySignal>> {
  const signals = new Map<string, PaperIdentitySignal>();
  const collidingIds = new Set(collidingPaperIds(papers));
  if (collidingIds.size === 0) return signals;

  const groups = new Map<string, string[]>();
  for (const p of papers) {
    if (!collidingIds.has(p.id)) continue;
    const key = paperDedupKey(p);
    const arr = groups.get(key);
    if (arr) arr.push(p.id);
    else groups.set(key, [p.id]);
  }
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const ids of groups.values()) {
    if (current.length + ids.length > SIGNAL_RPC_LIMIT && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(...ids);
  }
  if (current.length > 0) chunks.push(current);

  await inParallel(chunks.map((ids, idx) => ({ ids, idx })), async ({ ids, idx }) => {
    const { data, error } = await client.rpc("paper_identity_signals", { p_paper_ids: ids });
    if (error) throw new Error(`중복 판정 신호 조회 실패: ${error.message}`);
    for (const row of (data ?? []) as {
      paper_id: string;
      question_count: number;
      answer_length: number | null;
      answer_cluster: number | null;
    }[]) {
      signals.set(row.paper_id, {
        questionCount: row.question_count ?? 0,
        answerSignature: row.answer_cluster == null ? null : `${idx}:${row.answer_cluster}`,
        answerLength: row.answer_length,
      });
    }
  });
  return signals;
}

// 비로그인용 신호(문항 수만 — questions 는 공개 읽기). 정답 대조가 없으므로 정답이 서로
// 다르게 등록된 문제지도 메타데이터가 같으면 합쳐 보인다(core dedup-papers.ts 머리말).
// 문제지 20장씩 끊어 PostgREST 1000행 한도(문제지당 최대 50문항)에 걸리지 않게 한다.
export async function fetchQuestionCountSignals(
  client: SupabaseClient,
  papers: DedupablePaper[],
): Promise<Map<string, PaperIdentitySignal>> {
  const signals = new Map<string, PaperIdentitySignal>();
  const ids = collidingPaperIds(papers);
  if (ids.length === 0) return signals;
  for (const id of ids) signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  await inParallel(chunk(ids, 20), async (batch) => {
    const { data } = await client
      .from("questions")
      .select("paper_id")
      .in("paper_id", batch)
      .range(0, 999);
    for (const row of (data ?? []) as { paper_id: string }[]) {
      const s = signals.get(row.paper_id);
      if (s) s.questionCount += 1;
    }
  });
  return signals;
}

export type SignalsProvider = (
  client: SupabaseClient,
  papers: DedupablePaper[],
) => Promise<Map<string, PaperIdentitySignal>>;

// ── CBT 가능 목록 (웹 lib/cbt-availability.ts) ───────────────────────────────

export async function fetchCbtAvailability(
  client: SupabaseClient,
  paperIds: string[],
): Promise<Set<string>> {
  if (paperIds.length === 0) return new Set();
  const { data } = await client.rpc("has_cbt_answers_bulk", { target_paper_ids: paperIds });
  return new Set(((data ?? []) as { paper_id: string }[]).map((row) => row.paper_id));
}

// 전체 — PostgREST 는 range 를 안 주면 1000행까지만 돌려주므로 이어받는다.
export async function fetchAllCbtAvailability(client: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAllPages<{ paper_id: string }>(
    (from, to) =>
      client.rpc("has_cbt_answers_all").range(from, to) as unknown as Promise<{
        data: { paper_id: string }[] | null;
        error: { message: string } | null;
      }>,
    "CBT 가능 목록",
  );
  return new Set(rows.map((row) => row.paper_id));
}

// ── 카탈로그 한 벌 (웹 lib/home-data.ts getCachedHomeData + lib/paper-slug-map.ts) ───

export type Catalog = HomePayload & {
  // papers 와 같은 순서로 "바로 풀기 가능 여부"를 담은 0/1 문자열.
  cbtMask: string;
  // 전 문제지(중복 통합 **전**) slug → id. 비대표 문제지의 주소도 열려야 한다.
  slugMap: Record<string, string>;
};

export async function fetchCatalog(
  client: SupabaseClient,
  // 중복 통합 신호. 로그인은 fetchPaperIdentitySignalsRpc, 비로그인은 fetchQuestionCountSignals.
  signalsProvider: SignalsProvider,
): Promise<Catalog> {
  const [{ data: subjectRows }, { rows, examTypes }, cbtAvailability] = await Promise.all([
    client.from("subjects").select("*").order("name"),
    fetchExamPaperRows(client),
    fetchAllCbtAvailability(client),
  ]);
  const subjects = (subjectRows ?? []) as Subject[];

  const slugMap: Record<string, string> = {};
  for (const row of rows) slugMap[getPaperSlug(row.title, row.round, row.track)] = row.id;

  const signals = await signalsProvider(client, rows);
  const papers = collapseDuplicatePapers(rows, signals);

  return {
    subjects,
    examTypes,
    papers: encodePapers(papers, subjects, examTypes),
    cbtMask: papers.map((p) => (cbtAvailability.has(p.id) ? "1" : "0")).join(""),
    slugMap,
  };
}

// ── 과목 인덱스 (웹 lib/subject-index.ts — 순수 계산) ─────────────────────────

export type SubjectIndexEntry = {
  slug: string;
  name: string;
  /** 중복 시험지를 합친 뒤의 자료 수 — 홈·과목 페이지에 보이는 개수와 같다. */
  count: number;
  minYear: number;
  maxYear: number;
};

// 자료가 하나도 없는 과목은 빼고 돌려준다.
export function buildSubjectIndex(
  subjects: Subject[],
  papers: { subject_id: string; year: number }[],
): { entries: SubjectIndexEntry[]; totalCount: number } {
  const stats = new Map<string, { count: number; minYear: number; maxYear: number }>();
  for (const p of papers) {
    let s = stats.get(p.subject_id);
    if (!s) {
      s = { count: 0, minYear: p.year, maxYear: p.year };
      stats.set(p.subject_id, s);
    }
    s.count += 1;
    if (p.year < s.minYear) s.minYear = p.year;
    if (p.year > s.maxYear) s.maxYear = p.year;
  }
  const entries = subjects.flatMap<SubjectIndexEntry>((subject) => {
    const s = stats.get(subject.id);
    if (!s || s.count === 0) return [];
    return [{ slug: subject.slug, name: subject.name, count: s.count, minYear: s.minYear, maxYear: s.maxYear }];
  });
  return { entries, totalCount: papers.length };
}

// ── 과목 페이지 (웹 app/subjects/[slug]/page.tsx 조회부) ─────────────────────

export type ExamTypeOption = { id: string; name: string; display_order: number };

// 이 과목에 실제 존재하는 급수·직렬만(탭 후보).
export async function fetchSubjectFilters(
  client: SupabaseClient,
  subjectId: string,
): Promise<{ levels: string[]; examTypes: ExamTypeOption[]; hasAnyPaper: boolean }> {
  const [{ data: levelRows }, { data: examTypeRows }] = await Promise.all([
    client.from("exam_papers").select("level").eq("subject_id", subjectId),
    client
      .from("exam_papers")
      .select("exam_type_id, exam_types(id, name, display_order)")
      .eq("subject_id", subjectId),
  ]);
  const levels = [
    ...new Set(
      ((levelRows ?? []) as { level: string | null }[])
        .map((r) => r.level)
        .filter((l): l is string => !!l),
    ),
  ].sort(compareLevels);
  const examTypeById = new Map<string, ExamTypeOption>();
  for (const row of (examTypeRows ?? []) as unknown as { exam_types: ExamTypeOption | null }[]) {
    const et = row.exam_types;
    if (et) examTypeById.set(et.id, et);
  }
  const examTypes = [...examTypeById.values()].sort((a, b) => a.display_order - b.display_order);
  return { levels, examTypes, hasAnyPaper: (levelRows ?? []).length > 0 };
}

// 이 과목(+필터)의 문제지를 전부 받아 중복을 합친다. 페이지 자르기는 호출부(합친 다음
// 메모리에서 페이지네이션 — SQL LIMIT 으로 먼저 자르면 대표가 잘려 총 개수가 흔들린다).
export async function fetchSubjectPapers(
  client: SupabaseClient,
  subjectId: string,
  filter: { level?: string; examTypeIds?: string[] },
  signalsProvider: SignalsProvider,
): Promise<ExamPaper[]> {
  const rows = await fetchAllPages<ExamPaper>(
    (from, to) => {
      let q = client.from("exam_papers").select("*, subjects(*), exam_types(*)").eq("subject_id", subjectId);
      if (filter.level) q = q.eq("level", filter.level);
      if (filter.examTypeIds && filter.examTypeIds.length > 0) q = q.in("exam_type_id", filter.examTypeIds);
      return q
        .order("year", { ascending: false })
        .order("round", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: ExamPaper[] | null;
        error: { message: string } | null;
      }>;
    },
    "과목 문제지 목록",
  );
  const signals = await signalsProvider(client, rows);
  return collapseDuplicatePapers(rows, signals);
}

// ── 내 회독 수 (웹 lib/my-round-counts.ts) ───────────────────────────────────

// 로그인한 사용자가 문제지별로 몇 번 응시했는지(RLS 본인 행). "N회독" 배지용.
export async function fetchMyRoundCounts(
  client: SupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data } = await client.from("cbt_attempts").select("paper_id").eq("user_id", userId);
  for (const row of (data ?? []) as { paper_id: string }[]) {
    counts.set(row.paper_id, (counts.get(row.paper_id) ?? 0) + 1);
  }
  return counts;
}
