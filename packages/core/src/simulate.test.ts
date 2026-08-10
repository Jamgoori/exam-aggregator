import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, formatReport, simulate } from "./simulate";

// 시뮬레이션 회귀 고정.
//
// 단위 테스트는 "이 입력이면 이 큐"를 잡지만, 복습에서 실제로 무너지는 것들은
// 며칠~몇 달을 굴려야 보인다: 간격이 미래로 밀리는 것, 어제 오답이 큐 뒤에 갇히는
// 것, 한 시험지가 큐를 도배하는 것. 여기서는 그런 지표에 임계를 건다.
//
// 임계는 "지금 값"이 아니라 "사용자가 이상하다고 느끼기 시작하는 선"으로 잡는다 —
// 현재 값에 딱 맞추면 무해한 변경마다 빨간불이 켜져 아무도 안 본다.
//
// 절대값(유지율 60%처럼)은 가상 학습자 모델의 가정에 딸린 값이라 그대로 믿으면
// 안 된다. 여기서 믿을 수 있는 건 구조적 성질과 변경 전후 비교다.

const DAYS = 120;
const SEED = 7;

function report(profileKey: keyof typeof PROFILES) {
  return simulate(PROFILES[profileKey], { days: DAYS, seed: SEED });
}

test("시뮬레이션은 결정적이다(시드가 같으면 결과가 같다)", () => {
  // 흔들리면 임계로 회귀를 잡을 수 없다.
  assert.deepEqual(report("expanding"), report("expanding"));
});

test("같은 시험지가 큐에서 연달아 나오지 않는다", () => {
  // 과목 인터리빙은 과목이 여럿일 때만 일한다. 한 과목만 파는 사용자(또는 나머지를
  // 보류한 사용자)에게는 아무 일도 못 해서, 예전에는 큐의 24%가 "직전과 같은
  // 시험지"였다. 사용자가 "이 시험지만 계속 나온다"고 느끼는 실체가 이 숫자다.
  for (const key of ["focused", "rereading", "settling"] as const) {
    const r = report(key);
    assert.ok(
      r.adjacentSamePaper <= 0.1,
      `${r.profile}: 같은 문제지 연속 ${(r.adjacentSamePaper * 100).toFixed(0)}%\n${formatReport(r)}`,
    );
  }
});

test("한 문제지가 하루 큐를 통째로 먹지 않는다", () => {
  // 후보가 그것뿐이면 상한이 풀리므로 100%가 나올 수는 있다. 다만 후보가 있는데도
  // 도배되는 일은 없어야 한다 — 5과목을 도는 프로필에서 확인한다.
  for (const key of ["expanding", "settling", "irregular"] as const) {
    const r = report(key);
    assert.ok(
      r.maxSamePaperShare <= 0.6,
      `${r.profile}: 같은 문제지 최대 ${(r.maxSamePaperShare * 100).toFixed(0)}%`,
    );
  }
});

test("복습을 매일 여는 사용자의 큐가 비지 않는다", () => {
  // 오답이 쌓여 있는데 "오늘 복습할 문항 없어요"가 뜨면 기능이 죽은 걸로 읽힌다.
  for (const key of ["expanding", "rereading", "focused"] as const) {
    const r = report(key);
    assert.equal(r.emptyQueueDays, 0, `${r.profile}: 빈 큐 ${r.emptyQueueDays}일`);
  }
});

test("정착기 사용자는 틀린 당일 복습에 들어온다", () => {
  // 오답이 희소한 사람에게는 대기 풀이 쌓일 이유가 없다. 여기가 늘어지면 신규
  // 승격 몫이 잘못 잡힌 것이다.
  const r = report("settling");
  assert.equal(r.daysToFirstReview.median, 0, formatReport(r));
  assert.equal(r.finalPending, 0);
});

test("회독을 해도 성숙 문항의 간격이 폭주하지 않는다", () => {
  // 예정일 전 정답이 반복되면 성장이 복리로 붙어 간격이 부푼다(boundByElapsed 이전
  // 동작). 회독형 프로필이 그 조건을 그대로 만든다.
  const r = report("rereading");
  assert.ok(
    r.matureAverageInterval <= 100,
    `성숙 간격 평균 ${r.matureAverageInterval.toFixed(1)}일\n${formatReport(r)}`,
  );
});

test("확장기 사용자의 대기 풀은 늘어나되 큐는 상한을 지킨다", () => {
  // 하루 유입이 처리를 크게 앞서면 대기가 쌓이는 게 맞는 동작이다(그래서 국면
  // 감지가 있다). 다만 그게 큐 길이나 스케줄 수를 밀어 올리면 안 된다.
  const r = report("expanding");
  assert.ok(r.finalPending > 100, "확장기는 대기가 쌓이는 게 정상이다");
  assert.ok(
    r.finalScheduled < PROFILES.expanding.dailyLimit * 10,
    `스케줄 문항 ${r.finalScheduled}개 — 유입 속도대로 불어나면 안 된다`,
  );
});
