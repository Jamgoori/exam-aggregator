import { test } from "node:test";
import assert from "node:assert/strict";
import { getPaperDisplayTitle, stripTrackFromTitle } from "./paper-title";
import { applyExamTypeSubjectName, getSubjectDisplayName } from "./subject-label";
import { compareLevels, LEVEL_ORDER } from "./levels";
import { roundTierName, streakTierName } from "./tiers";
import { subjectColorIndex, SUBJECT_PALETTE_SIZE } from "./subject-color";
import { matchSubjectIds, parseSearchQuery } from "./search";
import type { Subject } from "./types";

// 웹과 앱이 같은 제목·정렬·등급·색을 내는지. 표현(Tailwind 클래스 / hex)은 각 앱에 있지만
// "무엇을 보여줄지" 판정은 전부 여기서 나온다.

// ── 제목 ────────────────────────────────────────────────────────────────
test("법원직 제목에서는 직류를 뗀다", () => {
  assert.equal(
    getPaperDisplayTitle("2026 법원직 9급 (전산서기보) 한국사", "전산서기보"),
    "2026 법원직 9급 한국사",
  );
});

test("법원직이 아니면 괄호 안 글자를 남기고 괄호만 없앤다", () => {
  assert.equal(
    getPaperDisplayTitle("2024 경찰 (간부후보) 1차", "간부후보"),
    "2024 경찰 간부후보 1차",
  );
});

test("직류가 없으면 제목을 그대로 둔다", () => {
  assert.equal(stripTrackFromTitle("2026 국가직 9급 국어", null), "2026 국가직 9급 국어");
  assert.equal(getPaperDisplayTitle("2026 국가직 9급 국어", null), "2026 국가직 9급 국어");
});

test("전각 괄호도 푼다", () => {
  assert.equal(getPaperDisplayTitle("2024 경찰（간부후보）1차", null), "2024 경찰간부후보1차");
});

// ── 시행처별 과목 표기 ──────────────────────────────────────────────────
// 군무원 문제지 표지는 "행정법"·"행정학"인데 업로드가 국가직 표기(행정법총론·
// 행정학개론)로 바꿔 저장했다. 저장값은 그대로 두고 화면에서만 되돌린다.
test("군무원 문제지는 제목의 과목명을 문제지 표기로 되돌린다", () => {
  assert.equal(
    getPaperDisplayTitle("2026 군무원 9급 행정법총론", null),
    "2026 군무원 9급 행정법",
  );
  assert.equal(
    getPaperDisplayTitle("2025 군무원 7급 행정학개론", null),
    "2025 군무원 7급 행정학",
  );
});

test("같은 과목이라도 다른 시행처 제목은 건드리지 않는다", () => {
  for (const title of [
    "2026 국가직 9급 행정법총론",
    "2026 지방직 9급 행정학개론",
    "2026 국회직 8급 행정법총론",
  ]) {
    assert.equal(getPaperDisplayTitle(title, null), title);
  }
});

test("군무원이라도 표기가 같은 과목은 그대로 둔다", () => {
  assert.equal(getPaperDisplayTitle("2026 군무원 9급 국어", null), "2026 군무원 9급 국어");
});

test("과목명은 제목 맨 뒤에서만 바꾼다", () => {
  // 시행처 자리(둘째 토큰)가 군무원이 아니면 제목 안에 글자가 겹쳐도 손대지 않는다.
  assert.equal(
    applyExamTypeSubjectName("2026 국가직 9급 군무원 행정법총론 해설"),
    "2026 국가직 9급 군무원 행정법총론 해설",
  );
});

test("과목 표시 이름은 시행처를 알 때만 바뀐다", () => {
  assert.equal(getSubjectDisplayName("행정법총론", "군무원"), "행정법");
  assert.equal(getSubjectDisplayName("행정학개론", "군무원"), "행정학");
  assert.equal(getSubjectDisplayName("행정법총론", "국가직"), "행정법총론");
  // 과목 페이지·오답노트처럼 여러 시행처가 섞이는 화면은 DB 이름이 정본이다.
  assert.equal(getSubjectDisplayName("행정법총론", null), "행정법총론");
});

// ── 급수 정렬 ───────────────────────────────────────────────────────────
test("급수는 9급 → 7급 → 5급 순", () => {
  // LEVEL_ORDER 를 그대로 기대값으로 쓰면 순서가 바뀌어도 통과하므로 리터럴로 고정한다.
  assert.deepEqual(LEVEL_ORDER, ["9급", "7급", "5급"]);
  assert.deepEqual(["5급", "9급", "7급"].sort(compareLevels), ["9급", "7급", "5급"]);
});

test("목록에 없는 급수는 뒤로 보낸다", () => {
  assert.deepEqual(["간부", "9급"].sort(compareLevels), ["9급", "간부"]);
  assert.ok(compareLevels("간부", "경위") !== 0);
});

