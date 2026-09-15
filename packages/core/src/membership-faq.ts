import { FREE_EXPLANATION_DAILY_PAPERS } from "./membership";

// 앱 /membership 화면의 FAQ — 웹 membership/page.tsx faqItems 부분집합 — 결제·환불 문항
// 제외(설계서 §8.1). 스토어 정책(Apple 3.1.1/3.1.3)상 앱 안에서 웹 결제·환불·요금제·결제
// 내역·가격을 언급하면 안 되므로, 그 단어가 들어간 문항은 IAP 단계(Phase 5) 전까지 여기
// 넣지 않는다. 답은 웹의 문장에서 굵게(<b>) 표시만 뺀 것이다 — 뜻을 바꾸지 않는다.
//
// 빠진 문항(웹에만): "정말 …까지 다 무료인가요?"(결제 없음을 말하지만 '결제' 단어가 들어간다),
// "결제하면 바로 쓸 수 있나요?", "환불은 어떻게 하나요?". 전면 무료 안내는 화면 첫 문장
// ("지금은 전부 무료예요" + FREE_UNTIL_LABEL)이 대신한다.
export type MembershipFaqItem = { q: string; a: string };

export const MEMBERSHIP_FAQ_APP: readonly MembershipFaqItem[] = [
  {
    q: "무료로는 해설을 아예 못 보나요?",
    a:
      `볼 수 있어요. 무료 회원은 하루에 문제지 ${FREE_EXPLANATION_DAILY_PAPERS}개까지 해설을 열어볼 수 있고, ` +
      "오늘 이미 연 문제지를 다시 여는 건 횟수에 들어가지 않아요. 같은 해설을 다시 확인하려고 한도를 " +
      "쓰게 만들지는 않으려고요. 한도는 매일 자정(한국 시간)에 초기화돼요.",
  },
  {
    q: "멤버십이 끝나면 오답노트가 사라지나요?",
    a:
      "아니요. 틀린 문제를 과목별로 모아 보고, 메모를 남기고, 섞어서 다시 푸는 것까지는 멤버십이 " +
      "끝나도 그대로 쓸 수 있어요. 잠기는 것은 문항 해설과 “오늘의 복습”(언제 다시 볼지 계산해주는 " +
      "일정)이고, 쌓아둔 기록은 지워지지 않아 다시 시작하면 그대로 이어집니다.",
  },
];

// 앱 FAQ 에 들어가면 안 되는 단어 — 테스트가 MEMBERSHIP_FAQ_APP 전체를 이 목록으로 검사한다.
export const MEMBERSHIP_FAQ_APP_FORBIDDEN_WORDS = ["결제", "환불", "요금제", "가격", "원"] as const;
