"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";
import {
  createReviewSessionForUser,
  createReviewSessionFromItems,
  filterQuestionsAnsweredByUser,
  createConceptReviewSessionForUser,
  createAllReviewSessionForUser,
  createDueReviewSessionForUser,
  createPaperReviewSessionForUser,
  findUnfinishedDueSession,
  markReviewItemGuessed,
  submitReviewSessionForUser,
  type ReviewSessionView,
} from "@/lib/review-session";
import {
  collectDueQueueItems,
  collectExtraQueueItems,
  getDueReviewSummary,
  getSessionSchedule,
} from "@/lib/review-queue";
import {
  setSubjectPaused,
  setDailyLimit,
  spreadOverdueBacklog,
  restoreSuspendedQuestions,
  type SetDailyLimitResult,
  type SpreadBacklogResult,
} from "@/lib/review-preferences";
import { isPremium } from "@/lib/membership";
import {
  createMixSessionForUser,
  createRetryFromMixSession,
  type CreateMixSessionResult,
} from "@/lib/mix-practice";
import type { SessionSchedule, ReviewPickStrategy } from "@gongmoa/core";

export type CreateReviewResult = { error?: string; sessionId?: string };

// 오답노트는 열람도, 정리(메모·다시 볼 문제·삭제)도, 섞어풀기(내가 고른 오답을 모아
// 다시 푸는 것)도 무료다 — 전부 자기 데이터를 자기가 다시 보는 일이고, 섞어풀기
// 화면은 해설을 보여주지 않는다.
//
// 멤버십으로 남는 것은 해설 본문과 "오늘의 복습"(간격 반복 일정), AI 약점 진단이다.
// 복습은 세션을 만드는 것 말고도 스케줄을 다시 뿌리는 쓰기(밀린 복습 정리·과목
// 재개·접어둔 문항 되살리기)가 붙어 있어, 화면에서 버튼을 숨기는 것과 별개로 서버
// 액션마다 다시 확인한다 — 서버 액션은 이름만 알면 직접 부를 수 있다.
const REVIEW_LOCKED = "오늘의 복습(간격 반복)은 멤버십 기능이에요.";

// 클라이언트가 보내는 값이라 문자열을 그대로 믿지 않는다. 모르는 값은 기본값
// ("약한 문제 우선")으로 떨어뜨린다.
function pickStrategy(value: unknown): ReviewPickStrategy {
  return value === "random" ? "random" : "weighted";
}

// 섞어풀기 세션 시작. 성공하면 sessionId를 돌려주고, 호출부(클라이언트)가 풀이
// 페이지로 이동한다.
export async function createReviewSession(input: {
  subjectSlug: string;
  onlyUnresolved?: boolean;
  onlyDue?: boolean;
  limit?: number;
  strategy?: ReviewPickStrategy;
}): Promise<CreateReviewResult> {
  const slug = String(input?.subjectSlug ?? "");
  if (!slug) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  // 과목 섞어풀기 자체는 무료지만 onlyDue(복습)는 "오늘의 복습"과 같은 간격 반복
  // 기능이라 멤버십을 확인한다 — 전 과목판인 createReviewAll 과 같은 기준이다.
  // 여기만 빠져 있어서, 화면 요청에 onlyDue: true 만 붙이면 과목별 복습이 무료로 열렸다.
  if (input?.onlyDue && !(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }

  return createReviewSessionForUser(supabase, user.id, {
    subjectSlug: slug,
    onlyUnresolved: input.onlyUnresolved ?? true,
    onlyDue: input.onlyDue ?? false,
    limit: input.limit,
    strategy: pickStrategy(input.strategy),
  });
}

// 진단의 "같은개념 기출 5문제 풀기". 유저 오답이 아니라 기출 전체에서 같은 개념
// (keyword_title) 문항을 랜덤으로 뽑아 세션을 만든다(있는 만큼).
export async function createReviewFromConcept(input: {
  concept: string;
  conceptId?: string | null;
  subjectSlug?: string | null;
  limit?: number;
}): Promise<CreateReviewResult> {
  const concept = String(input?.concept ?? "").trim();
  const conceptId = input?.conceptId ? String(input.conceptId) : null;
  if (!concept && !conceptId) return { error: "개념을 찾을 수 없어요." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) return { error: REVIEW_LOCKED };

  return createConceptReviewSessionForUser(supabase, user.id, {
    concept,
    conceptId,
    subjectSlug: input.subjectSlug ?? null,
    limit: input.limit ?? 5,
  });
}

export type SaveMemoResult = { error?: string; memo?: string };

// 문항 메모 저장/삭제. 빈 문자열이면 삭제한다. paper_id는 오답노트에 실제로 뜬(대표)
// 문제지 id를 그대로 쓴다.
export async function saveQuestionMemo(input: {
  paperId: string;
  questionNumber: number;
  memo: string;
}): Promise<SaveMemoResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const memo = String(input.memo ?? "").trim().slice(0, 2000);

  if (!memo) {
    await supabase
      .from("question_memos")
      .delete()
      .eq("user_id", user.id)
      .eq("paper_id", paperId)
      .eq("question_number", questionNumber);
    return { memo: "" };
  }

  const { error } = await supabase.from("question_memos").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      memo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "메모 저장에 실패했어요." };
  return { memo };
}

