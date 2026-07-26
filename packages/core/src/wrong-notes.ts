// 오답노트 집계 — 웹·모바일 공유(순수 함수).
//
// 웹 src/lib/wrong-notes.ts 가 정본이지만 그 파일은 server-only(admin 클라이언트·
// service_role 조회)라 통째로는 공유할 수 없다. 조회 결과만 받아 계산하는 부분,
// 즉 타입과 buildWrongNoteGroups 를 여기로 올려 모바일이 같은 판정을 쓰게 한다.
// (모바일 오답노트는 지금 lib/mypage.ts 의 근사치라 웹과 숫자가 어긋난다 — 이 함수를
//  쓰면 같은 규칙이 된다.)
import type { ExamType, Subject } from "./types";

// 오답노트 화면들이 exam_papers에서 실제로 쓰는 필드만 추린 형태.
export type WrongNotePaperInfo = {
  id: string;
  title: string;
  level: string | null;
  choice_count: number;
  subjects: Subject | null;
  exam_types: ExamType | null;
};

// 오답노트 집계에 필요한 최소한의 응시 행. 마이페이지처럼 이미 응시 목록을
// 들고 있는 호출부는 그 데이터를 그대로 넘겨 재조회를 피할 수 있다.
export type WrongNoteAttemptRow = {
  id: string;
  created_at: string;
  // 있으면 buildWrongNoteGroups가 문제지별 "최근 점수"까지 채운다
  // (과목 오답노트의 문제지 카드처럼 점수를 함께 보여주는 화면용).
  score?: number;
  total_questions?: number;
  exam_papers: WrongNotePaperInfo | null;
};

// 문제 하나가 응시 이력 전체에서 어떻게 틀렸는지 요약한 값.
export type WrongNoteQuestionSummary = {
  questionNumber: number;
  // 여러 번 응시했으면 틀릴 때마다 1씩 늘어난다 ("2번 틀림" 배지용).
  wrongCount: number;
  // 이 문제지의 가장 최근 응시에서는 맞혔는지 ("극복" 배지/필터용).
  resolved: boolean;
  // 가장 최근에 틀렸을 때 고른 답 (null이면 풀지 않고 넘어간 문제).
  lastSelectedChoice: number | null;
};

export type WrongNotePaperGroup = {
  paper: WrongNotePaperInfo;
  attemptCount: number;
  lastAttemptAt: string;
  // 응시 행에 score/total_questions가 없으면 null (마이페이지 탭은 안 쓴다).
  latestScore: number | null;
  latestTotal: number | null;
  questions: WrongNoteQuestionSummary[];
  unresolvedCount: number;
  resolvedCount: number;
};

export type WrongNoteSubjectGroup = {
  subject: Subject;
  papers: WrongNotePaperGroup[];
  unresolvedCount: number;
  resolvedCount: number;
};

export type WrongAnswerRow = {
  attempt_id: string;
  question_number: number;
  selected_choice: number | null;
};

// 오답노트 문항 마크. deleted는 오답노트에서 완전히 제외한 문항(실수/지엽 문항),
// pinned는 "다시 볼 문제" 체크. 키는 `${paper_id}#${question_number}`.
// 응시 원본은 건드리지 않고 조회·집계·섞어풀기 후보에서만 걸러내는 방식이라,
// 테이블이 아직 없는 환경에서도(마이그레이션 전) 빈 마크로 안전하게 동작한다.
export type WrongNoteMarks = { deleted: Set<string>; pinned: Set<string> };

export const EMPTY_MARKS: WrongNoteMarks = { deleted: new Set(), pinned: new Set() };

// 전국 오답률 배지를 보여줄 최소 표본. 응시자가 몇 명 안 되는 문항의 "오답률 100%" 는
// 오해를 주므로 이 수 미만이면 배지를 숨긴다. 웹·앱이 같은 기준을 써야 같은 문항에서
// 같은 배지가 뜬다.
export const WRONGRATE_MIN_SAMPLE = 10;

// attempts/wrongs 집계를 배지에 쓸 퍼센트로. 표본이 모자라면 null(= 배지 숨김).
export function wrongRatePct(attempts: number, wrongs: number): number | null {
  if (attempts < WRONGRATE_MIN_SAMPLE) return null;
  return Math.round((wrongs / attempts) * 100);
}

