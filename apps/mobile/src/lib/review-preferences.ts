import { supabase } from "./supabase";

// 복습 과목 보류 설정 읽기. 설정 화면은 웹 마이페이지에 있고(과목 칩), 앱은 그
// 결과만 존중한다 — 리마인더 문구에 "쉬는 중"인 과목 오답까지 세면 끈 사람이
// 매일 밤 자기가 끈 숫자를 다시 보게 된다.
//
// 쓰기는 웹에서만 한다. 보류 해제에는 밀린 문항의 복습일을 다시 뿌리는 서버 쓰기가
// 붙는데(user_question_status 는 쓰기 정책이 없다), 그 경로를 앱에 한 벌 더 두면
// 두 규칙이 갈라진다.
export async function getPausedSubjectIds(): Promise<Set<string>> {
  const { data } = await supabase
    .from("review_preferences")
    .select("paused_subject_ids")
    .maybeSingle();
  const ids = (data?.paused_subject_ids ?? []) as string[];
  return new Set(ids.filter(Boolean));
}