export type MarkResult = { error?: string };

// "다시 볼 문제" 체크 토글. paper_id는 오답노트에 뜬(대표) 문제지 id를 그대로 쓴다.
export async function setQuestionPinned(input: {
  paperId: string;
  questionNumber: number;
  pinned: boolean;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      pinned: Boolean(input.pinned),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "저장에 실패했어요." };
  return {};
}

// 오답노트에서 문항 완전 삭제(실수로 틀렸거나 지엽 문항). 응시 원본은 남기고
// 오답노트 조회·집계·섞어풀기 후보에서만 제외한다.
export async function deleteWrongNoteQuestion(input: {
  paperId: string;
  questionNumber: number;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      deleted: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "삭제에 실패했어요." };
  return {};
}

// 완전 삭제 직후 "되돌리기". 삭제 마크만 해제한다(응시 원본은 애초에 안 지웠다).
export async function restoreWrongNoteQuestion(input: {
  paperId: string;
  questionNumber: number;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "되돌리지 못했어요." };
  return {};
}

// 시험지별 틀린문제 다시풀기(1개) / 여러 시험지 합쳐 풀기(다중).
export async function createReviewFromPapers(input: {
  paperIds: string[];
}): Promise<CreateReviewResult> {
  const paperIds = Array.isArray(input?.paperIds)
    ? input.paperIds.filter((id) => typeof id === "string" && id)
    : [];
  if (paperIds.length === 0) return { error: "시험지를 선택해주세요." };
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  return createPaperReviewSessionForUser(supabase, user.id, paperIds);
}

// 전 과목 섞어풀기/복습(과목 무관). onlyDue=복습, includeResolved=극복 포함.
export async function createReviewAll(input: {
  onlyDue?: boolean;
  includeResolved?: boolean;
  strategy?: ReviewPickStrategy;
}): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  // 전 과목 섞어풀기는 과목 섞어풀기와 같은 성격이라 무료다. onlyDue(복습)만
  // "오늘의 복습"과 같은 기능이므로 여기서 멤버십을 확인한다.
  if (input?.onlyDue && !(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }
  return createAllReviewSessionForUser(supabase, user.id, {
    onlyDue: input?.onlyDue ?? false,
    includeResolved: input?.includeResolved ?? false,
    strategy: pickStrategy(input?.strategy),
  });
}

// 오늘의 복습 세션 시작(유료 전용). 문항 선정·순서는 서버가 정한다 — 클라이언트가
// 문항 목록을 넘기게 하면 상한과 스케줄을 우회할 수 있다.
//
// 멤버십 확인을 여기서 한 번 더 하는 이유: 화면에서 버튼을 숨기는 건 표시일 뿐이고,
// 서버 액션은 URL만 알면 직접 부를 수 있다.
export async function createDueReviewSession(): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }

  // 두고 나온 세션이 있으면 새로 만들지 않고 그리로 보낸다. 새로 만들면 기기에
  // 저장해 둔 답이 안 붙고(세션 id로 키를 잡는다), 미제출 세션만 계속 쌓인다.
  const resumable = await findUnfinishedDueSession(supabase, user.id);
  if (resumable) return { sessionId: resumable.sessionId };

  const items = await collectDueQueueItems(supabase, user.id);
  return createDueReviewSessionForUser(supabase, user.id, items);
}

// "찍었어요" — 맞힌 문항의 복습 스케줄만 되돌린다. 점수와 극복 판정은 그대로다.
//
// 멤버십으로 막지 않는다. 표시 자체(review_session_items.guessed)는 무료 사용자에게도
// 남겨야 나중에 결제했을 때 "그때 찍었다고 눌러둔 것"이 살아 있다. 스케줄이 없는
// 문항은 markReviewItemGuessed 안에서 조용히 넘어간다.
export async function markReviewGuessed(input: {
  sessionId: string;
  position: number;
}): Promise<{ error?: string }> {
  const sessionId = String(input?.sessionId ?? "");
  const position = Number(input?.position);
  if (!sessionId || !Number.isInteger(position) || position < 0) {
    return { error: "잘못된 접근입니다." };
  }

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  return markReviewItemGuessed(supabase, user.id, sessionId, position);
}

