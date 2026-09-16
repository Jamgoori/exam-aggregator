import { Alert } from "react-native";

// 기출 섞어풀기(`/subjects/[slug]/mix`) 진입점 한 곳.
//
// 앱에는 아직 이 화면이 없다(설계서 §12 Phase 3 "믹스" — EF `mix-create`·`/mix`·
// `/subjects/[slug]/mix`·믹스 기록). 그런데 섞어풀기로 보내는 자리는 이미 네 곳이라
// (마이페이지 오답노트 탭·과목 오답노트 머리말·섞어풀기 기록 화면·과목 기출 목록)
// 각자 `router.push` 를 쓰면 세 곳은 `+not-found` 로 떨어지고 한 곳만 안내를 띄운다.
// 그래서 "섞어풀기로 간다"는 뜻을 이 함수 하나로 모아 둔다 — 지금은 안내 한 줄이고,
// 화면이 생기면 이 본문만 `router.push` 로 바꾸면 네 자리가 한꺼번에 살아난다.
//
// **Phase 3(설계서 §12 "믹스")에서 아래 본문을 다음으로 교체한다:**
//   router.push(`/subjects/${slug}/mix` as Href);
// 그때 `src/lib/next-path.ts` 의 `next` 화이트리스트에도 `/subjects/[slug]/mix` 를
// 되돌려 놓는다(지금은 빠져 있다 — 없는 화면으로 복귀시키지 않으려고).
export function openSubjectMix(_slug: string): void {
  Alert.alert("섞어풀기는 다음 단계에서 열려요");
}
