import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../format";
import type { WrongQuestionSample } from "../diagnosis-coach";

// 맞춤 극복법 프롬프트에 넣을 **오답 문항 표본**. 웹 `lib/diagnosis-live.ts` 의 같은 이름
// 함수를 그대로 옮긴 것이다(설계서 §6.8).
//
// 왜 옮겼나: 이 조회가 웹에만 있으면 Edge `diagnosis-request` 는 프롬프트 입력을 만들 수
// 없어 배치를 제출하지 못하고, 앱 요청은 다시 "시간당 크론이 집어 갈 때까지 기다리는" 자리로
// 돌아간다. 사본을 만들면 표본 수·자르는 길이가 갈라져 같은 사용자가 경로에 따라 다른
// 요금·다른 품질의 진단을 받는다.
//
// ⚠ **이 함수의 결과는 응답으로 나가지 않는다.** 발문·정답·선지 해설이 통째로 들어 있어
// (정답은 RLS 로 막아 둔 값이다) 모델 요청 본문을 만드는 데만 쓰고 버린다. 호출부는 반드시
// 본인(userId) 확인을 끝낸 뒤에만 부를 것.
//
// ⚠ **비용이 여기서 결정된다** — 문항당 약 300자를 넣으므로 개념당 문항 수(perConcept)와
// 아래 truncate 길이가 곧 1회 요금이다. 함부로 늘리지 말 것. 문제 이미지·해설 전문은 넣지
// 않는다(문항당 1,000자를 넘겨 요금이 10배가 된다).

type Admin = SupabaseClient;

// supabase 쿼리 빌더 체인은 타입이 복잡해 여기선 느슨하게 받는다(런타임 안전).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryApply = (q: any) => any;

async function fetchAll<T>(
  admin: Admin,
  table: string,
  columns: string,
  apply: QueryApply,
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
//
// question_explanations/paper_answers 는 service_role 만 읽으므로 admin 클라이언트로 돈다.
export async function getWrongQuestionSamples(
  admin: Admin,
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
