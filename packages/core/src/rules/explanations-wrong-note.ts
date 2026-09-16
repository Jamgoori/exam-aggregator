import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../format";
import { paperDedupKey, type DedupablePaper } from "../dedup-papers";
import { fetchPaperIdentitySignals } from "../data/dedup-signals";
import { fetchQuestionMedia, type QuestionMediaEntry } from "../data/question-media";
import {
  fetchCorrectAnswers,
  fetchExplainedNumbers,
  fetchExplanations,
} from "../data/wrong-notes";
import type { QuestionExplanationContent } from "./explanations";

// 오답노트·응시 상세·mix 기록 **안에서** 여는 해설(설계서 §6.7 #7 `context:"wrong-note"`).
//
// 해설 페이지 모드(rules/explanation-access.ts)와는 규칙이 다르다. 웹에서 이 자리의 해설은
// `lib/wrong-notes.ts` 가 `includeExplanations = premium` 으로 **admin 클라이언트**를 써서
// 곧바로 조회하고(`fetchExplanations(createAdminClient(), …)`, `:174-179`),
// `explanation_access_log`·`explanation_daily_views` 를 **한 줄도 쓰지 않는다** — 즉
// 시간당 한도(40회)도 무료 일일 몫(문제지 3개)도 이 경로에서는 판정하지 않는다. 대신
// 멤버십이 없으면 본문 자체를 조회하지 않고 "해설이 있는 문항"만 표시해 잠금 자리를 그린다
// (`apps/web/src/app/mypage/attempts/[attemptId]/page.tsx:46-49` 주석: "점수·틀린 문항
// 확인은 CBT 의 일부라 무료 회원에게도 그대로 열어둔다. 해설만 멤버십 기준을 따른다 —
// 여기서 전부 내주면 '무료는 하루 문제지 3개'라는 한도가 이 화면으로 통째로 샌다").
//
// 앱은 웹과 달리 **클라이언트가 문항 번호를 보내온다.** 웹은 서버가 사용자의 오답 행에서
// 목록을 만들어 그리므로 "내가 푼 문항"이 구조적으로 보장되지만, 앱에서는 요청을 그대로
// 믿으면 아무 문제지의 해설이나 받아 갈 수 있다(= 해설 페이지의 한도를 우회하는 새 경로).
// 그래서 서버가 **본인이 답한 문항**으로 한 번 더 좁힌다 — 판정 기준은 RPC
// `own_wrong_answers`(schema.sql, §6.7 #3)와 같다:
//   · 요청 `paperId` 또는 **같은 dedup 그룹의 형제 paperId** 에
//   · `user_question_status` 행이나 `cbt_attempt_answers` 행(`selected_choice` null 포함)이 있으면
//   · "답한 문항"으로 본다.
//
// **RPC 를 부르지 않고 같은 조인을 여기에 구현한 이유**(설계서 §6.7 #7 "#3 과 같은 형제
// paper_id 매핑을 쓴다"):
//   1. `own_wrong_answers` 는 `security definer` + `auth.uid()` 기반이라 호출자의 JWT 가
//      있어야 한다. 이 규칙을 부르는 Edge 어댑터가 가진 것은 service_role 클라이언트뿐이고
//      (`_shared/clients.ts#coreAdmin`), 그걸로 RPC 를 부르면 `auth.uid()` 가 null 이라
//      함수 첫 줄에서 `raise exception 'not authenticated'` 가 난다.
//   2. 그 RPC 는 **정답(`correct_choice`)** 을 돌려준다. 해설 모드에 정답은 필요 없고,
//      필요 없는 값을 실어 오는 경로를 늘리지 않는다(앱은 정답을 `own_wrong_answers` 로
//      따로 받고 그 결과는 디스크에 남기지 않는다 — apps/mobile/AGENTS.md).
//   3. 규칙은 웹 서버 액션도 같이 불러야 한다(§6.8). 호출자의 세션에 의존하는 규칙은
//      두 어댑터가 공유할 수 없다.
// 형제 판정의 재료(`paperDedupKey` + 정답 지문)는 RPC 가 "SQL 판"으로 옮겨 적은 core 원본
// (`dedup-papers.ts`·`data/dedup-signals.ts`)을 그대로 쓴다 — 두 판정이 갈리면 형제 문제지
// 응시자만 해설을 못 받는다.

