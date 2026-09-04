import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiagnosisProgress } from "./diagnosis-progress";
import { DIAGNOSIS_MIN_ATTEMPTS, DIAGNOSIS_MIN_WRONG } from "./ai-diagnosis-thresholds";

describe("computeDiagnosisProgress", () => {
  it("처음에는 응시 축으로 0/3 을 보여준다", () => {
    const p = computeDiagnosisProgress({ attemptCount: 0, wrongCount: 0 });
    assert.equal(p.eligible, false);
    assert.equal(p.ratio, 0);
    assert.equal(p.label, `응시 0/${DIAGNOSIS_MIN_ATTEMPTS}`);
    assert.match(p.remainingHint ?? "", /회차만 더 풀면/);
  });

  it("한 회차 남으면 '한 회차만 더' 라고 말한다", () => {
    const p = computeDiagnosisProgress({
      attemptCount: DIAGNOSIS_MIN_ATTEMPTS - 1,
      wrongCount: 3,
    });
    assert.equal(p.eligible, false);
    assert.equal(p.remainingHint, "한 회차만 더 풀면 진단이 열려요");
  });

  it("둘 중 더 가까운 축을 고른다 — 오답이 더 많이 찼으면 오답 축", () => {
    const p = computeDiagnosisProgress({ attemptCount: 1, wrongCount: 12 });
    assert.equal(p.label, `오답 12/${DIAGNOSIS_MIN_WRONG}`);
    assert.equal(p.remainingHint, "오답 3개가 더 모이면 진단이 열려요");
  });

  it("어느 한쪽이라도 문턱을 넘으면 자격이 된다", () => {
    const byAttempts = computeDiagnosisProgress({
      attemptCount: DIAGNOSIS_MIN_ATTEMPTS,
      wrongCount: 0,
    });
    assert.equal(byAttempts.eligible, true);
    assert.equal(byAttempts.ratio, 1);
    assert.equal(byAttempts.remainingHint, null);

    const byWrongs = computeDiagnosisProgress({
      attemptCount: 1,
      wrongCount: DIAGNOSIS_MIN_WRONG,
    });
    assert.equal(byWrongs.eligible, true);
    assert.equal(byWrongs.ratio, 1);
  });

  it("문턱을 넘긴 값도 표기는 문턱에서 멈춘다", () => {
    const p = computeDiagnosisProgress({ attemptCount: 9, wrongCount: 40 });
    assert.equal(p.label, `응시 ${DIAGNOSIS_MIN_ATTEMPTS}/${DIAGNOSIS_MIN_ATTEMPTS}`);
  });
});
