import { isFreeForAll } from "@gongmoa/core";
import { ClosingCta } from "../../src/components/home/closing-cta";
import { DiagnosisSection } from "../../src/components/home/diagnosis-section";
import { Hero } from "../../src/components/home/hero";
import { HomePopupSlider } from "../../src/components/home/home-popup-slider";
import { PastQuestions } from "../../src/components/home/past-questions";
import { TopBanner } from "../../src/components/home/top-banner";
import { Screen } from "../../src/components/screen";
import { useAuth } from "../../src/providers/auth-provider";
import { useCatalog } from "../../src/queries/catalog";

// 랜딩 `/`(설계서 §5 `/` 행, §12-2 5번: 로그인 직후·앱 첫 화면) — 웹 app/page.tsx 와 같은
// 순서: (팝업) → TopBanner → Hero + TodayStudy → PastQuestions(검색 + 6 시험 카드) →
// Diagnosis → ClosingCta → (AdBanner). 본문은 전부 공개 값이고 로그인 여부를 보는 것은
// 오늘의 학습 현황 카드(TodayStudy)뿐이다. 숫자(자료 수)는 카탈로그 쿼리, 이벤트 여부·규칙
// 숫자(응시 3회·오답 15개·7일)는 core 상수에서 온다 — 화면만 옛 숫자를 광고하면 허위 안내다.
//
// 색은 이 화면만의 팔레트(남색 #012854 + 초록 #12b382)다 — 홈이 "제품 소개"라 나머지 화면
// (도구)과 톤을 달리 가져가려는 것(§4.1 color.brand 행).
export default function HomeScreen() {
  const catalog = useCatalog();
  const { userId } = useAuth();
  // 전면 무료 기간(FREE_UNTIL) — 그릴 때 판정하므로 종료일을 넘기면 다음 렌더부터 바뀐다.
  const freeForAll = isFreeForAll();

  return (
    <Screen padded={false} refreshing={catalog.isRefetching} onRefresh={() => void catalog.refetch()}>
      {/* 홈 팝업 슬라이드(§4.5 #30). 출석 광고가 가는 곳: 회원은 출석 현황, 비회원은 **가입**
          (웹 app/page.tsx 와 같은 `/signup`). 앱에 가입 화면이 따로 있는 건 아니고 app/signup.tsx
          가 웹처럼 `/login` 으로 넘기는 리다이렉트지만(§5 `/signup` 행), 주소를 웹과 같게 두면
          딥링크·문구가 한 매핑으로 남는다 — 전면 무료 팝업의 CTA 도 같은 `/signup` 을 쓴다. */}
      <HomePopupSlider attendanceHref={userId ? "/mypage?tab=attendance" : "/signup"} signedIn={!!userId} />
      <TopBanner freeForAll={freeForAll} />
      <Hero />
      <PastQuestions />
      <DiagnosisSection />
      <ClosingCta freeForAll={freeForAll} />
      {/* Phase 5: AdBanner placement="home" — 가입 유도(ClosingCta) 아래(§12-2 14번, §8.4). */}
    </Screen>
  );
}
