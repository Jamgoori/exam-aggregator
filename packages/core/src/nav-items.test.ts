import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_NAV, PRIMARY_NAV } from "./nav-items";
import { isAttendanceOpen } from "./attendance";

// 메뉴 순서는 "자료를 찾는다 → 되돌아본다 → 결제한다"다. 웹 헤더와 앱 드로어가 같은
// 배열을 읽으므로 순서가 바뀌면 두 곳이 동시에 바뀐다 — 의도한 변경인지 여기서 걸린다.
test("PRIMARY_NAV 순서와 라벨", () => {
  const labels = PRIMARY_NAV.map((i) => i.label);
  const expected = [
    "기출문제",
    "과목별",
    "섞어풀기",
    "오답노트",
    ...(isAttendanceOpen() ? ["출석체크"] : []),
    "AI 약점 진단",
    "자유게시판",
    "멤버십",
  ];
  assert.deepEqual(labels, expected);
  // 출석체크 항목은 기능이 열려 있을 때만 들어간다.
  assert.equal(labels.includes("출석체크"), isAttendanceOpen());
  assert.equal(PRIMARY_NAV[0].icon, "FileStack");
});

test("ACCOUNT_NAV 는 두 묶음(내 학습 기록 / 계정·결제)", () => {
  assert.equal(ACCOUNT_NAV.length, 2);
  assert.deepEqual(
    ACCOUNT_NAV[0].map((i) => i.label),
    ["마이페이지", "내 시험 기록", "즐겨찾기", "알림"],
  );
  assert.deepEqual(
    ACCOUNT_NAV[1].map((i) => i.label),
    ["결제 내역", "내 정보 수정", "건의게시판", "공지사항"],
  );
});

test("활성 판별은 경로만으로 한다", () => {
  const byLabel = (label: string) =>
    [...PRIMARY_NAV, ...ACCOUNT_NAV.flat()].find((i) => i.label === label)!;
  assert.equal(byLabel("기출문제").match("/papers/abc/cbt"), true);
  assert.equal(byLabel("기출문제").match("/subjects"), false);
  assert.equal(byLabel("섞어풀기").match("/subjects/korean/mix"), true);
  assert.equal(byLabel("섞어풀기").match("/mix"), true);
  assert.equal(byLabel("오답노트").match("/mypage/wrong-notes/korean"), true);
  assert.equal(byLabel("AI 약점 진단").match("/mypage/diagnosis"), true);
  // ?tab= 항목은 경로가 /mypage 그대로라 활성이 되지 않는다.
  assert.equal(byLabel("즐겨찾기").match("/mypage"), false);
  assert.equal(byLabel("마이페이지").match("/mypage"), true);
  assert.equal(byLabel("마이페이지").match("/mypage/edit"), false);
  assert.equal(byLabel("내 시험 기록").match("/mypage/attempts/1"), true);
});
