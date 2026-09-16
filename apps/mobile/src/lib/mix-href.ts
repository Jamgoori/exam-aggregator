import { router, type Href } from "expo-router";

// 기출 섞어풀기(`/subjects/[slug]/mix`) 진입점 한 곳.
//
// 섞어풀기로 보내는 자리가 네 곳이라(마이페이지 오답노트 탭·과목 오답노트 머리말·섞어풀기 기록
// 화면·과목 기출 목록) 각자 `router.push` 를 쓰면 주소 조립이 네 벌로 갈린다. "섞어풀기로
// 간다"는 뜻을 이 함수 하나로 모아 둔다 — Phase 3 에서 화면이 생기며 안내 한 줄이 실제 이동으로
// 바뀌었고(설계서 §12-5), 네 자리가 한꺼번에 살아났다.
//
// 급수(`?level=`)는 허브(`/mix`)에서 고르고 들어올 때만 붙는다. 여기서 부르는 네 자리는 과목이
// 이미 정해진 맥락이라 급수를 얹지 않는다(웹 링크와 같다).
export function openSubjectMix(slug: string): void {
  router.push(`/subjects/${slug}/mix` as Href);
}
