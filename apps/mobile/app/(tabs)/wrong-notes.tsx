import { Redirect } from "expo-router";

// 오답노트 탭의 실체는 /mypage?tab=wrong-notes 다((tabs)/_layout.tsx 주석). 탭 버튼은 href 로
// 바로 그리로 가고, 이 파일은 탭 이름 매칭 + 직접 진입 시 안전망.
export default function WrongNotesTabRedirect() {
  return <Redirect href="/mypage?tab=wrong-notes" />;
}