// ── 등급 ────────────────────────────────────────────────────────────────
test("회독 등급 경계 — 경계값과 그 바로 아래를 함께 본다", () => {
  // 경계 위만 보면 기준이 한 칸 밀려도 통과해버린다. 아래쪽도 같이 고정한다.
  const cases: [number, string][] = [
    [10, "다이아"], [9, "플래티넘"],
    [6, "플래티넘"], [5, "골드"],
    [4, "골드"], [3, "실버"],
    [2, "실버"], [1, "브론즈"],
    // 0회독도 최하위 등급으로 떨어뜨린다(웹 getRoundTier 의 fallback 과 같은 동작).
    [0, "브론즈"],
  ];
  for (const [round, expected] of cases) {
    assert.equal(roundTierName(round), expected, `${round}회독`);
  }
});

test("스트릭 등급 경계 — 경계값과 그 바로 아래", () => {
  const cases: [number, string | null][] = [
    [30, "다이아"], [29, "골드"],
    [14, "골드"], [13, "실버"],
    [7, "실버"], [6, "브론즈"],
    [3, "브론즈"], [2, "새싹"],
    [1, "새싹"], [0, null],
  ];
  for (const [days, expected] of cases) {
    assert.equal(streakTierName(days), expected, `${days}일`);
  }
});

// ── 과목 색 ─────────────────────────────────────────────────────────────
test("과목 색 인덱스는 팔레트 범위 안이고 같은 slug 면 항상 같다", () => {
  for (const slug of ["korean", "english", "history", "", "행정법총론"]) {
    const idx = subjectColorIndex(slug);
    assert.ok(idx >= 0 && idx < SUBJECT_PALETTE_SIZE, `${slug} → ${idx}`);
    assert.equal(idx, subjectColorIndex(slug));
  }
});

// ── 검색 ────────────────────────────────────────────────────────────────
const SUBJECTS: Subject[] = [
  { id: "1", slug: "korean", name: "국어", display_order: 1 },
  { id: "2", slug: "chinese", name: "중국어", display_order: 2 },
  { id: "3", slug: "admin-law", name: "행정법총론", display_order: 3 },
  { id: "4", slug: "criminal-law", name: "형법", display_order: 4 },
  { id: "5", slug: "administration", name: "행정학개론", display_order: 5 },
];

test("이름이 검색어로 시작하는 과목이 있으면 그것만 보여준다", () => {
  // "국어"로 "중국어"까지 나오면 안 된다.
  assert.deepEqual(matchSubjectIds(SUBJECTS, "국어"), ["1"]);
});

test("시작하는 과목이 없을 때만 중간 포함까지 넓힌다", () => {
  assert.deepEqual(matchSubjectIds(SUBJECTS, "법").sort(), ["3", "4"]);
});

// 군무원은 "행정법"·"행정학"으로, 국가직·지방직은 "행정법총론"·"행정학개론"으로
// 부른다. 더 큰 개념인 앞 이름으로 검색하면 총론·개론 문제지까지 함께 나와야 한다
// (군무원 문제지도 같은 과목 행에 있으므로 한 번에 걸린다).
test("상위 개념 이름으로 검색하면 총론·개론까지 함께 나온다", () => {
  assert.deepEqual(matchSubjectIds(SUBJECTS, "행정법"), ["3"]);
  assert.deepEqual(matchSubjectIds(SUBJECTS, "행정학"), ["5"]);
  assert.deepEqual(matchSubjectIds(SUBJECTS, "행정").sort(), ["3", "5"]);
});

test("초성 검색", () => {
  assert.deepEqual(matchSubjectIds(SUBJECTS, "ㅎㅈㅂ"), ["3"]);
});

test("빈 검색어는 빈 결과", () => {
  assert.deepEqual(matchSubjectIds(SUBJECTS, "   "), []);
});

test("급수는 붙여 써도 뽑아낸다", () => {
  assert.deepEqual(parseSearchQuery("7급컴퓨터일반"), {
    level: "7급",
    year: undefined,
    examType: undefined,
    subjectQuery: "컴퓨터일반",
  });
});

test("급수·연도·시행처를 순서와 무관하게 뽑는다", () => {
  assert.deepEqual(parseSearchQuery("컴퓨터일반 2024 7급 국가직", ["국가직", "지방직"]), {
    level: "7급",
    year: 2024,
    examType: "국가직",
    subjectQuery: "컴퓨터일반",
  });
});

test("시행처는 토큰이 정확히 일치할 때만 — '경찰학'을 '경찰'로 먹지 않는다", () => {
  const parsed = parseSearchQuery("경찰학", ["경찰"]);
  assert.equal(parsed.examType, undefined);
  assert.equal(parsed.subjectQuery, "경찰학");
});

test("빈 검색어 파싱", () => {
  assert.deepEqual(parseSearchQuery("  "), { subjectQuery: "" });
});