// 한 번에 물어볼 수 있는 문항 수. 오답노트 화면 한 장(문제지 1장 40~50문항)을 넉넉히 덮으면서
// 문제지 통째 크롤링을 한 요청으로 하지는 못하게 하는 상한이다.
export const WRONG_NOTE_QUESTION_LIMIT = 100;

export type WrongNoteExplanationQuestion = {
  questionNumber: number;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent;
};

export type WrongNoteExplanations = {
  // 프리미엄일 때만 채워진다(본문 포함). 비프리미엄은 언제나 빈 배열 — 잠금은 CSS 가 아니라
  // "본문이 서버를 떠나지 않는다"로 만든다(data/wrong-notes.ts#fetchExplainedNumbers 주석).
  questions: WrongNoteExplanationQuestion[];
  // 해설이 등록돼 있고 본인이 답했지만 본문을 내주지 않은 문항 번호(잠금 자리용).
  lockedQuestionNumbers: number[];
  // 멤버십이 아니라 본문을 막았는가(= lockedQuestionNumbers 가 잠금 자리라는 뜻).
  locked: boolean;
  // 본인이 답한 문항 중 해설이 등록된 문항 수(잠금 포함).
  totalCount: number;
};

type AnsweredInput = { paperId: string; questionNumbers: number[] };

// dedup 계산에 필요한 필드(rules/status-targets.ts 와 같은 select).
const DEDUP_SELECT = "id, subject_id, exam_type_id, year, round, level, track, title, created_at";

// 요청 문제지와 같은 dedup 그룹(= 같은 메타데이터 + 같은 정답 지문)인 문제지 id 목록.
// 요청 문제지 자신이 언제나 첫 항목이다. RPC own_wrong_answers 의 `ident`/`siblings` CTE 와
// 같은 기준이며, 정답이 등록되지 않아 지문을 만들 수 없는 문제지는 그 SQL 에서도 형제가
// 없으므로(`join paper_answers`) 여기서도 자기 자신만 돌려준다.
async function fetchSiblingPaperIds(
  admin: SupabaseClient,
  paperId: string,
): Promise<string[]> {
  const { data: baseRow } = await admin
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .eq("id", paperId)
    .maybeSingle();
  const base = baseRow as unknown as DedupablePaper | null;
  if (!base) return [paperId];

  let query = admin
    .from("exam_papers")
    .select(DEDUP_SELECT)
    .eq("subject_id", base.subject_id)
    .eq("exam_type_id", base.exam_type_id)
    .eq("year", base.year)
    .eq("round", base.round);
  query = base.level == null ? query.is("level", null) : query.eq("level", base.level);
  const { data: candidateRows } = await query;

  const candidates = ((candidateRows ?? []) as unknown as DedupablePaper[]).filter(
    (p) => paperDedupKey(p) === paperDedupKey(base),
  );
  const others = candidates.filter((p) => p.id !== paperId).map((p) => p.id);
  if (others.length === 0) return [paperId];

  // 메타데이터가 같아도 정답 지문이 다르면 다른 시험지다(dedup-papers.ts 의 유일한 분리 근거).
  // 지문이 없는(정답 미등록) 문제지는 SQL 판과 같이 형제로 치지 않는다.
  const signals = await fetchPaperIdentitySignals(admin, [paperId, ...others], admin);
  const baseSig = signals.get(paperId)?.answerSignature ?? null;
  if (baseSig == null) return [paperId];
  return [
    paperId,
    ...others.filter((id) => (signals.get(id)?.answerSignature ?? null) === baseSig),
  ];
}

