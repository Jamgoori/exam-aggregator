import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  detectStudyPhase,
  inflowRatio,
  isPhaseTransition,
  PHASE_WINDOW_DAYS,
  type StudyPhase,
} from "@gongmoa/core";
import {
  getReviewPrefs,
  getStoredStudyPhase,
  saveStudyPhase,
} from "@/lib/review-preferences";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 학습 국면 조회. 판정 규칙은 @gongmoa/core 의 study-phase.ts 가 갖고 있고
// (웹·모바일 공유), 여기는 재료만 모은다.
//
// 조회를 가볍게 유지하는 게 중요하다 — 이 값은 마이페이지가 열릴 때마다 필요한데,
// 마이페이지는 이미 무거운 집계를 여럿 돌린다. 그래서:
//
//  - 유입은 cbt_attempts 의 (total_questions − score) 합으로 센다.
//    cbt_attempt_answers 를 훑으면 회독이 쌓인 계정에서 수만 행이 되는데, 국면
//    판정에 그 정밀도는 필요 없다(임계가 2.5/1.5로 러프하다).
//  - 재고는 head count 한 번. 0인지 아닌지만 규칙에 쓰이고, 정확한 수는
//    getUnresolvedCountBySubject 가 따로 낸다.
//  - 삭제 마크(wrong_note_marks.deleted)는 반영하지 않는다. 재고가 "0인가"를
//    가르는 데만 쓰이는데, 마크까지 보려면 조회가 한 번 더 는다.

export type StudyPhaseResult = {
  phase: StudyPhase;
  // 하루 유입 ÷ 하루 처리량. 화면이 "유입이 처리의 3배" 같은 설명에 쓴다.
  ratio: number;
  // 최근 창 안에 새로 틀린 문항 수.
  recentWrongCount: number;
  unresolvedTotal: number;
  dailyLimit: number;
  // 직전 판정과 달라졌는지. 전환 안내를 한 번만 띄우는 데 쓴다.
  transitioned: boolean;
};

async function fetchRecentWrongCount(
  supabase: Supabase,
  userId: string,
  since: Date,
): Promise<number> {
  const { data } = await supabase
    .from("cbt_attempts")
    .select("score, total_questions")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString());

  let wrong = 0;
  for (const row of (data ?? []) as { score: number | null; total_questions: number | null }[]) {
    // 채점 도중 끊긴 응시 등으로 값이 비면 0으로 본다(음수는 만들지 않는다).
    wrong += Math.max(0, (row.total_questions ?? 0) - (row.score ?? 0));
  }
  return wrong;
}

async function fetchUnresolvedTotal(
  supabase: Supabase,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("user_question_status")
    .select("question_number", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("wrong_count", 0)
    .eq("last_is_correct", false);
  return count ?? 0;
}

// 직전 국면은 review_preferences.study_phase에서 읽는다(히스테리시스의 입력).
// 판정 결과가 저장된 값과 다를 때만 되쓴다 — 마이페이지가 열릴 때마다 쓰기가
// 일어나면 안 된다. 저장 실패는 삼킨다: 국면은 파생값이라 잃어도 다음 판정에서
// 다시 채워지고, 그것 때문에 화면이 안 그려지면 손해가 더 크다.
export async function getStudyPhase(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<StudyPhaseResult> {
  const since = new Date(now.getTime() - PHASE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [recentWrongCount, unresolvedTotal, prefs, previous] = await Promise.all([
    fetchRecentWrongCount(supabase, userId, since),
    fetchUnresolvedTotal(supabase, userId),
    getReviewPrefs(supabase, userId),
    getStoredStudyPhase(supabase, userId),
  ]);

  const phase = detectStudyPhase({
    recentWrongCount,
    dailyLimit: prefs.dailyLimit,
    unresolvedTotal,
    previous,
  });

  if (phase !== previous) {
    try {
      await saveStudyPhase(supabase, userId, phase, now);
    } catch {
      // 무시: 파생값이라 다음 판정에서 다시 채워진다.
    }
  }

  return {
    phase,
    ratio: inflowRatio(recentWrongCount, prefs.dailyLimit),
    recentWrongCount,
    unresolvedTotal,
    dailyLimit: prefs.dailyLimit,
    transitioned: isPhaseTransition(previous, phase),
  };
}
