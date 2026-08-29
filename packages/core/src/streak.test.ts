import assert from "node:assert/strict";
import test from "node:test";
import { computeStreakDays } from "./streak";
import { kstDateKey, kstDayIndex } from "./attendance";

// KST 하루의 경계에서 만들어지는 ISO 문자열. 실행 환경 시간대와 무관하게 같은 순간을
// 가리키도록 UTC 로 적는다(KST = UTC+9).
const kstIso = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const utc = new Date(`${day}T00:00:00Z`).getTime() + (h - 9) * 3600_000 + m * 60_000;
  return new Date(utc).toISOString();
};

const daysAgoIso = (n: number, hhmm = "12:00") => {
  const dayIndex = kstDayIndex(new Date()) - n;
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dayIndex * 86_400_000 - 9 * 3600_000 + h * 3600_000 + m * 60_000).toISOString();
};

test("응시가 없으면 0", () => {
  assert.equal(computeStreakDays([]), 0);
});

test("오늘 풀었으면 오늘부터 센다", () => {
  assert.equal(computeStreakDays([daysAgoIso(0)]), 1);
});

test("오늘 안 풀었어도 어제까지 이어졌으면 그 길이를 센다", () => {
  assert.equal(computeStreakDays([daysAgoIso(1), daysAgoIso(2), daysAgoIso(3)]), 3);
});

test("하루라도 비면 거기서 끊는다", () => {
  // 오늘·어제는 풀었고 그저께는 안 풀었다 → 2
  assert.equal(computeStreakDays([daysAgoIso(0), daysAgoIso(1), daysAgoIso(3)]), 2);
});

test("같은 날 여러 번 풀어도 하루로 센다", () => {
  assert.equal(
    computeStreakDays([daysAgoIso(0, "01:00"), daysAgoIso(0, "13:00"), daysAgoIso(0, "23:30")]),
    1,
  );
});

test("오늘도 어제도 아니면 연속은 끊긴 것", () => {
  assert.equal(computeStreakDays([daysAgoIso(2), daysAgoIso(3)]), 0);
});

// 이 파일의 핵심 회귀 방지: 하루 경계는 실행 환경 시간대가 아니라 KST 00:00 이다.
// 예전 구현(toLocaleDateString("ko-KR"), 시간대 미지정)은 UTC 서버에서 KST 00:00~09:00
// 응시를 전날로 잡아, 같은 데이터로 웹과 앱이 다른 스트릭을 냈다.
test("KST 00:00~09:00 응시는 그날로 센다 (UTC 서버에서도)", () => {
  // 2026-08-29 KST 01:00 = 2026-08-28T16:00Z. UTC 로 보면 전날이다.
  const early = kstIso("2026-08-29", "01:00");
  assert.equal(new Date(early).toISOString().slice(0, 10), "2026-08-28");
  assert.equal(kstDayIndex(new Date(early)), kstDayIndex(new Date(kstIso("2026-08-29", "12:00"))));
});

test("KST 23:59 와 다음날 00:01 은 다른 날", () => {
  const late = kstDayIndex(new Date(kstIso("2026-08-29", "23:59")));
  const next = kstDayIndex(new Date(kstIso("2026-08-30", "00:01")));
  assert.equal(next - late, 1);
});

test("kstDayIndex 와 kstDateKey 는 같은 지점에서 하루를 자른다", () => {
  for (const [day, hhmm] of [
    ["2026-08-29", "00:00"],
    ["2026-08-29", "08:59"],
    ["2026-08-29", "09:00"],
    ["2026-08-29", "23:59"],
    ["2026-01-01", "00:00"],
    ["2025-12-31", "23:59"],
  ] as const) {
    const at = new Date(kstIso(day, hhmm));
    assert.equal(kstDateKey(at), day, `${day} ${hhmm}`);
    assert.equal(kstDayIndex(at), kstDayIndex(new Date(kstIso(day, "12:00"))), `${day} ${hhmm}`);
  }
});

// 실제로 어긋났던 상황들. 예전 구현을 UTC 서버에서 돌리면 아래 셋이 전부 틀렸다
// (차례로 1일, 2일, 2일). 공부 패턴상 가장 흔한 "밤에 풀고 다음날 아침에 또 푸는" 경우가
// 정확히 여기에 걸린다.
test("어젯밤 20시 + 오늘 아침 8시(KST) 는 이틀", () => {
  assert.equal(computeStreakDays([daysAgoIso(1, "20:00"), daysAgoIso(0, "08:00")]), 2);
});

test("사흘 내내 저녁·새벽으로 풀었으면 사흘", () => {
  assert.equal(
    computeStreakDays([
      daysAgoIso(2, "21:00"),
      daysAgoIso(1, "07:00"),
      daysAgoIso(1, "22:00"),
      daysAgoIso(0, "08:00"),
    ]),
    3,
  );
});

test("오늘 새벽·오전에 두 번 푼 건 하루 (이틀로 부풀지 않는다)", () => {
  assert.equal(computeStreakDays([daysAgoIso(0, "08:00"), daysAgoIso(0, "10:00")]), 1);
});

test("잘못된 날짜 문자열은 무시한다", () => {
  assert.equal(computeStreakDays(["", "not-a-date", daysAgoIso(0)]), 1);
});