// "복습 더하기"(유료 전용) — 오늘치를 끝낸 사람이 대기 풀에서 한 묶음 더 당겨 푼다.
export async function createExtraReviewSession(): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }

  const { items, error } = await collectExtraQueueItems(supabase, user.id);
  if (error) return { error };
  return createDueReviewSessionForUser(supabase, user.id, items);
}

export type RestoreSuspendedActionResult = { error?: string; restoredCount?: number };

// 접어둔(leech) 문항을 다시 복습에 넣는다(유료 전용). 되살린 문항의 복습일을 며칠에
// 걸쳐 다시 뿌리는 쓰기가 붙으므로 여기서도 멤버십을 막는다.
export async function restoreSuspendedReview(): Promise<RestoreSuspendedActionResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }
  return restoreSuspendedQuestions(supabase, user.id);
}

export type ToggleReviewSubjectResult = { error?: string; pausedSubjectIds?: string[] };

// 복습 과목 보류/재개(유료 전용). 재개 쪽은 밀린 문항의 srs_due_at 을 며칠에 걸쳐
// 다시 뿌리는 쓰기가 붙으므로, 화면에서 패널을 숨기는 것과 별개로 여기서도 막는다.
export async function toggleReviewSubjectPaused(input: {
  subjectId: string;
  paused: boolean;
}): Promise<ToggleReviewSubjectResult> {
  const subjectId = String(input?.subjectId ?? "");
  if (!subjectId) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }

  return setSubjectPaused(supabase, user.id, subjectId, input.paused === true);
}

// 하루 문항 수 변경(유료 전용). 값 검증은 setDailyLimit이 한다.
export async function setReviewDailyLimit(input: {
  limit: number;
}): Promise<SetDailyLimitResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }
  return setDailyLimit(supabase, user.id, Number(input?.limit));
}

// "밀린 복습 정리하기"(유료 전용). 연체된 문항의 srs_due_at 을 며칠에 걸쳐 다시
// 뿌리는 쓰기라, 화면에서 버튼을 숨기는 것과 별개로 여기서도 막는다.
export async function spreadReviewBacklog(): Promise<SpreadBacklogResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: REVIEW_LOCKED };
  }
  return spreadOverdueBacklog(supabase, user.id);
}

// 홈 복습 유도 모달이 마운트된 뒤 부르는 조회. 홈 서버 렌더에 복습 요약을 끼워
// 넣지 않는 이유: 요약 계산이 이미지 조회까지 도는 무거운 작업인데, 홈은 모두가
// 매번 여는 화면이고 모달은 하루 한 번만 뜬다. 오늘 이미 봤으면 이 액션 자체가
// 호출되지 않아 비용이 0이 된다.
export type ReviewNudge = {
  todayCount: number;
  subjects: { name: string; count: number }[];
};

export async function getReviewNudge(): Promise<ReviewNudge> {
  const empty: ReviewNudge = { todayCount: 0, subjects: [] };

  const { supabase, user } = await getSessionUser();
  if (!user) return empty;
  if (!(await isPremium(supabase, user.id))) return empty;

  const summary = await getDueReviewSummary(supabase, user.id);
  return {
    todayCount: summary.todayCount,
    subjects: summary.subjects.map((s) => ({ name: s.name, count: s.count })),
  };
}

export type ReviewScheduleResult = { premium: boolean; schedule?: SessionSchedule };

// 채점 결과 화면의 "다음 복습" 섹션. 무료 사용자는 스케줄 자체가 없으므로
// premium=false만 돌려주고 화면에서 섹션을 통째로 숨긴다.
export async function getReviewSchedule(input: {
  sessionId: string;
}): Promise<ReviewScheduleResult> {
  const sessionId = String(input?.sessionId ?? "");
  if (!sessionId) return { premium: false };

  const { supabase, user } = await getSessionUser();
  if (!user) return { premium: false };
  if (!(await isPremium(supabase, user.id))) return { premium: false };

  const schedule = await getSessionSchedule(supabase, user.id, sessionId);
  return { premium: true, schedule: schedule ?? undefined };
}

