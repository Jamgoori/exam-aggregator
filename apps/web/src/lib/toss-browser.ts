// 토스페이먼츠 결제창 SDK(브라우저 전용) 로더.
//
// npm 패키지 대신 공식 스크립트를 그때그때 불러온다. 결제 SDK 는 결제 버튼을 누른
// 사람에게만 필요한데, 번들에 넣으면 가격만 구경하고 나가는 대부분의 방문자도 함께
// 내려받게 된다. 요금제 페이지는 검색으로 들어오는 입구라 첫 로딩이 중요하다.

const SDK_URL = "https://js.tosspayments.com/v2/standard";

export type TossRequestPaymentParams = {
  method: "CARD";
  amount: { currency: "KRW"; value: number };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  card?: {
    useEscrow?: boolean;
    // DEFAULT — 카드/간편결제 통합결제창(사용자가 창 안에서 수단을 고른다).
    // DIRECT  — easyPay 에 적은 간편결제가 곧장 열린다(자체창). 우리 화면에서 이미
    //           "카카오페이"를 고른 사람에게 수단 선택을 한 번 더 시키지 않으려는 것.
    flowMode?: "DEFAULT" | "DIRECT";
    // 간편결제사 코드(KAKAOPAY·NAVERPAY 등). flowMode 가 DIRECT 일 때만 의미가 있다 —
    // DEFAULT 에서는 이 값과 상관없이 통합결제창이 열린다.
    easyPay?: string;
    useCardPoint?: boolean;
    useAppCardOnly?: boolean;
  };
};

type TossPaymentInstance = {
  requestPayment: (params: TossRequestPaymentParams) => Promise<void>;
};
type TossPaymentsInstance = {
  payment: (options: { customerKey: string }) => TossPaymentInstance;
};
type TossPaymentsFactory = (clientKey: string) => TossPaymentsInstance;

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

// 한 번 불러오면 재사용한다. 사용자가 결제를 취소하고 다시 누르는 경우가 흔한데,
// 그때마다 스크립트 태그가 쌓이면 안 된다.
let loading: Promise<TossPaymentsFactory> | null = null;

export function loadTossPayments(): Promise<TossPaymentsFactory> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  if (loading) return loading;

  loading = new Promise<TossPaymentsFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.TossPayments) resolve(window.TossPayments);
      else reject(new Error("결제 모듈을 불러오지 못했어요."));
    };
    script.onerror = () => {
      // 다음 시도에서 다시 받을 수 있게 캐시를 비운다 — 일시적인 네트워크 문제로
      // 한 번 실패했다고 새로고침 전까지 결제를 못 하게 두면 안 된다.
      loading = null;
      reject(new Error("결제 모듈을 불러오지 못했어요."));
    };
    document.head.appendChild(script);
  });

  return loading;
}

// SDK 가 거부(reject)로 주는 값은 { code, message } 모양이다. 사용자가 결제창을
// 직접 닫은 경우와 진짜 오류를 구분해야 한다 — 자기가 닫은 창에 "실패했어요"가 뜨면
// 카드에 문제가 있는 줄 알고 다시 확인하게 된다.
export function isUserCanceled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED";
}
