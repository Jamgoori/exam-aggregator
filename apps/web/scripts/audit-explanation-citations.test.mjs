// 판례 인용 검증기 회귀 테스트: node --test scripts/audit-explanation-citations.test.mjs
//                              (= npm run test-citations)
//
// 네트워크·DB 없이 도는 것만 넣는다. 여기서 지키려는 것은 실측에서 실제로 어긋났던
// 네 가지다:
//   1) 사건번호 추출이 평범한 숫자("2년 내 3회")를 사건번호로 삼지 않는가
//   2) 인용 문장을 자를 때 첫 글자가 잘려 나가지 않는가 (한 번 그랬다)
//   3) 특징어에 서술어('판단했습니다'·'침해하지')가 섞이지 않는가 —
//      섞이면 오기가 적중률 50%로 통과한다 (2026-08-22 실측)
//   4) CLI 실행 가드가 살아 있는가 — 어긋나면 루틴이 조용히 아무것도 안 한다

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  extractCitations,
  citationsOfRow,
  sentenceAround,
  contentTokens,
  topicMatch,
  narrowToCitation,
} from "./audit-explanation-citations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("헌재 사건번호를 연도 4자리·2자리 모두 뽑는다", () => {
  const found = extractCitations("헌재 2022. 11. 24. 2019헌마941 과 헌재 2001. 3. 21. 99헌마139 참조").map((c) => c.caseNo);
  assert.deepEqual(found, ["2019헌마941", "99헌마139"]);
});

test("사건번호 앞에 적힌 선고일을 함께 읽는다", () => {
  const [hit] = extractCitations("헌재 2015. 3. 26. 2013헌마461 결정입니다.");
  assert.equal(hit.statedDate, "2015-03-26");
});

test("선고일이 없으면 null 로 둔다 (없는 날짜를 지어내지 않는다)", () => {
  const [hit] = extractCitations("헌법재판소(2015헌바123)는 그렇게 보았습니다.");
  assert.equal(hit.statedDate, null);
});

test("병합 표기는 구성원 번호까지 각각 뽑는다", () => {
  const found = extractCitations("헌재 2021. 1. 28. 2019헌가24, 2019헌바404(병합)").map((c) => c.caseNo);
  assert.deepEqual(found, ["2019헌가24", "2019헌바404"]);
});

test("평범한 숫자+한글은 대법원 사건번호로 오인하지 않는다", () => {
  assert.deepEqual(extractCitations("등록이 취소된 날부터 2년 동안 등록할 수 없습니다."), []);
  assert.deepEqual(extractCitations("2018두12345 라고만 적혀 있으면 문맥이 없어 세지 않는다"), []);
  const withContext = extractCitations("대법원 2018. 5. 1. 선고 2018두12345 판결").map((c) => c.caseNo);
  assert.deepEqual(withContext, ["2018두12345"]);
});

test("인용 문장을 자를 때 첫 글자가 잘리지 않는다", () => {
  const text = "앞 문장입니다. 헌법재판소(2015헌바123)는 그렇게 보았습니다.";
  const s = sentenceAround(text, text.indexOf("2015헌바123"));
  assert.ok(s.startsWith("헌법재판소"), `문장이 잘렸습니다: ${s}`);
  assert.ok(!s.includes("앞 문장"), `앞 문장이 딸려 왔습니다: ${s}`);
});

test("선지 해설에서 나온 인용은 어느 선지인지까지 남긴다", () => {
  const row = {
    keyword_explanation: null,
    correct_choice_summary: null,
    current_answer_note: null,
    choice_explanations: [{ number: 4, explanation: "헌재 2015. 3. 26. 2013헌마461 참조." }],
  };
  const [hit] = citationsOfRow(row);
  assert.equal(hit.field, "choice_explanations[4].explanation");
  assert.equal(hit.caseNo, "2013헌마461");
});

test("특징어에 서술어가 섞이지 않는다", () => {
  const tokens = contentTokens("임대인의 재산권을 침해하지 않는다고 판단했습니다");
  assert.ok(!tokens.includes("판단했습니다"), tokens.join(","));
  assert.ok(!tokens.includes("침해하지"), tokens.join(","));
  assert.ok(tokens.includes("임대인"), tokens.join(","));
});

// 실측 회귀: 13번 ④ 해설이 든 2015헌바123 은 결정문에 '대물적'·'임대인'이 아예 없는
// 다른 사건이었다. 그 상황을 축약해 재현한다 — 배경 통계(df) 없이 "긴 낱말"로 고르던
// 예전 방식은 이 케이스를 통과시켰다.
test("다른 사건을 인용하면 적중률이 임계값 아래로 떨어진다", () => {
  const sentence =
    "헌법재판소는 석유판매업 등록취소 후 2년간 같은 시설 이용 등록제한을 대물적 처분으로 보아 임대인의 재산권을 침해하지 않는다고 판단했습니다.";
  const wrongCaseBody =
    "석유판매업자의 이동판매 차량 적재용량을 대통령령에 위임한 조항이 포괄위임금지원칙에 위반되는지 여부. 재산권을 침해하지 않는다고 판단했습니다.";
  const df = new Map([
    ["재산권", 40],
    ["판단", 90],
    ["석유판매업", 2],
    ["등록취소", 2],
    ["등록제한", 1],
    ["대물적", 1],
    ["임대인", 1],
    ["시설", 30],
  ]);
  const { ratio, missing } = topicMatch(sentence, wrongCaseBody, df, 200);
  assert.ok(ratio !== null, "판정이 보류되면 오기를 못 잡는다");
  assert.ok(ratio < 0.55, `적중률 ${ratio} — 임계값을 넘어 그냥 통과합니다`);
  assert.ok(missing.includes("대물적") && missing.includes("임대인"), missing.join(","));
});

