import type { ReactNode } from "react";

// 홈 팝업 — 뜰 수 있는 안내를 한 판에 담아 좌우로 넘겨 보는 슬라이드.
// 웹 apps/web/src/lib/home-popup.ts 1:1(그쪽 머리말이 배경 전부를 담고 있다).
//
// 요약: 홈에 뜰 수 있는 안내는 넷(전면 무료 이벤트·개발 중 안내·복습 유도·출석 이벤트)인데
// 예전에는 각자 자기 모달을 띄워 조건이 겹치는 날에는 하나만 자리를 잡고 나머지는 그 방문에
// 아예 닿지 못했다. 지금은 자격이 있는 것들을 한 판에 싣고 좌우로 넘긴다. 닫기는 한 번이면
// 되고, 뒤에 뭐가 더 있는지는 점(dot)으로 미리 보인다.
//
// 규칙 하나가 중요하다: **본 장만 봤다고 기록한다**(onShown). 실려 있기만 하고 넘겨 보지 않은
// 장은 다음 방문에 그대로 다시 기회를 얻는다.

export type HomePopupControls = {
  // 판 전체를 닫는다. "알겠어요"·"닫기" 같은 오른쪽(주요) 버튼이 쓴다.
  close: () => void;
  // 이 장만 걷어내고 다음 장으로. 남은 장이 없으면 판이 닫힌다. "다시 보지 않기" 같은
  // 왼쪽 버튼이 쓴다 — 사용자가 거절한 건 이 안내지 판 전체가 아니다.
  dismiss: () => void;
};

export type HomePopupSlide = {
  id: string;
  // 점(dot)과 화면낭독기가 부르는 이름. "출석체크 이벤트" 처럼 무엇에 대한 장인지.
  title: string;
  // 이 장이 실제로 화면에 보인 순간 한 번 불린다. 여기서 "봤다"를 기록한다.
  onShown?: () => void;
  // 판 안에서 스크롤되는 본문.
  body: (controls: HomePopupControls) => ReactNode;
  // 이 장의 머리가 짙은 색으로 꽉 차 있는지(전면 무료 이벤트의 히어로처럼). 판에 하나뿐인
  // 닫기(X)가 그 위에 얹히므로, 켜져 있으면 X 를 반투명 칩으로 띄운다.
  darkHeader?: boolean;
  // 판을 한 단계 넓게. 기본 폭은 글 읽기 좋은 24rem(384), 넓은 판은 28rem(448).
  wide?: boolean;
  // 이 장이 잘리지 않으려면 판이 지켜야 하는 가로/세로 비율(선택). 비율이 고정된 그림 한
  // 장으로 된 장이 쓴다 — 세로가 짧은 기기에서 판의 폭을 이 비율만큼 함께 줄여야 그림이
  // 판 밖으로 넘치지 않는다. 글로 된 장은 넘치면 스크롤되면 그만이라 주지 않는다.
  aspect?: number;
  // 본문 아래에 고정되는 버튼 띠(선택). 본문이 길어 스크롤되어도 버튼은 제자리에 남는다.
  footer?: (controls: HomePopupControls) => ReactNode;
};

// 자격 판정에 필요한, 화면 밖에서 오는 값들.
//   attendanceHref — 출석 광고가 어디로 보낼지(회원=출석 현황 / 비회원=로그인).
//   signedIn       — 로그인했는지. 전면 무료 이벤트 광고가 비회원에게만 뜨는 데 쓴다.
export type HomePopupContext = {
  attendanceHref: string;
  signedIn: boolean;
};

export type HomePopupSource = {
  id: string;
  // 뜰 자격이 있으면 슬라이드 한 장을, 아니면 null. kv(디스크)를 읽는 쪽도 비동기라
  // 전부 Promise 로 받는다 — 늦게 도착한 장은 이미 열린 판에 끼워 넣는다.
  resolve: (ctx: HomePopupContext) => HomePopupSlide | null | Promise<HomePopupSlide | null>;
};

// ── 방문(앱 실행)당 한 번 (웹 sessionStorage `*-shown-v1` 파리티) ────────────────
//
// 설계서 §4.5 #30 의 금지선: `*-shown-v1` 은 **메모리 전용**이다. 웹에서 이 값은
// sessionStorage 라 탭을 닫으면 사라지는데, 앱에서 kv(디스크)에 적으면 영구 저장이 되어
// 팝업이 **다시는 안 뜬다**. 앱 프로세스가 살아 있는 동안만 유지되는 이 Set 이 웹의
// "그 방문에서는 다시 안 뜬다"와 같은 뜻이다(#16 의 `review-fab:<srsDayIndex>` 와 같은 규칙).
//
// 앱을 완전히 종료했다 켜면 다시 한 번 뜬다 — 웹에서 탭을 새로 여는 것과 같다.
const shownThisSession = new Set<string>();

export function seenThisSession(key: string): boolean {
  return shownThisSession.has(key);
}

export function markSeenThisSession(key: string): void {
  shownThisSession.add(key);
}
