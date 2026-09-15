// 제품 분석(소유자 결정 §12-2 4번: Sentry + GA4 앱 스트림).
//
// 구현은 아직 no-op 이다. GA4 는 @react-native-firebase/analytics 가 필요한데, 그 config
// plugin 은 google-services.json / GoogleService-Info.plist 가 없으면 prebuild 자체가
// 실패한다. 파일은 소유자가 Firebase 콘솔에서 받아 apps/mobile/ 에 두는 값(gitignore)이라
// 콘솔 작업이 끝난 뒤에 붙인다 — 절차는 SETUP.md "분석(GA4)" 절. 화면 코드는 이 인터페이스만
// 부르므로 그때 이 파일 하나만 바뀐다.
//
// 이벤트 이름·속성에 정답·해설 본문·user_metadata 를 넣지 않는다(§3.1 관측 행).
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export const analytics = {
  track(_event: string, _props?: AnalyticsProps): void {
    // no-op — google-services.json 준비 후 GA4 logEvent 로 교체
  },
  screen(_name: string): void {
    // no-op — google-services.json 준비 후 GA4 logScreenView 로 교체
  },
};
