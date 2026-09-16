import "server-only";
import { cacheLife } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDiagnosisAggregate as getDiagnosisAggregateRule,
  type DiagnosisAggregate,
} from "@gongmoa/core/server";

// AI 약점 진단의 "결정적(무AI) 데이터층" — **웹 어댑터**와, 웹 생성기 전용 오답 문항 표본.
//
// 집계 본체(과목별 개념 오답 분포)는 packages/core/src/rules/diagnosis-aggregate.ts 로
// 옮겼다(설계서 §6.7 #21·§6.8) — 웹 진단 페이지와 Edge `diagnosis-aggregate` 가 같은 함수를
// 부른다. 집계가 두 벌이면 같은 계정의 막대그래프가 웹과 앱에서 다른 높이로 그려진다.
// 이 파일에 남은 것은 두 가지다:
//   1) 웹에만 있는 캐시 계층(`'use cache'`) — 규칙에 캐시를 넣지 않는다(§6.2: 런타임마다
//      캐시가 달라 규칙이 그걸 알면 안 된다). Edge 에는 이 계층이 없다.
//   2) `getWrongQuestionSamples` — 모델 프롬프트에 넣을 오답 문항 표본. **웹 생성기 전용**이고
//      Edge·앱으로는 절대 나가지 않는다(발문·정답·선지 해설이 통째로 들어 있다).
//
// question_explanations/paper_answers는 service_role만 읽으므로 admin 클라이언트로 돈다.
// 호출부는 반드시 본인(userId) 확인을 끝낸 뒤에만 부를 것.

type Admin = ReturnType<typeof createAdminClient>;

export type {
  ConceptStat,
  SubjectStat,
  SubjectConceptGroup,
  DiagnosisWindow,
  DiagnosisAggregate,
} from "@gongmoa/core/server";

export async function getDiagnosisAggregate(
  userId: string,
  opts: { days?: number | null; widen?: boolean; subjectSlug?: string | null } = {},
): Promise<DiagnosisAggregate> {
  // 캐시 키가 눈에 보이도록 옵션을 여기서 원시값으로 펴서 넘긴다. 기본값이 호출부마다
  // 다르게 생략되면(`{days:7}` vs `{days:7, widen:undefined}`) 같은 질문이 다른 키가 돼
  // 캐시가 놀게 된다.
  return aggregateCached(
    userId,
    opts.days === undefined ? 7 : opts.days,
    // widen=false 면 창을 절대 넓히지 않는다. AI 분석 경로가 이걸 쓴다 — 창이 곧
    // 프롬프트 크기이자 요금이라, 빈 주에 조용히 90일치를 긁어 오면 안 된다.
    opts.widen !== false,
    opts.subjectSlug ?? null,
  );
}

// 집계 + 캐시. 진단 화면에서 가장 느린 구간이 여기다(계정 전체 응시 이력 → 기간
// 안의 응답 → 문항·해설·개념 → 개념별 기출 수). 페이지를 다시 열거나 기간 칩을 오갈
// 때마다 같은 계산을 처음부터 다시 하고 있었다.
//
// **userId 가 첫 번째 인자인 것이 이 캐시의 안전장치다** — 캐시 키는 인자에서 나오므로,
// 사용자 구분이 인자에 없으면 남의 오답 집계가 다른 사람에게 나간다. 인자를 줄이거나
// 사용자 정보를 함수 밖(전역·요청 컨텍스트)에서 읽도록 바꾸지 말 것.
//
// 30초로 짧게 잡는다. 문제를 풀고 바로 진단으로 넘어오는 흐름이 흔해서, 방금 푼 것이
// 한참 안 보이면 고장으로 읽힌다.
async function aggregateCached(
  userId: string,
  requested: number | null,
  widenAllowed: boolean,
  subjectFilter: string | null,
): Promise<DiagnosisAggregate> {
  "use cache";
  cacheLife({ revalidate: 30, expire: 300 });

  return getDiagnosisAggregateRule(createAdminClient(), userId, {
    days: requested,
    widen: widenAllowed,
    subjectSlug: subjectFilter,
  });
}

// ── 아래는 웹 생성기 전용(모델 프롬프트 입력) ───────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchAll<T>(
  admin: Admin,
  table: string,
  columns: string,
  // supabase 쿼리 빌더 체인은 타입이 복잡해 여기선 느슨하게 받는다(런타임 안전).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  const SIZE = 1000;
  while (true) {
    const base = admin.from(table).select(columns).range(from, from + SIZE - 1);
    const q = apply(base);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return rows;
}

const questionKey = (pid: string, n: number) => `${pid}#${n}`;

