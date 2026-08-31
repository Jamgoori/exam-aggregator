// Microsoft Clarity 커스텀 태그/이벤트를 거는 클라이언트 헬퍼.
//
// 태그를 걸어야 하는 이유: 태그 없는 Clarity는 "어느 URL에서 rage click이 났나"까지만
// 보여준다. "무료 회원만 결제 화면에서 헤매는가", "CBT를 끝까지 푼 사람은 누구인가"
// 같은 질문은 대시보드 필터가 세그먼트를 나눌 수 있어야 답이 나온다.
//
// 값은 개인정보가 아니어야 한다 — 이메일·닉네임·사용자 ID를 넣지 말 것. Clarity는
// 태그 값을 그대로 저장하고 대시보드에 노출한다(개인정보처리방침에 적어둔 범위도
// "이용 행태"까지다). 등급·화면·요금제처럼 사람을 특정하지 못하는 값만 싣는다.

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] };

// 태그 스크립트(afterInteractive)가 뜨기 전에 호출돼도 잃지 않도록, 공식 스니펫과
// 같은 모양의 큐 스텁을 만들어 둔다. 실제 clarity.js가 로드되면 q에 쌓인 호출을
// 그대로 흘려보낸다.
//
// 큐에 상한을 두는 이유: NEXT_PUBLIC_CLARITY_ID가 없는 환경(로컬·프리뷰)에서는
// 태그 스크립트가 영영 안 뜨므로 큐가 무한정 자란다.
const MAX_QUEUED = 100;

function clarity(): ClarityFn | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { clarity?: ClarityFn };
  if (!w.clarity) {
    const stub: ClarityFn = (...args: unknown[]) => {
      stub.q ??= [];
      if (stub.q.length < MAX_QUEUED) stub.q.push(args);
    };
    w.clarity = stub;
  }
  return w.clarity;
}

// 세션에 꼬리표를 단다. 같은 키를 여러 번 걸면 값이 쌓이므로(대시보드에서 OR로
// 필터된다) 변하는 값(예: 보기 모드)은 그대로 여러 번 걸어도 된다.
export function clarityTag(key: string, value: string | string[]): void {
  clarity()?.("set", key, value);
}

export function clarityTags(tags: Record<string, string | string[] | null | undefined>): void {
  for (const [key, value] of Object.entries(tags)) {
    if (value != null && value !== "") clarityTag(key, value);
  }
}

// 대시보드 "Smart events" 목록에 잡히는 사용자 행동. 퍼널(진입 → 결제 시작 →
// 완료)을 세는 단위다.
export function clarityEvent(name: string): void {
  clarity()?.("event", name);
}

// 이 세션을 우선 저장 대상으로 올린다. Clarity는 트래픽이 많으면 세션을 표본으로만
// 녹화하는데, 결제 시작·채점처럼 드물고 중요한 순간은 표본에서 빠지면 볼 수가 없다.
export function clarityUpgrade(reason: string): void {
  clarity()?.("upgrade", reason);
}