// 응시 목록 + 오답 행을 과목 → 문제지 → 문제 순으로 묶는다. "몇 번 틀렸는지"와
// "가장 최근 응시에서는 맞혔는지(극복)"까지 여기서 한 번에 계산해서, 화면들은
// 이 결과를 그대로 그리기만 하면 된다.
export function buildWrongNoteGroups(
  attempts: WrongNoteAttemptRow[],
  wrongRows: WrongAnswerRow[],
  // 완전 삭제된 문항(`${paperId}#${qnum}`)은 집계에서 뺀다.
  deletedKeys?: Set<string>,
  // user_question_status(CBT+섞어풀기 통합) 기준 극복 여부. 있으면 "가장 최근 CBT
  // 응시에서 맞았는지"보다 우선한다 — 섞어풀기로 극복한 문항이 시험지별 보기에도
  // 즉시 반영되게 하려는 것(문항 모아보기 쪽과 판정 기준을 맞춤). 키는
  // `${paperId}#${questionNumber}`.
  statusOverrides?: Map<string, boolean>,
): WrongNoteSubjectGroup[] {
  const paperByAttempt = new Map<string, string>();
  for (const a of attempts) {
    if (a.exam_papers) paperByAttempt.set(a.id, a.exam_papers.id);
  }
  const wrongByAttempt = new Map<string, WrongAnswerRow[]>();
  for (const row of wrongRows) {
    if (deletedKeys?.size) {
      const paperId = paperByAttempt.get(row.attempt_id);
      if (paperId && deletedKeys.has(`${paperId}#${row.question_number}`)) continue;
    }
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    wrongByAttempt.set(row.attempt_id, list);
  }

  // 문제지가 삭제된 응시는 문제 이미지도 정답도 보여줄 수 없으므로 집계에서 뺀다.
  const attemptsByPaper = new Map<string, WrongNoteAttemptRow[]>();
  for (const a of attempts) {
    if (!a.exam_papers) continue;
    const list = attemptsByPaper.get(a.exam_papers.id) ?? [];
    list.push(a);
    attemptsByPaper.set(a.exam_papers.id, list);
  }

  const paperGroups: WrongNotePaperGroup[] = [];
  for (const list of attemptsByPaper.values()) {
    const sorted = [...list].sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime(),
    );
    const latest = sorted[0];
    const paperId = latest.exam_papers!.id;
    const wrongInLatest = new Set(
      (wrongByAttempt.get(latest.id) ?? []).map((r) => r.question_number),
    );

    // 최신 응시부터 훑으므로, 문제를 처음 만났을 때의 선택지가 "가장 최근에 고른 답"이 된다.
    const byNumber = new Map<number, WrongNoteQuestionSummary>();
    for (const attempt of sorted) {
      for (const row of wrongByAttempt.get(attempt.id) ?? []) {
        const existing = byNumber.get(row.question_number);
        if (existing) {
          existing.wrongCount++;
        } else {
          const override = statusOverrides?.get(`${paperId}#${row.question_number}`);
          byNumber.set(row.question_number, {
            questionNumber: row.question_number,
            wrongCount: 1,
            resolved: override ?? !wrongInLatest.has(row.question_number),
            lastSelectedChoice: row.selected_choice,
          });
        }
      }
    }
    if (byNumber.size === 0) continue;

    const questions = [...byNumber.values()].sort(
      (a, b) => a.questionNumber - b.questionNumber,
    );
    const unresolvedCount = questions.filter((q) => !q.resolved).length;
    paperGroups.push({
      paper: latest.exam_papers!,
      attemptCount: sorted.length,
      lastAttemptAt: latest.created_at,
      latestScore: latest.score ?? null,
      latestTotal: latest.total_questions ?? null,
      questions,
      unresolvedCount,
      resolvedCount: questions.length - unresolvedCount,
    });
  }

  const bySubject = new Map<string, WrongNoteSubjectGroup>();
  for (const group of paperGroups) {
    const subject = group.paper.subjects;
    if (!subject) continue;
    const existing = bySubject.get(subject.id);
    if (existing) {
      existing.papers.push(group);
      existing.unresolvedCount += group.unresolvedCount;
      existing.resolvedCount += group.resolvedCount;
    } else {
      bySubject.set(subject.id, {
        subject,
        papers: [group],
        unresolvedCount: group.unresolvedCount,
        resolvedCount: group.resolvedCount,
      });
    }
  }

  const groups = [...bySubject.values()];
  for (const g of groups) {
    g.papers.sort(
      (a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime(),
    );
  }
  groups.sort(
    (a, b) =>
      a.subject.display_order - b.subject.display_order ||
      a.subject.name.localeCompare(b.subject.name, "ko"),
  );
  return groups;
}