// 결과 화면 "틀린 N문항만 다시 풀기".
export async function createReviewFromWrong(input: {
  items: { paperId: string; questionNumber: number }[];
}): Promise<CreateReviewResult> {
  const items = Array.isArray(input?.items) ? input.items : [];
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // items 는 클라이언트가 만든 값이라 그대로 넘기지 않는다. 채점이 끝나면 세션 뷰가
  // 문항별 공식 정답을 실어 돌려주므로, 임의의 (문제지, 문항) 을 넣는 것만으로
  // 관리자 전용 RLS 로 잠가 둔 paper_answers 가 새어 나간다
  // (filterQuestionsAnsweredByUser 주석 참고). 내가 푼 적 있는 문항만 남긴다.
  const owned = await filterQuestionsAnsweredByUser(supabase, items);
  if (owned.length === 0) return { error: "다시 풀 문항이 없어요." };

  return createReviewSessionFromItems(supabase, user.id, owned);
}

// 기출 섞어풀기 시작 — 한 과목의 기출 전체(시행처 무관)에서 limit 개를 뽑아 세션을
// 만든다. 오답 섞어풀기와 같은 이유로 무료다(정답·해설을 화면에 싣지 않고, 채점 결과는
// 본인 오답노트로만 간다). 문항 수는 서버가 다시 정리한다(clampMixLimit).
//
// 비로그인이면 error 대신 login 플래그를 준다 — 시작 화면은 공개 페이지(과목 목록)에서
// 바로 열리므로, 호출부가 로그인 페이지로 보내고 돌아온 뒤 이어서 시작하게 한다.
export type StartMixResult = CreateMixSessionResult & { login?: boolean };

export async function createMixSession(input: {
  subjectSlug: string;
  limit?: number;
  // 급수 필터("9급"·"7급"…, 어느 등급에도 안 묶인 것은 MIX_NO_LEVEL). 비어 있으면 전체.
  levels?: string[];
  // 연도 범위. 둘 다 없으면 전체 — 값 정리는 서버(normalizeYearRange)가 한다.
  yearFrom?: number | null;
  yearTo?: number | null;
}): Promise<StartMixResult> {
  const slug = String(input?.subjectSlug ?? "");
  if (!slug) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요.", login: true };

  // 클라이언트가 보내는 값이라 문자열만, 길이도 묶는다. 실제 존재 여부는 서버 풀로 거른다.
  const levels = Array.isArray(input?.levels)
    ? input.levels.filter((l): l is string => typeof l === "string" && l.length <= 20).slice(0, 10)
    : [];

  return createMixSessionForUser(supabase, user.id, {
    subjectSlug: slug,
    limit: Number(input?.limit),
    levels,
    year: { from: input?.yearFrom ?? null, to: input?.yearTo ?? null },
  });
}

// 기출 섞어풀기 결과·기록 화면의 "틀린 문항만 다시 풀기". 문항 목록은 서버가 세션에서
// 직접 읽으므로(소유자 확인 포함) 클라이언트가 (문제지, 문항)을 보내지 않는다.
export async function createRetryFromMix(input: {
  sessionId: string;
}): Promise<CreateReviewResult> {
  const sessionId = String(input?.sessionId ?? "");
  if (!sessionId) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  return createRetryFromMixSession(supabase, user.id, sessionId);
}

export type SubmitReviewResult = { error?: string; view?: ReviewSessionView };

// 채점은 멤버십으로 막지 않는다. 세션을 만드는 경로가 전부 막혀 있으므로 무료 회원이
// 새로 풀기 시작할 수는 없고, 여기서 막으면 풀던 도중 체험이 끝난 사람의 답안이
// 통째로 날아간다 — 이미 한 일을 마무리하는 것까지 뺏을 이유가 없다("찍었어요"를
// 열어둔 것과 같은 이유).
export async function submitReviewSession(input: {
  sessionId: string;
  answers: (number | null)[];
}): Promise<SubmitReviewResult> {
  const sessionId = String(input?.sessionId ?? "");
  if (!sessionId) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const answers = Array.isArray(input.answers) ? input.answers : [];
  const result = await submitReviewSessionForUser(supabase, user.id, sessionId, answers);

  // 채점으로 극복 여부·남은 오답 수가 바뀐다. CBT 채점(papers/actions.ts)은 이미
  // /mypage 를 다시 그리게 하는데 여기만 빠져 있어서, 결과 화면에서 오답노트로
  // 돌아가면 채점 전 숫자가 그대로 보였다. 과목 오답노트는 [slug] 아래로 갈리므로
  // layout 단위로 걸어 하위 경로까지 함께 무효화한다.
  if (!result.error) {
    revalidatePath("/mypage");
    revalidatePath("/mypage/wrong-notes", "layout");
  }
  return result;
}