// 본인이 답한 문항 번호. RPC own_wrong_answers 와 같은 판정: 형제 문제지 어디든
// user_question_status 행이나 cbt_attempt_answers 행이 있으면 "답했다"(건너뛴 문항 포함 —
// 웹 응시 상세가 selected_choice null 인 문항에도 정답·해설을 보여준다).
export async function fetchAnsweredQuestionNumbers(
  admin: SupabaseClient,
  userId: string,
  input: AnsweredInput,
): Promise<Set<number>> {
  const answered = new Set<number>();
  const numbers = [...new Set(input.questionNumbers)];
  if (numbers.length === 0) return answered;

  const paperIds = await fetchSiblingPaperIds(admin, input.paperId);

  const { data: statusRows } = await admin
    .from("user_question_status")
    .select("question_number")
    .eq("user_id", userId)
    .in("paper_id", paperIds)
    .in("question_number", numbers);
  for (const r of (statusRows ?? []) as { question_number: number }[]) {
    answered.add(r.question_number);
  }
  if (answered.size === numbers.length) return answered;

  // cbt_attempt_answers 는 응시 id 로만 걸려 있어 두 단계로 나눈다(임베드 필터를 쓰지 않는
  // 이유는 data/wrong-notes.ts#fetchExplanations 주석과 같다).
  const { data: attemptRows } = await admin
    .from("cbt_attempts")
    .select("id")
    .eq("user_id", userId)
    .in("paper_id", paperIds);
  const attemptIds = ((attemptRows ?? []) as { id: string }[]).map((r) => r.id);
  for (const ids of chunk(attemptIds, 100)) {
    const { data } = await admin
      .from("cbt_attempt_answers")
      .select("question_number")
      .in("attempt_id", ids)
      .in("question_number", numbers);
    for (const r of (data ?? []) as { question_number: number }[]) {
      answered.add(r.question_number);
    }
  }
  return answered;
}

// `explanations-get` 의 wrong-note 모드 본문. Edge 어댑터(supabase/functions/explanations-get)와
// 웹(오답노트가 지금 쓰는 조회를 이 함수로 모을 때)이 같은 판정을 쓴다.
//
// 쿼터·로그는 **일부러** 건드리지 않는다 — 이 함수 안에 explanation_access_log 나
// explanation_daily_views 를 쓰는 코드가 생기면 웹 오답노트와 앱이 갈라진다(웹은 admin
// 조회라 한 줄도 남기지 않는다). 그 대신 "본인이 답한 문항"으로 범위가 좁혀져 있다.
export async function resolveWrongNoteExplanations(
  admin: SupabaseClient,
  input: {
    userId: string;
    paperId: string;
    questionNumbers: number[];
    premium: boolean;
  },
): Promise<WrongNoteExplanations> {
  const requested = [
    ...new Set(
      input.questionNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 300),
    ),
  ].slice(0, WRONG_NOTE_QUESTION_LIMIT);
  const empty: WrongNoteExplanations = {
    questions: [],
    lockedQuestionNumbers: [],
    locked: !input.premium,
    totalCount: 0,
  };
  if (requested.length === 0) return empty;

  const answered = await fetchAnsweredQuestionNumbers(admin, input.userId, {
    paperId: input.paperId,
    questionNumbers: requested,
  });
  const numbers = requested.filter((n) => answered.has(n)).sort((a, b) => a - b);
  if (numbers.length === 0) return empty;

  const wanted = new Map<string, Set<number>>([[input.paperId, new Set(numbers)]]);

  // 무료 회원에게는 본문을 아예 조회하지 않는다("있음/없음"만) — 웹 includeExplanations=false
  // 경로와 같다(lib/wrong-notes.ts:689-693).
  if (!input.premium) {
    const explained = await fetchExplainedNumbers(admin, [input.paperId], wanted);
    const lockedQuestionNumbers = numbers.filter(
      (n) => explained.get(input.paperId)?.has(n) ?? false,
    );
    return {
      questions: [],
      lockedQuestionNumbers,
      locked: true,
      totalCount: lockedQuestionNumbers.length,
    };
  }

  const [mediaByPaper, answersByPaper, explanationsByPaper] = await Promise.all([
    fetchQuestionMedia(admin, [input.paperId], wanted),
    fetchCorrectAnswers(admin, [input.paperId]),
    fetchExplanations(admin, [input.paperId], wanted),
  ]);
  const media: Map<number, QuestionMediaEntry> =
    mediaByPaper.get(input.paperId) ?? new Map();
  const correctAnswers = answersByPaper.get(input.paperId) ?? [];
  const explanations = explanationsByPaper.get(input.paperId) ?? new Map();

  const questions: WrongNoteExplanationQuestion[] = [];
  for (const questionNumber of numbers) {
    const explanation = explanations.get(questionNumber);
    if (!explanation) continue; // 해설 없는 문항은 뺀다(페이지 모드와 동일).
    const m = media.get(questionNumber);
    questions.push({
      questionNumber,
      correctChoice: correctAnswers[questionNumber - 1] ?? null,
      choiceCount: m?.choiceCount ?? 4,
      images: m?.images ?? [],
      explanation,
    });
  }

  return {
    questions,
    lockedQuestionNumbers: [],
    locked: false,
    totalCount: questions.length,
  };
}
