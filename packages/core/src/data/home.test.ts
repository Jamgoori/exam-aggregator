import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIAGNOSIS_MIN_ATTEMPTS, DIAGNOSIS_MIN_WRONG } from "../diagnosis-progress";
import {
  buildExamIndex,
  comboSlug,
  computeTodayStudy,
  currentCycleStartDate,
  daysUntilKst,
  diagnosisIntroCta,
  DIAGNOSIS_CYCLE_DAYS,
  nextDiagnosisDate,
} from "./home";

describe("buildExamIndex", () => {
  const examTypes = [
    { id: "t1", name: "국가직", display_order: 1 },
    { id: "t2", name: "경찰", display_order: 5 },
  ];

  it("시행처×급수 조합을 슬러그로 묶고 연도는 내림차순", () => {
    const combos = buildExamIndex(
      [
        { exam_type_id: "t1", level: "9급", year: 2024 },
        { exam_type_id: "t1", level: "9급", year: 2025 },
        { exam_type_id: "t1", level: "9급", year: 2024 },
        { exam_type_id: "t1", level: "7급", year: 2025 },
        { exam_type_id: "t2", level: null, year: 2023 },
        // 색인에 없는 시행처는 건너뛴다.
        { exam_type_id: "zz", level: "9급", year: 2020 },
      ],
      examTypes,
    );
    assert.deepEqual(
      combos.map((c) => c.slug),
      ["국가직-9급", "국가직-7급", "경찰"],
    );
    const nine = combos[0];
    assert.equal(nine.label, "국가직 9급");
    assert.equal(nine.count, 3);
    assert.deepEqual(nine.years, [2025, 2024]);
    assert.deepEqual(nine.yearCounts, [
      { year: 2025, count: 1 },
      { year: 2024, count: 2 },
    ]);
    assert.equal(combos[2].label, "경찰");
    assert.equal(combos[2].level, null);
  });

  it("comboSlug: 급수가 없으면 시행처 이름 그대로", () => {
    assert.equal(comboSlug("지방직", "9급"), "지방직-9급");
    assert.equal(comboSlug("경찰", null), "경찰");
  });
});

describe("computeTodayStudy", () => {
  // 2026-09-16(수) 12:00 KST = 03:00Z
  const now = new Date("2026-09-16T03:00:00Z");

  it("이번 주 월~일 막대·오늘 응시·정답률·스트릭을 한 장으로", () => {
    const data = computeTodayStudy(
      [
        // 월요일(9/14) 20문항, 수요일(오늘) 두 번
        { score: 15, total_questions: 20, created_at: "2026-09-14T01:00:00Z" },
        { score: 18, total_questions: 20, created_at: "2026-09-16T00:30:00Z" },
        { score: 10, total_questions: 20, created_at: "2026-09-16T02:00:00Z" },
        // 지난주 — 막대에는 안 들어가지만 정답률에는 들어간다.
        { score: 20, total_questions: 20, created_at: "2026-09-10T02:00:00Z" },
      ],
      { attemptCount: 4, wrongCount: 6 },
      now,
    );
    assert.equal(data.todayIndex, 2);
    assert.equal(data.todayAttempts, 2);
    assert.deepEqual(data.week, [20, 0, 40, 0, 0, 0, 0]);
    // (15+18+10+20)/80 = 78.75 → 79
    assert.equal(data.accuracyPct, 79);
    assert.equal(data.attemptCount, 4);
    assert.equal(data.wrongCount, 6);
  });

  it("응시가 없으면 정답률은 null", () => {
    const data = computeTodayStudy([], { attemptCount: 0, wrongCount: 0 }, now);
    assert.equal(data.accuracyPct, null);
    assert.deepEqual(data.week, [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(data.streakDays, 0);
  });

  it("KST 자정 직후 응시는 KST 날짜로 센다 (UTC 전날)", () => {
    // 2026-09-16 00:10 KST = 09-15 15:10Z → 수요일 칸
    const data = computeTodayStudy(
      [{ score: 1, total_questions: 5, created_at: "2026-09-15T15:10:00Z" }],
      { attemptCount: 1, wrongCount: 0 },
      now,
    );
    assert.equal(data.todayAttempts, 1);
    assert.deepEqual(data.week, [0, 0, 5, 0, 0, 0, 0]);
  });
});

describe("진단 주기", () => {
  it("nextDiagnosisDate 는 받은 날 + 주기", () => {
    assert.equal(nextDiagnosisDate("2026-09-10"), "2026-09-17");
    assert.equal(DIAGNOSIS_CYCLE_DAYS, 7);
  });

  it("currentCycleStartDate 는 오늘 포함 7일 전 경계", () => {
    // 2026-09-16 KST
    assert.equal(currentCycleStartDate(new Date("2026-09-16T03:00:00Z")), "2026-09-10");
  });

  it("daysUntilKst 는 지난 날짜면 0", () => {
    const now = new Date("2026-09-16T03:00:00Z");
    assert.equal(daysUntilKst("2026-09-20", now), 4);
    assert.equal(daysUntilKst("2026-09-01", now), 0);
    assert.equal(daysUntilKst("not-a-date", now), 0);
  });
});

describe("diagnosisIntroCta", () => {
  it("로그인 → 멤버십 → 문제 더 풀기 → 진단 보기 순으로 막히는 곳을 먼저 푼다", () => {
    assert.equal(
      diagnosisIntroCta({ loggedIn: false, premium: false, eligible: false, daysLeft: null }).label,
      "로그인하고 시작하기",
    );
    const noPremium = diagnosisIntroCta({ loggedIn: true, premium: false, eligible: true, daysLeft: null });
    assert.equal(noPremium.label, "멤버십 보러 가기");
    assert.equal(noPremium.href, "/membership?next=%2Fdiagnosis");
    const locked = diagnosisIntroCta({ loggedIn: true, premium: true, eligible: false, daysLeft: null });
    assert.equal(locked.label, "문제 풀러 가기");
    assert.equal(
      locked.note,
      `오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회를 넘기면 진단이 열려요.`,
    );
    const waiting = diagnosisIntroCta({ loggedIn: true, premium: true, eligible: true, daysLeft: 3 });
    assert.equal(waiting.label, "내 진단 보기");
    assert.equal(waiting.note, "다음 진단은 3일 뒤부터 받을 수 있어요.");
    const ready = diagnosisIntroCta({ loggedIn: true, premium: true, eligible: true, daysLeft: 0 });
    assert.equal(ready.label, "진단 받으러 가기");
    assert.equal(ready.note, null);
  });
});
