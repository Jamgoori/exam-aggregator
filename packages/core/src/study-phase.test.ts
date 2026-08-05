import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectStudyPhase,
  inflowRatio,
  isPhaseTransition,
  PHASE_WINDOW_DAYS,
  type StudyPhase,
} from "./study-phase";

// 여기가 무너지면 사용자가 매일 다른 화면을 본다 — 헤드라인 숫자와 오늘 카드
// CTA가 국면에 묶여 있어서, 국면이 흔들리면 사용자는 그걸 고장으로 읽는다.

// 7일 창 기준으로 "하루 N개씩 틀렸을 때"의 누적 오답 수.
function weekOf(perDay: number): number {
  return perDay * PHASE_WINDOW_DAYS;
}

function phase(
  perDay: number,
  dailyLimit: number,
  previous?: StudyPhase | null,
): StudyPhase {
  return detectStudyPhase({
    recentWrongCount: weekOf(perDay),
    dailyLimit,
    unresolvedTotal: 100,
    previous,
  });
}

test("유입비는 하루 유입 ÷ 하루 처리량", () => {
  // 7일에 140개 = 하루 20개, 상한 20 → 딱 따라잡는 속도.
  assert.equal(inflowRatio(140, 20), 1);
  assert.equal(inflowRatio(280, 20), 2);
  // 상한을 올리면 같은 유입도 따라잡을 만해진다.
  assert.equal(inflowRatio(280, 40), 1);
});

test("재고가 0이면 유입비와 무관하게 확장기", () => {
  // 갓 가입한 사용자. 정착기로 보내면 "오늘 복습 0문항" 빈 카드를 준다.
  assert.equal(
    detectStudyPhase({
      recentWrongCount: 0,
      dailyLimit: 20,
      unresolvedTotal: 0,
      previous: "settling",
    }),
    "expanding",
  );
});

test("첫 판정은 두 임계의 가운데(2.0)로 가른다", () => {
  assert.equal(phase(50, 20), "expanding"); // 2.5
  assert.equal(phase(40, 20), "expanding"); // 2.0 — 경계는 확장기 쪽
  assert.equal(phase(30, 20), "settling"); // 1.5
});

test("사이 구간(1.5~2.5)에서는 직전 국면을 유지한다", () => {
  // 히스테리시스가 없으면 이 구간의 사용자는 매일 국면이 뒤집힌다.
  assert.equal(phase(40, 20, "expanding"), "expanding"); // 2.0
  assert.equal(phase(40, 20, "settling"), "settling"); // 2.0
});

test("확장기에서 나오려면 1.5 아래로 내려와야 한다", () => {
  assert.equal(phase(30, 20, "expanding"), "expanding"); // 1.5 — 아직
  assert.equal(phase(28, 20, "expanding"), "settling"); // 1.4
});

test("정착기에서 확장기로 가려면 2.5를 넘어야 한다", () => {
  assert.equal(phase(50, 20, "settling"), "settling"); // 2.5 — 아직
  assert.equal(phase(52, 20, "settling"), "expanding"); // 2.6
});

test("일주일 쉰 정착기 사용자가 확장기로 튀지 않는다", () => {
  // 유입 0이면 비율도 0이라 첫 판정 규칙만으로는 정착기가 맞지만, 재고 0 규칙에
  // 걸리지 않는지도 함께 확인한다(재고는 쉬어도 남아 있다).
  assert.equal(
    detectStudyPhase({
      recentWrongCount: 0,
      dailyLimit: 20,
      unresolvedTotal: 300,
      previous: "settling",
    }),
    "settling",
  );
});

test("실제 사용자 시나리오", () => {
  // 1회독 30점 · 하루 2장(200문항) → 하루 오답 140.
  assert.equal(phase(140, 20), "expanding");
  // 같은 사람이 상한을 60으로 올려도 여전히 확장기다(140/60 = 2.33... 사이 구간이라
  // 첫 판정 임계 2.0을 넘는다). 상한 상향만으로는 못 따라잡는다는 뜻.
  assert.equal(phase(140, 60), "expanding");

  // 1회독 95점 · 하루 2장 → 하루 오답 10.
  assert.equal(phase(10, 20), "settling");
  // 95점이어도 하루 10장을 풀면 오답 50 → 확장기 쪽으로 간다.
  assert.equal(phase(50, 20), "expanding");
});

test("상한이 0이나 음수여도 터지지 않는다", () => {
  assert.equal(inflowRatio(140, 0), 140 / PHASE_WINDOW_DAYS);
  assert.equal(inflowRatio(-5, 20), 0);
  assert.doesNotThrow(() =>
    detectStudyPhase({ recentWrongCount: -1, dailyLimit: 0, unresolvedTotal: 5 }),
  );
});

test("전환 판정은 이력이 있을 때만 참", () => {
  assert.equal(isPhaseTransition(null, "expanding"), false);
  assert.equal(isPhaseTransition(undefined, "settling"), false);
  assert.equal(isPhaseTransition("expanding", "expanding"), false);
  assert.equal(isPhaseTransition("expanding", "settling"), true);
});