test("맞는 사건을 인용하면 통과한다", () => {
  const sentence =
    "헌법재판소는 처방대상 동물용의약품 규정에 대한 동물보호자의 자기관련성을 간접적·사실적 이해관계에 불과하다며 부정했습니다.";
  const rightCaseBody =
    "처방대상 동물용의약품 지정에 관한 규정 제3조. 동물보호자인 청구인들이 받는 불이익은 간접적·사실적·경제적인 것에 지나지 않아 자기관련성이 인정되지 않는다.";
  const df = new Map([
    ["처방대상", 1],
    ["동물용의약품", 1],
    ["동물보호자", 1],
    ["자기관련성", 3],
    ["간접적", 2],
    ["이해관계", 5],
  ]);
  const { ratio } = topicMatch(sentence, rightCaseBody, df, 200);
  assert.ok(ratio === null || ratio >= 0.55, `적중률 ${ratio} — 멀쩡한 인용이 의심으로 잡힙니다`);
});

test("특징어가 4개도 안 되면 판정을 보류한다 (짧은 문장 오탐 방지)", () => {
  const { ratio } = topicMatch("종전에는 합헌으로 보았으나", "아무 내용", new Map(), 200);
  assert.equal(ratio, null);
});

// 실행 가드 회귀: main() 이 안 돌면 루틴은 조용히 0건으로 끝난다. 직접 실행했을 때
// 플래그 검증이 작동하는지로 "main() 이 실제로 돈다"를 확인한다 (DB 접속 전에 끝난다).
test("CLI 로 직접 실행하면 main() 이 돈다", () => {
  const script = join(HERE, "audit-explanation-citations.mjs");
  let stderr = "";
  let code = 0;
  try {
    execFileSync(process.execPath, [script, "--bogus"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status;
    stderr = e.stderr ?? "";
  }
  assert.equal(code, 1, "알 수 없는 플래그인데 종료 코드가 1이 아닙니다");
  assert.match(stderr, /알 수 없는 플래그/);
});

test("--limit=300 처럼 = 문법을 쓰면 즉시 멈춘다", () => {
  const script = join(HERE, "audit-explanation-citations.mjs");
  let stderr = "";
  let code = 0;
  try {
    execFileSync(process.execPath, [script, "--limit=300"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status;
    stderr = e.stderr ?? "";
  }
  assert.equal(code, 1);
  assert.match(stderr, /=문법 금지/);
});

// 실측 회귀: 한 문장이 사건 여러 개를 들 때, 옆 지문의 낱말이 특징어로 새어 들어오면
// 번호가 맞는 인용이 의심으로 잡힌다. 전수 실행에서 약(弱) 의심의 대부분이 이 모양이었다.
test("괄호 안 인용은 그 괄호 몫만 대조 범위로 삼는다", () => {
  const sentence =
    "ㄱ(부부 자산소득 합산과세 위헌, 헌재 2002. 8. 29. 2001헌바82)과 ㄴ(친생부인의 소 2년 제척기간 합헌)은 옳지만, ㄹ이 빠져 있습니다.";
  const ctx = narrowToCitation(sentence, "2001헌바82");
  assert.ok(ctx.includes("합산과세"), ctx);
  assert.ok(!ctx.includes("친생부인"), `옆 지문이 새어 들어왔습니다: ${ctx}`);
});

test("사건번호가 여럿인 문장은 자기 구간만 본다", () => {
  const sentence =
    "ㄱ: 기탁금을 반환하지 않는 것은 재산권 침해 2016헌마541. ㄴ: 선거비용을 보전대상에서 제외한 조항은 합헌 2016헌마524. ㄷ: 2010헌마601 은 투표 개시시각 부분을 헌법불합치로 보았습니다.";
  const ctx = narrowToCitation(sentence, "2010헌마601");
  assert.ok(ctx.includes("투표"), ctx);
  assert.ok(!ctx.includes("기탁금") && !ctx.includes("보전대상"), `옆 지문이 새어 들어왔습니다: ${ctx}`);
});

test("사건번호가 하나뿐이면 문장을 그대로 쓴다", () => {
  const sentence = "헌재는 좌석안전띠 착용 의무가 일반적 행동자유권을 제한한다고 보았습니다(2002헌마518).";
  assert.equal(narrowToCitation(sentence, "없는번호"), sentence);
});