// ── 오답 문항 표본(AI 코칭 입력용) ───────────────────────────────────────────
// 개념 이름과 숫자만으로는 "어떤 유형에서 무너지는지"를 말할 수 없다(모델이 문제를
// 본 적이 없으니 학습법 일반론밖에 못 낸다). 그래서 코칭 대상 개념마다 실제로 틀린
// 문항 몇 개를 발문·정답·"내가 고른 선지"까지 함께 뽑아 모델에 넣는다.
//
// 비용이 여기서 결정된다 — 문항당 약 300자를 넣으므로, 개념당 문항 수(perConcept)와
// 아래 truncate 길이가 곧 1회 요금이다. 함부로 늘리지 말 것. 문제 이미지·해설 전문은
// 넣지 않는다(문항당 1,000자를 넘겨 요금이 10배가 된다).
export type WrongQuestionSample = {
  // 개념 키(정본 id 우선, 없으면 "kw:표기"). 생성기가 개념별로 묶을 때 쓴다 — 표시
  // 이름은 과목이 다르면 겹칠 수 있어 키로 쓰면 안 된다.
  conceptKey: string;
  concept: string;
  subject: string | null;
  // 발문 요약("~옳지 않은 것을 고르는 문제입니다"). question_explanations.question_text.
  questionText: string | null;
  correctChoice: number | null;
  correctSummary: string | null;
  // 유저가 실제로 고른 오답 선지와 그 선지의 해설(왜 틀렸는지). CBT 응시 기록이 없는
  // 문항(섞어풀기만 푼 경우 등)은 null.
  pickedChoice: number | null;
  pickedReason: string | null;
  // 이 문항을 지금까지 몇 번 틀렸는지, 그리고 마지막에 맞혔는지(user_question_status).
  // "두 번째로 같은 함정에 걸렸다"와 "한 번 틀리고 다음엔 맞혔다"는 진단이 달라야 한다.
  wrongTimes: number;
  resolved: boolean;
};

// 모델에 넣기 전 자르는 길이. 유형만 가려내던 때는 140자로 충분했지만, 이제는 "이
// 선지를 고른 것이 무엇을 착각한 것인지"까지 써야 해서 근거가 문장 중간에서 잘리면
// 모델이 앞부분만 보고 지어낸다. 문항당 몇백 자 늘어나는 만큼 입력 요금도 오른다.
const SAMPLE_TEXT_MAX = 240;

function truncate(s: string | null | undefined, max = SAMPLE_TEXT_MAX): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type ChoiceExplanation = { number?: number; explanation?: string; verdict_label?: string };

