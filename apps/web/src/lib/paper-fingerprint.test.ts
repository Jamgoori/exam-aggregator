import { strict as assert } from "node:assert";
import { test } from "node:test";
import { paperFingerprintsDiffer } from "./paper-fingerprint";

// 이 판정이 고장나는 두 방향은 값이 다르다.
//  - 너무 자주 true: 매일 문제지 4,400장이 재생성돼 ISR Writes 요금이 되돌아간다.
//  - 너무 자주 false: CLI 로 올린 문제지가 최대 7일간 사이트에 안 나온다.
// 그래서 양쪽을 다 고정해 둔다.

test("지문이 같으면 만료시키지 않는다 — 업로드 없는 날 재생성을 막는 핵심", () => {
  const same = { count: 4400, latest: "2026-09-01T00:00:00+00:00" };
  assert.equal(paperFingerprintsDiffer(same, { ...same }), false);
});

test("새 업로드로 행 수가 늘면 만료시킨다", () => {
  assert.equal(
    paperFingerprintsDiffer(
      { count: 4401, latest: "2026-09-02T00:00:00+00:00" },
      { count: 4400, latest: "2026-09-01T00:00:00+00:00" },
    ),
    true,
  );
});

test("행 수가 같아도 최신 업로드 시각이 다르면 만료시킨다(같은 수만큼 지우고 넣은 경우)", () => {
  assert.equal(
    paperFingerprintsDiffer(
      { count: 4400, latest: "2026-09-02T00:00:00+00:00" },
      { count: 4400, latest: "2026-09-01T00:00:00+00:00" },
    ),
    true,
  );
});

test("문제지를 지워 행 수가 줄어도 만료시킨다", () => {
  const latest = "2026-09-01T00:00:00+00:00";
  assert.equal(
    paperFingerprintsDiffer({ count: 4399, latest }, { count: 4400, latest }),
    true,
  );
});

test("캐시가 비어 있으면(첫 배포) 만료시킨다", () => {
  assert.equal(
    paperFingerprintsDiffer(
      { count: 4400, latest: "2026-09-01T00:00:00+00:00" },
      { count: 0, latest: null },
    ),
    true,
  );
});

test("실시간 조회가 0장으로 오면 만료시키지 않는다 — 조회 실패로 매일 재생성하는 것을 막는다", () => {
  assert.equal(
    paperFingerprintsDiffer(
      { count: 0, latest: null },
      { count: 4400, latest: "2026-09-01T00:00:00+00:00" },
    ),
    false,
  );
});
