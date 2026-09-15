import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asClient, FakeSupabase } from "../test-support/fake-supabase";
import { fetchAttendanceSummary, nextMonthKey } from "./attendance";

describe("nextMonthKey", () => {
  it("12월은 다음 해 1월로 넘어간다", () => {
    assert.equal(nextMonthKey("2026-12-01"), "2027-01-01");
    assert.equal(nextMonthKey("2026-09-01"), "2026-10-01");
  });
});

describe("fetchAttendanceSummary", () => {
  it("이번 달(KST) 본인 행만 세고, qualified_at 이 없는 날은 출석에서 뺀다", async () => {
    const USER = "user-1";
    const fake = new FakeSupabase({
      attendance_days: [
        { user_id: USER, attend_date: "2026-09-14", question_count: 12, qualified_at: "2026-09-14T03:00:00Z" },
        { user_id: USER, attend_date: "2026-09-15", question_count: 4, qualified_at: null },
        { user_id: USER, attend_date: "2026-08-31", question_count: 20, qualified_at: "2026-08-31T03:00:00Z" },
        { user_id: "other", attend_date: "2026-09-10", question_count: 20, qualified_at: "2026-09-10T03:00:00Z" },
      ],
      attendance_grants: [
        { user_id: USER, month: "2026-09-01", milestone: 5 },
        { user_id: USER, month: "2026-08-01", milestone: 10 },
      ],
    });
    // 2026-09-15 20:00 KST.
    const now = new Date("2026-09-15T11:00:00Z");
    const summary = await fetchAttendanceSummary(asClient(fake), USER, now);
    assert.equal(summary.month, "2026-09-01");
    assert.equal(summary.today, "2026-09-15");
    assert.deepEqual(summary.attendedDates, ["2026-09-14"]);
    assert.equal(summary.todayQuestions, 4);
    assert.deepEqual(summary.grantedMilestones, [5]);
  });
});
