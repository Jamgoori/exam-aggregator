// 간편결제(카카오페이·네이버페이 등) 노출 목록 — 순수 계산. 서버·클라이언트 공용.
//
// 토스 결제창은 두 가지 모양으로 열린다.
//   flowMode: "DEFAULT" — 카드/간편결제 통합결제창. 계약된 간편결제가 그 안에 탭으로 들어간다.
//   flowMode: "DIRECT"  — easyPay 에 적은 간편결제 앱이 곧장 열린다(자체창).
// 여기서 다루는 것은 후자다. 요금제 페이지에 "카카오페이" 버튼을 두고 누르면 카카오페이가
// 바로 뜨게 하는 쪽 — 국내 사이트에서 익숙한 결제수단 선택 UI 다.
//
// 왜 환경변수로 여닫는가: 간편결제는 코드가 아니라 계약이다. 토스 상점관리자에서
// 간편결제를 추가하고 심사가 끝나야 열린다. 계약 없이 버튼만 띄우면 사용자가 결제수단을
// 고르고 결제창이 뜬 다음에야 실패한다 — 가장 나쁜 자리에서 터진다. 그래서 기본값은
// "아무 것도 안 보임"(= 지금까지처럼 통합결제창 하나)이고, 심사가 끝난 수단만 켠다.
//
// 삼성페이·애플페이는 여기 넣지 않았다. 기기가 지원해야만 결제가 되는 수단이라 버튼을
// 항상 띄우면 못 쓰는 사람에게 실패를 보여주게 된다(애플페이는 계약 조건도 따로다).

// 토스 간편결제사 코드(영문). https://docs.tosspayments.com/codes/org-codes
export const EASY_PAY_CODES = ["KAKAOPAY", "NAVERPAY", "TOSSPAY", "PAYCO"] as const;
export type EasyPayCode = (typeof EASY_PAY_CODES)[number];

// 화면에 그대로 쓰는 이름. 임의로 줄이지 말 것 — 결제수단 이름은 사용자가 자기 앱에서
// 보는 이름과 같아야 알아본다.
export const EASY_PAY_LABELS: Record<EasyPayCode, string> = {
  KAKAOPAY: "카카오페이",
  NAVERPAY: "네이버페이",
  TOSSPAY: "토스페이",
  PAYCO: "페이코",
};

// 설정값 해석표. 한글 이름도 받는다 — 설정하는 사람이 토스 상점관리자에서 보는 이름이
// 한글이라, 거기 적힌 대로 옮겨 적는 게 자연스럽다.
const LOOKUP: Record<string, EasyPayCode> = Object.fromEntries(
  EASY_PAY_CODES.flatMap((code) => [
    [code, code],
    [EASY_PAY_LABELS[code], code],
  ]),
);

// "KAKAOPAY,NAVERPAY" 또는 "카카오페이, 네이버페이" → ["KAKAOPAY", "NAVERPAY"]
//
// 적은 순서를 그대로 유지한다. 화면에 그 순서로 놓이므로, 먼저 보여주고 싶은 수단을
// 앞에 적으면 그대로 반영된다.
//
// 모르는 값은 조용히 버리지 않고 경고를 남긴다. 오타 하나("KAKAO_PAY")로 버튼이 통째로
// 사라지면, 계약은 끝났는데 왜 안 보이는지 한참 헤매게 된다.
export function parseEasyPayMethods(raw: string | null | undefined): EasyPayCode[] {
  if (!raw) return [];

  const out: EasyPayCode[] = [];
  for (const token of raw.split(",")) {
    const name = token.trim();
    if (!name) continue;

    const code = LOOKUP[name] ?? LOOKUP[name.toUpperCase()];
    if (!code) {
      console.warn(
        `[easy-pay] 알 수 없는 간편결제 코드 "${name}" 를 건너뜁니다. ` +
          `가능한 값: ${EASY_PAY_CODES.join(", ")} (또는 ${Object.values(EASY_PAY_LABELS).join(", ")})`,
      );
      continue;
    }
    if (!out.includes(code)) out.push(code);
  }
  return out;
}
