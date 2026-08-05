// 학습 국면(확장기/정착기) 감지 — 웹·모바일 공유(순수 계산).
//
// 이 서비스는 편차가 아주 큰 사용자를 한 화면으로 받는다. 하루 2장을 푸는 사람과
// 10장을 푸는 사람, 1회독 30점과 95점. 그런데 이 둘은 따로 볼 필요가 없다 —
// "하루에 새로 생기는 오답 ÷ 하루에 처리할 수 있는 수" 하나로 합쳐진다.
//
//   확장기(유입 ≫ 처리): 오답 = 아직 안 배운 범위. 30점이면 70문항이 오답인데
//     그건 실패가 아니라 미학습이다. 이 사람에게 "오답 복습"은 사실상 전 범위
//     공부이고, 하루 20개씩 처리해서는 영원히 따라잡지 못한다(2026-08-04
//     시뮬레이션). 필요한 건 복습이 아니라 진도다.
//   정착기(유입 ≈ 처리): 오답 = 진짜 약점. 95점의 5문항은 희소하고 가치가 높다.
//     간격 반복이 정확히 이 사람을 위한 도구다.
//
// 사람의 속성이 아니라 시기의 속성이다 — 한 사람이 시간축을 따라 확장기에서
// 정착기로 이동한다. 그래서 사용자에게 유형을 묻지 않고(본인도 모른다) 데이터로
// 감지한다.
//
// 여기는 판정만 한다. 국면에 따라 무엇을 보여줄지는 각 앱의 화면이 정한다.

export type StudyPhase = "expanding" | "settling";

// 유입을 재는 창. 짧으면 하루 쉰 것만으로 국면이 흔들리고, 길면 회독을 끝낸
// 사람이 몇 주째 확장기로 남는다.
export const PHASE_WINDOW_DAYS = 7;

// 히스테리시스 — 진입과 이탈 임계를 다르게 둔다. 하나로 두면 비율이 임계 근처인
// 사용자의 국면이 매일 바뀌고, 그러면 헤드라인 숫자와 오늘 카드 CTA가 날마다
// 달라져 고장으로 읽힌다.
export const PHASE_ENTER_EXPANDING = 2.5;
export const PHASE_ENTER_SETTLING = 1.5;

// 이력이 없을 때(첫 판정) 쓰는 단일 임계. 되돌아갈 이력이 없으니 히스테리시스가
// 의미가 없어 두 임계의 가운데를 쓴다.
export const PHASE_FIRST_THRESHOLD =
  (PHASE_ENTER_EXPANDING + PHASE_ENTER_SETTLING) / 2;

// 하루 유입 ÷ 하루 처리량. 1이면 딱 따라잡는 속도, 3이면 세 배로 밀린다.
export function inflowRatio(
  recentWrongCount: number,
  dailyLimit: number,
  windowDays: number = PHASE_WINDOW_DAYS,
): number {
  const days = Math.max(1, windowDays);
  const limit = Math.max(1, dailyLimit);
  const perDay = Math.max(0, recentWrongCount) / days;
  return perDay / limit;
}

export type StudyPhaseInput = {
  // 최근 PHASE_WINDOW_DAYS 안에 새로 틀린 문항 수. cbt_attempts의
  // (total_questions − score) 합이면 충분하다 — 문항별 행을 훑을 필요가 없다.
  recentWrongCount: number;
  // 하루에 낼 복습 문항 수(review_preferences.daily_limit).
  dailyLimit: number;
  // 지금 남아 있는 미극복 오답 총계 = 복습 재고. 0이면 비율과 무관하게 확장기다.
  unresolvedTotal: number;
  // 직전에 판정된 국면. 없으면 첫 판정으로 본다.
  previous?: StudyPhase | null;
};

// 국면 판정.
//
// 재고가 0이면 유입비를 보지 않고 확장기다. 복습 모드는 "오늘 복습 N문항"이
// 헤드라인인데 재고가 없으면 빈 카드가 되고, 그 사용자에게 필요한 건 애초에
// 새 문제지다. 갓 가입한 사용자가 여기 해당한다.
//
// 그 위에 히스테리시스. 확장기에서 나오려면 비율이 PHASE_ENTER_SETTLING 밑으로
// 충분히 내려와야 하고, 정착기에서 확장기로 가려면 PHASE_ENTER_EXPANDING을
// 넘어야 한다. 사이 구간(1.5~2.5)에서는 직전 국면을 유지한다.
export function detectStudyPhase(input: StudyPhaseInput): StudyPhase {
  if (Math.max(0, input.unresolvedTotal) === 0) return "expanding";

  const ratio = inflowRatio(input.recentWrongCount, input.dailyLimit);

  if (!input.previous) {
    return ratio >= PHASE_FIRST_THRESHOLD ? "expanding" : "settling";
  }
  if (input.previous === "expanding") {
    return ratio < PHASE_ENTER_SETTLING ? "settling" : "expanding";
  }
  return ratio > PHASE_ENTER_EXPANDING ? "expanding" : "settling";
}

// 국면이 이번 판정에서 바뀌었는지. 전환은 자동으로 하되 사용자에게 알려야 하고
// ("이제 오답이 따라잡을 만한 양이에요"), 알림을 한 번만 띄우려면 호출부가
// 전환 시점을 알아야 한다.
export function isPhaseTransition(
  previous: StudyPhase | null | undefined,
  next: StudyPhase,
): boolean {
  return previous != null && previous !== next;
}