// concepts(개념 이름들)에 속하는 유저의 오답 문항을 개념당 최대 perConcept개 뽑는다.
// 아직 극복하지 못한 문항(last_is_correct=false)을 먼저, 그다음 많이 틀린 순.
export async function getWrongQuestionSamples(
  userId: string,
  targets: { conceptId: string | null; concept: string }[],
  perConcept = 6,
): Promise<WrongQuestionSample[]> {
  // 정본 개념은 id로, 미분류는 표기로 고른다(집계와 같은 키 규칙).
  const wantedIds = new Set(targets.map((t) => t.conceptId).filter((v): v is string => !!v));
  const wantedTitles = new Set(
    targets.filter((t) => !t.conceptId).map((t) => t.concept.trim()).filter(Boolean),
  );
  const displayByKey = new Map(
    targets.map((t) => [t.conceptId ?? `kw:${t.concept.trim()}`, t.concept]),
  );
  if (wantedIds.size === 0 && wantedTitles.size === 0) return [];

  const admin = createAdminClient();

  const statusRows = await fetchAll<{
    paper_id: string;
    question_number: number;
    wrong_count: number;
    last_is_correct: boolean;
  }>(
    admin,
    "user_question_status",
    "paper_id, question_number, wrong_count, last_is_correct",
    (q) => q.eq("user_id", userId).gt("wrong_count", 0),
  );
  if (statusRows.length === 0) return [];

  // (paper, 문항번호) → question id, paper → 과목.
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];
  const questionIdByKey = new Map<string, string>();
  const paperSubject = new Map<string, string | null>();
  for (const ids of chunk(paperIds, 100)) {
    const qrows = await fetchAll<{ id: string; paper_id: string; question_number: number }>(
      admin,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids),
    );
    for (const r of qrows) questionIdByKey.set(questionKey(r.paper_id, r.question_number), r.id);

    const prows = await fetchAll<{ id: string; subjects: { name: string } | null }>(
      admin,
      "exam_papers",
      "id, subjects(name)",
      (q) => q.in("id", ids),
    );
    for (const p of prows) paperSubject.set(p.id, p.subjects?.name ?? null);
  }

  // 해설(개념·발문·정답·선지해설). 대상 개념에 속한 문항만 남긴다.
  const questionIds = [...questionIdByKey.values()];
  type ExpRow = {
    question_id: string;
    concept_id: string | null;
    keyword_title: string | null;
    question_text: string | null;
    correct_choice_number: number | null;
    correct_choice_summary: string | null;
    choice_explanations: ChoiceExplanation[] | null;
  };
  const expByQuestionId = new Map<string, ExpRow>();
  for (const ids of chunk(questionIds, 100)) {
    const rows = await fetchAll<ExpRow>(
      admin,
      "question_explanations",
      "question_id, concept_id, keyword_title, question_text, correct_choice_number, correct_choice_summary, choice_explanations",
      (q) => q.in("question_id", ids),
    );
    for (const r of rows) {
      const hit = r.concept_id
        ? wantedIds.has(r.concept_id)
        : wantedTitles.has((r.keyword_title ?? "").trim());
      if (hit) expByQuestionId.set(r.question_id, r);
    }
  }
  if (expByQuestionId.size === 0) return [];

  // 개념별로 후보를 모아 미극복 → 많이 틀린 순으로 자른다.
  type Candidate = { row: ExpRow; status: (typeof statusRows)[number]; subject: string | null };
  const byConcept = new Map<string, Candidate[]>();
  for (const st of statusRows) {
    const qid = questionIdByKey.get(questionKey(st.paper_id, st.question_number));
    if (!qid) continue;
    const exp = expByQuestionId.get(qid);
    if (!exp) continue;
    const ckey = exp.concept_id ?? `kw:${(exp.keyword_title ?? "").trim()}`;
    if (!displayByKey.has(ckey)) continue;
    const list = byConcept.get(ckey) ?? [];
    list.push({ row: exp, status: st, subject: paperSubject.get(st.paper_id) ?? null });
    byConcept.set(ckey, list);
  }

  const picked: Candidate[] = [];
  for (const list of byConcept.values()) {
    list.sort(
      (a, b) =>
        Number(a.status.last_is_correct) - Number(b.status.last_is_correct) ||
        b.status.wrong_count - a.status.wrong_count,
    );
    picked.push(...list.slice(0, perConcept));
  }
  if (picked.length === 0) return [];

  // "내가 고른 선지": 뽑힌 문항에 한해 CBT 응시 기록에서 틀린 선택을 찾는다.
  const pickedPaperIds = [...new Set(picked.map((c) => c.status.paper_id))];
  const attempts = await fetchAll<{ id: string; paper_id: string }>(
    admin,
    "cbt_attempts",
    "id, paper_id",
    (q) => q.eq("user_id", userId).in("paper_id", pickedPaperIds),
  );
  const attemptPaper = new Map(attempts.map((a) => [a.id, a.paper_id]));
  const chosenByKey = new Map<string, number>();
  for (const ids of chunk([...attemptPaper.keys()], 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{
      attempt_id: string;
      question_number: number;
      selected_choice: number | null;
      is_correct: boolean | null;
    }>(
      admin,
      "cbt_attempt_answers",
      "attempt_id, question_number, selected_choice, is_correct",
      (q) => q.in("attempt_id", ids),
    );
    for (const r of rows) {
      if (r.is_correct || r.selected_choice == null) continue;
      const paperId = attemptPaper.get(r.attempt_id);
      if (!paperId) continue;
      // 여러 번 틀렸으면 마지막 선택이 남는다(가장 최근의 오개념).
      chosenByKey.set(questionKey(paperId, r.question_number), r.selected_choice);
    }
  }

  return picked.map(({ row, status, subject }) => {
    const pickedChoice = chosenByKey.get(questionKey(status.paper_id, status.question_number)) ?? null;
    const choiceRow =
      pickedChoice != null
        ? (row.choice_explanations ?? []).find((c) => c?.number === pickedChoice)
        : undefined;
    const reason = choiceRow
      ? [choiceRow.verdict_label, choiceRow.explanation].filter(Boolean).join(" — ")
      : null;
    const conceptKey = row.concept_id ?? `kw:${(row.keyword_title ?? "").trim()}`;
    return {
      conceptKey,
      concept: displayByKey.get(conceptKey) ?? (row.keyword_title ?? "").trim(),
      subject,
      questionText: truncate(row.question_text, 200),
      correctChoice: row.correct_choice_number,
      correctSummary: truncate(row.correct_choice_summary),
      pickedChoice,
      pickedReason: truncate(reason),
      wrongTimes: status.wrong_count,
      resolved: status.last_is_correct,
    };
  });
}
