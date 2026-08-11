// 사용법: npm run crop-questions -- --paper-id <uuid> [--dry-run] [--scale 3]
//
// exam_papers에 이미 업로드된 문제지 PDF를 다운로드해서, 페이지 텍스트 레이아웃에서
// "N." 형태의 문제 번호 위치를 찾아 2단 편집 기준으로 문항별 영역을 잘라낸다.
// 잘라낸 이미지는 exam-papers 버킷의 questions/<paperId>/ 아래 업로드하고,
// questions/question_images 테이블에 등록한다 (재실행 시 upsert로 덮어씀).
//
// 이 스크립트는 "좌우 2단 조판 + 문제 번호가 각 단 왼쪽 여백에 붙는" 표준 공무원
// 시험 PDF 레이아웃을 가정한다. "[N~M]" 안내문이 걸린 세트문제는 공통지문형이면
// 한 덩어리로 병합하고, 지시문 재사용형이면 안내문 줄을 각 문제 위에 이어붙인다
// (아래 cropQuestionsFromPage 참고). 그 밖의 레이아웃(1단, 3단)은 지원하지 않는다.

import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// 문제 번호 마커: 줄 맨 앞의 "12." 같은 토큰. 정답표의 "①" 등 선지 기호와
// 헷갈리지 않도록 아라비아 숫자 + 마침표 형태만 허용한다.
// PDF 텍스트 추출은 낱말 경계가 아니라 원본 조판의 텍스트 조각(run) 단위로 잘리기
// 때문에, 문제가 "(가)"나 "1910년"처럼 괄호/숫자로 곧장 시작하면 "2. ("나 "18. 1910"
// 처럼 마커 뒤 내용이 같은 조각에 붙어버려 예전 정규식(완전 일치)이 놓쳤다. 접두사만
// 확인하도록 완화한다 — 문단 안 번호 목록("1. 첫 번째 사료")을 잘못 집어도, 같은
// 번호가 실제 문제 마커와 충돌하면 아래 main()의 "문제 번호 중복 감지"가 하드
// 에러로 멈춰 안전망 역할을 한다.
// 앞의 "문" 표시는 보통 번호와 별도 조각으로 떨어지지만("문" / "1. ...") 일부
// 문제지(옛날 PDF 등)는 같은 조각에 "문 11. ..."처럼 붙어 나온다 — 이 경우도
// 놓치지 않도록 선택적 "문" 접두사를 허용한다.
// 마침표 뒤에 공백 없이 본문이 붙는 조판은 이 엄격형으로는 안 잡힌다 — 아래
// RELAXED_QUESTION_MARKER_RE가 "빠진 번호 메우기" 용도로만 따로 처리한다. 다만
// 마침표 바로 뒤에 「(법령·문헌명 인용 여는 낫표)가 오는 경우는 예외로 엄격형에
// 포함한다 — 이 조합("5.「수사첩보및처리규칙」상…")은 법령 인용이 잦은 수사/경찰
// 과목에서 흔한데(실측: 2014 경찰 공채 1차 수사, 2017 경찰 공채 2차 수사), 한
// 칼럼의 마커 전부가 이 형태라 완화형 "빠진 번호 메우기"조차 기준 여백을 못
// 구해 실패했다(그 칼럼에 엄격형 마커가 단 하나도 없어 docMarginX가 통째로
// 안 잡힘). 「는 문단 중간 목록 항목 맨 앞에 거의 안 나오는 문자라(법령명 인용은
// 항상 그 인용이 시작하는 지점에서만 낫표가 열린다) 공백과 똑같이 신뢰할 수 있다.
const QUESTION_MARKER_RE = /^(?:문\s*)?(\d{1,3})\.(?:\s|「|$)/;

// 법원직 조판은 마침표 대신 각괄호를 쓴다: "【문 1】다음 중 기본권 제한에 관한…".
// 각괄호와 "문"이 함께 오는 조합은 지문 인용이나 보기 목록에 나오지 않아 그 자체로
// 신뢰할 수 있는 마커다(과목 머리글 "【헌 법 25문】"은 여는 괄호 다음이 "문"이
// 아니라 안 걸린다). 조각이 "【" / "문" / "1" / "】"로 쪼개져 나오는 경우까지
// 잡으려고 findQuestionMarkers에서 같은 줄의 조각을 이어붙인 문자열에도 적용한다.
const BRACKET_QUESTION_MARKER_RE = /^【\s*문\s*(\d{1,3})\s*】/;
// 같은 마커가 조각으로 갈려 나오는 자리가 제각각이다(한 문제지 안에서도 섞인다):
//   "【문" + "2】<표>와…"        (실측: 2020 법원직 9급 한국사 2·5·9번)
//   "【"   + "문 1】다음 설명…"   (실측: 2014 법원직 9급 민법 1·23·24·25번)
// 그래서 여는 "【" 조각을 만나면 같은 줄의 뒤 조각 몇 개를 이어붙인 문자열에
// 마커 정규식을 다시 걸어본다. 좌표는 여는 조각(칼럼 왼쪽 끝)을 쓴다.
const BRACKET_JOIN_LOOKAHEAD = 4;

// 완화형 마커: 마침표 뒤에 공백 없이 본문이 곧장 붙는 조판을 잡는다(실측: 2017
// 경찰간부 경찰학개론 `4.「경찰법」과 …`가 40문항 중 14개, 2014 경찰간부
// 형사소송법 `10.상소에 관한 …`이 1개 통째로 누락). 다만 이 형태를 처음부터
// 일반 마커로 쓰면 지문 속 번호 목록("1.한국은 …")까지 걸려 멀쩡하던 문제지가
// 깨진다(실측: 국가직 5·7급 상황판단, 지방직 7급 국어). 그래서 아래
// extractQuestionsFromPdf에서 "엄격형으로 찾은 번호 사이에 빠진 번호"를 메울
// 때만 후보로 쓴다.
const RELAXED_QUESTION_MARKER_RE = /^(?:문\s*)?(\d{1,3})\.(?!\d)/;

// 문제 번호 마커의 텍스트 상단(marker.y 기준 위쪽 여백). 다음 문제와의 간격이
// 실측상 최소 30pt 이상이라 10pt 정도는 어느 쪽 문제 내용도 침범하지 않는다.
const TOP_PAD = 10;
// 단(칼럼) 안쪽 여백 및 페이지 좌우 여백
const COLUMN_GAP = 4;
const PAGE_MARGIN_X = 6;
// 마지막 문제(다음 마커가 없는 경우)는 페이지 하단까지 넉넉히 잘라서 잘림을 방지
const BOTTOM_MARGIN = 4;

async function renderPageToPng(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return { buffer: canvas.toBuffer("image/png"), width: viewport.width, height: viewport.height };
}

// 숫자(또는 "문 15")만 있는 조각과 마침표로 시작하는 조각이 따로 떨어져 나오는
// PDF도 있다 — 이 경우 QUESTION_MARKER_RE가 어느 조각에도 안 걸려 마커를 통째로
// 놓친다. 마침표 조각은 "."만 있을 때도 있고(예: "19"+"."), 마침표 뒤에 문제
// 본문이 그대로 붙어 나올 때도 있다(예: "문 15"+". 조류인플루엔자..."). 같은
// 줄(y 거의 동일)에서 숫자 조각 바로 다음 조각이 "."로 시작하고, 그 조각의
// 시작 x가 숫자 조각이 끝나는 지점(x+width) 가까이(20pt 이내) 붙어 있으면 같은
// 마커로 합쳐 인식한다.
const BARE_NUMBER_RE = /^(?:문\s*)?(\d{1,3})$/;

// "[문 2.～문 4.] 밑줄 친 부분에 들어갈 말로..." / "[7～8] 다음 글을 읽고 물음에
// 답하시오." 처럼 여러 문제에 걸리는 안내문에는 항상 대괄호로 감싼 "N~M" 번호
// 범위가 있다. 과목에 따라 앞에 "※"가 붙기도 하고(영어) 안 붙기도 해서(국어)
// "※" 유무로는 못 가리므로, 대괄호 패턴 자체를 앵커로 삼는다. 이 줄 안에도
// "N." 형태가 그대로 들어있어 진짜 마커와 똑같이 매치되니, 이 줄(y, 칼럼 동일)에
// 서는 숫자 마커 후보를 아예 인정하지 않는다 — 2단 조판이라 왼쪽 칼럼의 진짜
// 마커와 오른쪽 칼럼의 안내문이 페이지 맨 위 등에서 우연히 같은 y에 놓일 수
// 있으므로, y뿐 아니라 같은 칼럼(좌/우)인지까지 같이 봐야 한다. 물결표(～/~)는
// 일부 PDF에서 폰트에 유니코드 매핑이 없어 텍스트로 아예 추출되지 않는 경우가
// 있어(예: "[문 11. 문 12.]"로 물결표 없이 두 조각만 남음) 필수로 두면 그 줄의
// 안내문 인식 자체가 통째로 실패해 "문 11."이 실제 마커로 오인된다 — 그렇다고
// 완전히 선택으로 풀면(둘 다 생략 가능) "a[30]"처럼 배열/인덱스 표기가 흔한
// 과목(자료구조론 등)에서 숫자 "30"이 "3"과 "0"으로 쪼개져 가짜 범위 [3~0]으로
// 오매치되고, 그 줄 전체가 안내문 취급되어 진짜 문제 마커가 통째로 사라진다
// (실측: 2018/2014 국가직 7급 자료구조론에서 13번 마커 소실). 두 숫자 사이에
// 물결표나 "문" 둘 중 하나는 반드시 있어야 진짜 구분자로 인정한다 — 순수하게
// 붙어있는 숫자(구분자 0글자)는 걸러진다. 물결표는 PDF마다 다른 유니코드로
// 나온다(～ U+FF5E, ~ U+007E, ∼ U+223C TILDE OPERATOR — 실측: 2022 국가직
// 7급 독어 "[문 4∼문 5.]").
const ANNOTATION_RANGE_RE = /\[\s*(?:문\s*)?(\d{1,3})\s*\.?\s*(?:[～~∼]|문)\s*\.?\s*(?:문\s*)?(\d{1,3})\s*\.?\s*\]/;

// 같은 시각적 줄에 있어도 글자마다(특히 대괄호·물결표 같은 특수 글리프) y가
// 소수점 단위로 미세하게 흔들릴 수 있다. 원시 y를 그대로 키로 쓰면 그 흔들림
//때문에 한 줄이 여러 조각으로 쪼개져 안내문 정규식이 매치되지 않고, 그 결과
// 안내문 속 "문 11." 같은 텍스트가 제외되지 않은 채 진짜 마커로 오인된다.
// 정수로 반올림해 묶으면(줄 간격은 보통 수십 pt라 오인식 위험은 없다) 이 문제가
// 없어진다.
function lineKey(y, col) {
  return `${Math.round(y)}|${col}`;
}

function findAnnotationLines(items, half) {
  const lines = new Map();
  items.forEach((item, idx) => {
    const [, , , , x, y] = item.transform;
    const col = x < half ? "L" : "R";
    const key = lineKey(y, col);
    if (!lines.has(key)) lines.set(key, { y, col, height: 0, parts: [] });
    const line = lines.get(key);
    // 한 줄 안에서 가장 큰 글자 높이를 그 줄의 높이로 본다 — 크롭 경계를 잡을 때
    // 이 줄의 잉크가 baseline 위로 얼마나 올라오는지 가늠하는 데 쓴다.
    if (item.height > line.height) line.height = item.height;
    line.parts.push({ x, str: item.str, idx });
  });

  // 같은 칼럼 안에서 위→아래(y 내림차순) 순서로 줄을 늘어놓는다 — 안내문이
  // 줄바꿈으로 두 줄에 걸치는 경우(예: "...밑줄 친 부분에... [문 19～" 다음
  // 줄에 "문 20.]") 인접한 다음 줄과 이어붙여 다시 검사하기 위해서다. 이런
  // 경우 한 줄만으로는 "[" 만 있고 "]"가 없어(또는 그 반대) 안내문으로 인식
  //못 하고 그 안의 "19." "20."이 진짜 마커로 오인돼 중복 크래시가 났다
  // (실측: 2022 지방직 9급 영어).
  const linesByCol = new Map();
  const allLines = [];
  for (const [, line] of lines) {
    const sorted = line.parts.sort((a, b) => a.x - b.x);
    const text = sorted.map((p) => p.str).join("");
    if (!linesByCol.has(line.col)) linesByCol.set(line.col, []);
    linesByCol.get(line.col).push({
      y: line.y,
      height: line.height,
      text,
      indices: sorted.map((p) => p.idx),
    });
    if (text.trim()) allLines.push({ y: line.y, col: line.col, height: line.height, text: text.trim() });
  }
  for (const arr of linesByCol.values()) arr.sort((a, b) => b.y - a.y);

  // 안내문에 걸려 제외할 조각은 (y, col) 좌표 키가 아니라 items 배열의 원본
  // 인덱스로 직접 추적한다. 좌표 키를 쓰면, 안내문과 무관한 다른 조각이 우연히
  // 같은 반올림 y·같은 칼럼에 놓였을 때 그 조각까지 같은 키로 묶여 통째로
  // 지워진다(실측: 2026 국회직 8급 상황판단 — 왼쪽 안내문과 같은 y에 있던
  // 오른쪽 칼럼의 진짜 마커 "20."이 소실). 조각 자체를 인덱스로 지목하면 좌표
  // 재해석에서 오는 이런 오차가 아예 생기지 않는다.
  const consumedIndices = new Set();
  const groups = [];
  for (const [col, arr] of linesByCol) {
    for (let i = 0; i < arr.length; i++) {
      const line = arr[i];
      let match = ANNOTATION_RANGE_RE.exec(line.text);
      const usedIndices = [...line.indices];
      if (!match && line.text.includes("[") && !line.text.includes("]")) {
        const next = arr[i + 1];
        if (next) {
          match = ANNOTATION_RANGE_RE.exec(line.text + next.text);
          if (match) usedIndices.push(...next.indices);
        }
      }
      if (!match) continue;
      for (const idx of usedIndices) consumedIndices.add(idx);
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (end > start && end - start <= 10) {
        groups.push({ start, end, y: line.y, height: line.height, col });
      }
    }
  }
  return { consumedIndices, groups, allLines };
}

// columnSplitX: 실측 칼럼 경계(computeColumnSplitX). 아직 모르는 최초 호출(1차
// 패스)에서는 생략해 페이지 폭 절반으로 대체한다 — 안내문 줄 분류(findAnnotationLines의
// col)가 틀리면, 우측 칼럼 마커가 좌측 여백의 안내문과 같은 줄로 잘못 묶여 안내문
// 텍스트로 오인되고 통째로 사라진다(실측: 2026 국회직 8급 상황판단 20번 마커가
// "[문 19.∼문 20.]" 안내문과 같은 줄(y=966, 둘 다 x<페이지폭/2)로 오인 병합되어
// 소실). extractQuestionsFromPdf가 1차 패스로 대략의 columnSplitX를 구한 뒤,
// 이를 넘겨 2차로 다시 호출해 정확한 안내문 분류로 재추출한다.
async function findQuestionMarkers(page, columnSplitX) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i) => "str" in i);
  const half = columnSplitX ?? viewport.width / 2;
  const { consumedIndices, groups, allLines } = findAnnotationLines(items, half);

  // "문"이 단독 조각으로 떨어져 나온 자리들을 (같은 줄, x) 기준으로 미리 모아둔다
  // — items 배열 순서가 항상 시각적 왼쪽→오른쪽 순서라는 보장이 없어서(콘텐츠
  // 스트림 기록 순서를 따르므로 2단 조판 등에서 뒤섞일 수 있다) "바로 이전
  // 인덱스가 문인지"로는 놓치는 경우가 실측에서 나왔다. y를 반올림해 묶는다.
  const munXsByLine = new Map();
  for (const item of items) {
    if (item.str.trim() !== "문") continue;
    const [, , , , x, y] = item.transform;
    const key = Math.round(y);
    if (!munXsByLine.has(key)) munXsByLine.set(key, []);
    munXsByLine.get(key).push(x);
  }
  // 같은 줄에 있기만 하면 다 인정하면 안 된다 — 실측(2021 국가직 7급 세법)에서
  // "문 7. ..." 뒤로 456pt나 떨어진, 전혀 다른 문제의 날짜 표기 조각("1.")이
  // "문 7."의 "문"을 자기 것으로 착각해 진짜 마커로 오인된 사례가 있다. 바로
  // 왼쪽(가장 가까운)의 "문"만 보고, "문"+숫자 정상 간격(실측 10~20pt)보다
  // 넉넉히 여유를 둔 30pt 안에 있을 때만 유효한 것으로 본다.
  const MUN_ADJACENCY_PT = 30;
  function hasMunBefore(x, y) {
    const xs = munXsByLine.get(Math.round(y));
    if (!xs) return false;
    const nearest = Math.max(...xs.filter((munX) => munX < x), -Infinity);
    return nearest !== -Infinity && x - nearest <= MUN_ADJACENCY_PT;
  }

  const markers = [];
  const relaxedMarkers = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const str = item.str.trim();
    if (!str) continue;
    const [, , , , itemX, itemY] = item.transform;
    if (consumedIndices.has(i)) continue;

    // 진짜 문제 마커는 거의 항상 "문"이 앞에 붙는다(같은 조각이든 "문"만 따로
    // 떨어진 조각이든) — 지문 속 조항·보기 번호("1. 다음의 농지는...")에는
    // "문"이 절대 안 붙는다. 이 유무가 위치(x)보다 훨씬 믿을 수 있는 신호라
    // filterMarginMarkers에서 "문 확인된 마커"를 우선 신뢰하는 데 쓴다.
    const hasMun = /^문\s*/.test(str) || hasMunBefore(itemX, itemY);

    // 각괄호형(법원직)은 "문"이 괄호 안에 있어 hasMun 정규식(^문)에 안 걸리지만
    // 실제로는 가장 믿을 수 있는 마커다 — 신뢰 마커로 표시해 filterMarginMarkers가
    // 여백 기준을 이걸로 세우게 한다.
    const bracketMatch = BRACKET_QUESTION_MARKER_RE.exec(str);
    if (bracketMatch) {
      const [, , , , x, y] = item.transform;
      markers.push({ number: Number(bracketMatch[1]), x, y, height: item.height, hasMun: true });
      continue;
    }

    // 조각이 "【" 뒤 어딘가에서 갈린 경우: 같은 줄의 뒤 조각을 이어붙여 다시 본다.
    if (str.startsWith("【")) {
      let joined = str;
      for (let j = i + 1; j < items.length && j <= i + BRACKET_JOIN_LOOKAHEAD; j++) {
        const nextItem = items[j];
        const [, , , , , nextY] = nextItem.transform;
        if (Math.abs(nextY - itemY) > 2) break;
        joined += nextItem.str;
        const joinedMatch = BRACKET_QUESTION_MARKER_RE.exec(joined);
        if (joinedMatch) {
          markers.push({
            number: Number(joinedMatch[1]),
            x: itemX,
            y: itemY,
            height: item.height,
            hasMun: true,
          });
          break;
        }
      }
      continue;
    }

    const match = QUESTION_MARKER_RE.exec(str);
    if (match) {
      const [, numStr] = match;
      const [, , , , x, y] = item.transform;
      markers.push({ number: Number(numStr), x, y, height: item.height, hasMun });
      continue;
    }

    // 완화형은 따로 모아둔다 — 빠진 번호를 메울 때만 쓴다.
    const relaxedMatch = RELAXED_QUESTION_MARKER_RE.exec(str);
    if (relaxedMatch) {
      const [, , , , x, y] = item.transform;
      relaxedMarkers.push({
        number: Number(relaxedMatch[1]),
        x,
        y,
        height: item.height,
        hasMun,
      });
      continue;
    }

    const bareMatch = BARE_NUMBER_RE.exec(str);
    if (!bareMatch) continue;
    const next = items[i + 1];
    if (!next || !next.str.trim().startsWith(".")) continue;
    const [, , , , x1, y1] = item.transform;
    const [, , , , x2, y2] = next.transform;
    const x1End = x1 + (item.width ?? 0);
    if (Math.abs(y1 - y2) > 2 || x2 < x1 || x2 - x1End > 20) continue;
    markers.push({ number: Number(bareMatch[1]), x: x1, y: y1, height: item.height, hasMun });
  }
  return {
    markers,
    relaxedMarkers,
    groups,
    // 페이지의 모든 텍스트 줄(칼럼·baseline·글자높이). 크롭 하단 경계를 "다음
    // 문제의 잉크가 시작되기 직전 여백"에 정확히 놓는 데 쓰고, 페이지마다
    // 되풀이되는 머리글/꼬리말(쪽번호 등)을 찾아내는 데도 쓴다.
    lines: allLines,
    pageWidthPt: viewport.width,
    pageHeightPt: viewport.height,
  };
}

// 국어·영어·한국사처럼 지문이 있는 과목은 지문 안에 번호 매긴 보기/조항이
// 들어있는 경우가 있어("1. 첫 문장 2. 둘째 문장", 법조문 인용 "1. 다음의
// 농지는...") 본문 들여쓰기만큼 더 오른쪽에 찍혀 같은 정규식에 걸린다. 처음엔
// "여백 x가 가장 작은 클러스터만 인정"하는 위치 기반 필터를 썼지만, 실측해보니
// 진짜 마커끼리의 자릿수/조각분리 흔들림(최대 ~24pt, 1단 편집 2015 경력경쟁
// 9급 식용작물 "문 10." vs "문"+"5.")과 지문 속 가짜 번호의 최소 들여쓰기
// (~23pt, 2016 지방직 9급 한국사 법조문 인용)가 겹쳐서, x 간격만으로는 어떤
// 임계값을 잡아도 둘 중 하나를 반드시 잘못 처리했다.
//
// 대신 훨씬 믿을 수 있는 신호를 쓴다: 진짜 문제 마커는 예외 없이 "문"이 앞에
// 붙지만(같은 조각이든 "문"만 따로 뗀 조각이든 — findQuestionMarkers가 hasMun
// 으로 표시해둔다), 지문 속 조항·보기 번호에는 "문"이 절대 안 붙는다. "문"이
// 확인된 마커는 위치와 무관하게 무조건 신뢰하고, 그 신뢰 마커들이 실제로 걸쳐
// 있는 x 범위(자릿수 흔들림이 이미 반영된 실측 범위) 안에 있는 "문" 없는
// 마커만 추가로 인정한다 — 그 범위 밖은 지문 속 텍스트로 본다. "문" 신호가
// 페이지에 하나도 없는 극히 드문 경우에만 예전 클러스터링으로 폴백한다.
const MARGIN_CLUSTER_GAP_PT = 25;
const TRUSTED_MARGIN_TOLERANCE_PT = 5;
// "문" 신호가 아예 없는 문제지(경찰 간부후보 등 "1." 형태만 쓰는 조판)에서
// 쓰는 문서 전체 기준 여백 x의 허용 오차. 지문 속 인용 번호가 진짜 마커보다
// 겨우 7pt 안쪽으로 들여쓰인 사례가 있어(실측: 2017 경찰간부 한국사, 2018
// 경찰간부 세법개론 — 진짜 375pt vs 지문 382pt) 페이지 단위 25pt 클러스터링
// 으로는 구분이 안 됐다.
const DOC_MARGIN_TOLERANCE_PT = 10;
// 문서 전체 마커 중 최빈 x가 이 비율 미만이면 여백이 흔들리는 조판으로 보고
// 예전 클러스터링으로 되돌린다(1단 편집 등에서 자릿수/조각분리로 x가 크게
// 흔들리는 문제지를 잘못 걸러내지 않기 위한 안전장치).
const DOC_MARGIN_MIN_SHARE = 0.5;

// 2단 편집인지, 그리고 좌/우 칼럼의 경계 x가 얼마인지를 실측 마커 위치에서
// 직접 구한다. 예전에는 "페이지 폭의 정확히 절반(pageWidthPt/2)"을 경계로
// 썼는데, 이 가정이 깨지는 조판이 있다(실측: 국회직 PDF는 폭 729pt에 우측 칼럼이
// x=360에서 시작 — 정확한 절반 364.5보다 4.5pt 왼쪽). 이 정도면 "우측 칼럼
// 마커가 하나도 없음"으로 오판되어(hasRightColumnMarker 기준 미달) 문서 전체가
// 1단으로 취급되고, filterMarginMarkers가 좌/우 마커를 한 덩어리로 놓고 클러스터링
// 하면서 소수인 우측 칼럼 마커 전부가 "지문 속 번호"로 오인되어 통째로 사라진다
// (실측: 2025 국회직 9급 건축계획 20문항 중 9개 소실, 다른 국회직 문제지 다수
// 동일 증상). 페이지 폭 절반 대신, 문서 전체 마커 x를 정렬해 가장 큰 간격을
// 찾는다 — 진짜 칼럼 경계(보통 300pt 이상)는 같은 칼럼 안의 자릿수/조각분리
// 흔들림(최대 ~25pt, MARGIN_CLUSTER_GAP_PT 참고)보다 훨씬 크므로 이 둘은 항상
// 뚜렷하게 갈린다.
const COLUMN_SPLIT_MIN_GAP_PT = 80;
// 진짜 칼럼 여백은 "그 문서에서 가장 많이 반복되는 x"다 — 매 문제마다 같은
// 자리에서 시작하기 때문이다. 반면 지문 속 표/목록의 가짜 번호는 특정 목록
// 안에서만 몇 번 반복되고 문서 전체로 보면 드물다. 그래서 단순히 "가장 큰
// 간격"으로 경계를 잡으면(예전 구현) 드물게 아주 멀리 튄 가짜 번호 하나에도
// 흔들린다(실측: 2025 국가직 7급 상황판단 — 표 안 날짜 "12. 31." 같은 가짜
// 번호가 x=662~668에 단 몇 개 있었는데, 그게 최대 간격을 만들어 버렸다).
// 대신 x를 반올림해 근접한 값끼리 묶고(자릿수/조각분리로 인한 지터가 실측
// 최대 ~25pt라 그보다 넉넉한 값으로 묶는다), 묶음별 등장 횟수가 가장 많은
// 두 묶음을 찾는다 — 그 둘이 서로 80pt 이상 떨어져 있으면 진짜 좌/우 칼럼
// 여백으로 본다.
const COLUMN_CLUSTER_TOLERANCE_PT = 25;
export function computeColumnSplitX(pageMarkerDataList) {
  const xs = pageMarkerDataList
    .flatMap((d) => d.markers.map((m) => m.x))
    .sort((a, b) => a - b);
  if (xs.length < 4) return null;

  const clusters = [];
  let current = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - current[current.length - 1] <= COLUMN_CLUSTER_TOLERANCE_PT) {
      current.push(xs[i]);
    } else {
      clusters.push(current);
      current = [xs[i]];
    }
  }
  clusters.push(current);
  if (clusters.length < 2) return null;

  const summarized = clusters
    .map((c) => ({
      min: c[0],
      max: c[c.length - 1],
      count: c.length,
      x: c.reduce((a, b) => a + b, 0) / c.length,
    }))
    .sort((a, b) => b.count - a.count);

  const first = summarized[0];
  const second = summarized.find((c) => Math.abs(c.x - first.x) >= COLUMN_SPLIT_MIN_GAP_PT);
  if (!second) return null;

  const [left, right] = first.x < second.x ? [first, second] : [second, first];
  // 경계를 두 마커 클러스터의 정중앙이 아니라 우측 마커 바로 앞(여유 buffer만큼)에
  // 잡는다. 마커는 항상 각 칼럼의 왼쪽 끝에 붙지만, 안내문("※ 다음 글을...")
  // 같은 본문 텍스트는 그보다 훨씬 오른쪽까지(때로는 실제 칼럼 폭 절반 가까이)
  // 뻗어 나온다 — 정중앙을 경계로 쓰면 이런 안내문 조각이 실제로는 좌측 칼럼에
  // 속하는데도 우측으로 잘못 분류돼, 좌측에 있던 안내문의 나머지 조각과 다른
  // 줄로 갈라지면서 안내문 인식 자체가 깨진다(실측: 2025 국회직 8급 언어논리 —
  // "[문 19. ∼ 문 20.]" 부분이 x=197로 정중앙(약 187)보다 오른쪽에 있어 우측
  // 취급되며 19번 마커가 안내문과 뒤섞여 사라졌다). 우측 마커 바로 앞으로 당겨
  // 두면 마커 분류(splitIntoColumns)는 여전히 정확하면서(실측 우측 여백보다
  // 왼쪽은 전부 좌측으로 잡히므로) 좌측 칼럼 본문에 훨씬 넉넉한 여유를 준다.
  const COLUMN_SPLIT_RIGHT_BUFFER_PT = 30;
  return Math.max(left.max + 1, right.min - COLUMN_SPLIT_RIGHT_BUFFER_PT);
}

// 픽셀을 잘라낼 좌/우 경계. computeColumnSplitX(분류용)를 그대로 쓰면 안 된다 —
// 저쪽은 안내문 오분류를 막으려고 우측 마커보다 30pt 왼쪽으로 일부러 당겨둔 값이라,
// 그 자리에서 이미지를 자르면 좌측 칼럼 본문의 오른쪽 끝이 잘려 나가고(실측: 2026
// 국회직 8급 행정법총론 1·3·6·7번) 우측 칼럼 크롭은 칼럼 사이 구분선과 좌측 문제의
// 꼬리까지 물고 들어온다(같은 문제지 2·4·5번). 분류 경계와 크롭 경계는 목적이 달라
// 같은 값을 쓰면 안 되는데 지금까지 한 값을 공유하고 있었다.
//
// 크롭 경계는 **우측 칼럼 본문이 시작되는 자리 바로 앞**이어야 한다. 마커는 칼럼
// 왼쪽 끝에 붙으므로 우측 클러스터의 최소 x가 곧 우측 칼럼의 왼쪽 끝이다. 거기서
// 조금만 물러나 잡으면 좌측 칼럼은 넉넉히 살고 우측 칼럼엔 남의 것이 안 들어온다.
const COLUMN_CROP_BACKOFF_PT = 8;
export function computeColumnCropX(pageMarkerDataList) {
  const xs = pageMarkerDataList
    .flatMap((d) => d.markers.map((m) => m.x))
    .sort((a, b) => a - b);
  if (xs.length < 4) return null;

  const clusters = [];
  let current = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - current[current.length - 1] <= COLUMN_CLUSTER_TOLERANCE_PT) current.push(xs[i]);
    else {
      clusters.push(current);
      current = [xs[i]];
    }
  }
  clusters.push(current);
  if (clusters.length < 2) return null;

  const summarized = clusters
    .map((c) => ({ min: c[0], count: c.length, x: c.reduce((a, b) => a + b, 0) / c.length }))
    .sort((a, b) => b.count - a.count);
  const first = summarized[0];
  const second = summarized.find((c) => Math.abs(c.x - first.x) >= COLUMN_SPLIT_MIN_GAP_PT);
  if (!second) return null;
  const right = first.x < second.x ? second : first;
  return right.min - COLUMN_CROP_BACKOFF_PT;
}

// 문서 전체 마커에서 칼럼별 최빈 x를 구한다. "문" 신호가 하나라도 있으면
// 기존의 신뢰 마커 기반 필터가 더 정확하므로 계산하지 않는다(null 반환).
export function computeDocMarginX(pageMarkerDataList, columnSplitX) {
  const all = pageMarkerDataList.flatMap((d) =>
    d.markers.map((m) => ({ ...m, col: m.x < (columnSplitX ?? d.pageWidthPt / 2) ? "L" : "R" })),
  );
  if (all.length === 0 || all.some((m) => m.hasMun)) return null;
  const result = {};
  for (const col of ["L", "R"]) {
    const xs = all.filter((m) => m.col === col).map((m) => Math.round(m.x));
    if (xs.length === 0) continue;
    const counts = new Map();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const [modeX, modeCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
    // 최빈 x가 그 칼럼에서 가장 왼쪽이 아니면 여백이 아니라 지문 속 번호 목록일
    // 수 있다 — 실측(국가직 5·7급 상황판단, 지방직 7급 국어)에서 지문 번호가
    // 진짜 마커보다 많아 최빈값을 차지했고, 그걸 여백으로 믿으면 진짜 마커가
    // 통째로 지워졌다. 이런 문제지에서는 아예 기준을 세우지 않고(=null) 예전
    // 동작(클러스터링)에 맡긴다.
    const minX = Math.min(...xs);
    if (modeCount / xs.length >= DOC_MARGIN_MIN_SHARE && modeX - minX <= DOC_MARGIN_TOLERANCE_PT) {
      result[col] = modeX;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// 여백 x만으로는 진짜 마커와 지문 속 인용 번호를 못 가르는 경우가 있다 — 실측상
// 진짜 마커가 여백에서 6pt 안쪽으로 들어간 문제지(2024 경찰간부 범죄학 37번,
// 2025 재정학 4번)와, 지문 속 가짜 번호가 여백에서 7pt 들어간 문제지(2017
// 경찰간부 한국사)가 둘 다 있어 어떤 임계값도 한쪽을 반드시 틀린다.
// 다행히 가짜는 예외 없이 "이미 다른 자리에 있는 번호의 중복"으로 나타나므로,
// 같은 번호가 문서 안에서 여러 번 잡히면 여백에 가장 가까운 것 하나만 남긴다.
// (남기지 않으면 extractQuestionsFromPdf의 중복 감지가 하드 에러로 멈춘다.)
// 엄격형 마커(마침표 뒤 공백)로 찾은 번호들 사이에 빠진 번호가 있으면, 그 번호에
// 한해 완화형 후보(마침표 뒤 본문이 곧장 붙는 형태)를 여백 x가 맞는 것만 골라
// 채워 넣는다. 완화형을 처음부터 일반 마커로 쓰면 지문 속 번호 목록까지 걸려
// 멀쩡하던 문제지가 깨지므로(실측: 국가직 5·7급 상황판단), 이렇게 "구멍 메우기"
// 로만 제한한다.
export function fillMissingNumbersFromRelaxed(pageMarkerDataList, docMarginX, columnSplitX) {
  if (docMarginX == null) return;
  const strictNumbers = new Set();
  for (const data of pageMarkerDataList) for (const m of data.markers) strictNumbers.add(m.number);
  if (strictNumbers.size === 0) return;
  const maxNumber = Math.max(...strictNumbers);

  // 같은 번호의 완화형 후보가 여러 개면 여백에 가장 가까운 하나만 쓴다.
  const candidates = new Map();
  for (const data of pageMarkerDataList) {
    const half = columnSplitX ?? data.pageWidthPt / 2;
    for (const m of data.relaxedMarkers ?? []) {
      if (strictNumbers.has(m.number)) continue;
      const margin = m.x < half ? docMarginX.L : docMarginX.R;
      if (margin == null) continue;
      const dev = Math.abs(m.x - margin);
      if (dev > DOC_MARGIN_TOLERANCE_PT) continue;
      const prev = candidates.get(m.number);
      if (!prev || dev < prev.dev) candidates.set(m.number, { marker: m, dev, data });
    }
  }
  // 사이에 빠진 번호는 그대로 채우고, 마지막 번호 뒤쪽은 끊기지 않고 이어지는
  // 만큼만 채운다 — 마지막 문제가 완화형인 경우가 있어서다(실측: 2016 경찰간부
  // 경찰학개론 `40.「경찰 감찰 규칙」…`). 번호가 한 칸이라도 비면 거기서 멈춰
  // 지문 속 번호가 딸려 들어오지 않게 한다.
  for (const [number, { marker, data }] of candidates) {
    if (number < maxNumber) data.markers.push(marker);
  }
  for (let n = maxNumber + 1; candidates.has(n); n++) {
    const { marker, data } = candidates.get(n);
    data.markers.push(marker);
  }
}

export function pruneDuplicateMarkers(pageMarkerDataList, docMarginX, columnSplitX) {
  if (docMarginX == null) return;
  const byNumber = new Map();
  for (const data of pageMarkerDataList) {
    const half = columnSplitX ?? data.pageWidthPt / 2;
    for (const m of data.markers) {
      const margin = m.x < half ? docMarginX.L : docMarginX.R;
      const dev = margin == null ? Infinity : Math.abs(m.x - margin);
      if (!byNumber.has(m.number)) byNumber.set(m.number, []);
      byNumber.get(m.number).push({ marker: m, dev, data });
    }
  }
  for (const rawEntries of byNumber.values()) {
    if (rawEntries.length < 2) continue;
    // 여백 x를 확정하지 못한 칼럼(마커 x가 흔들려 최빈값 비율이 낮은 경우)의
    // 마커는 어느 쪽이 진짜인지 판단할 근거가 없으므로 손대지 않는다 — 여기서
    // 무리하게 지우면 진짜 마커가 사라진다(실측: 2026 지방직 9급 국어 2번).
    const entries = rawEntries.filter((e) => Number.isFinite(e.dev));
    if (entries.length !== rawEntries.length || entries.length < 2) continue;
    const best = entries.reduce((a, b) => (b.dev < a.dev ? b : a));
    for (const e of entries) {
      if (e === best) continue;
      e.data.markers = e.data.markers.filter((m) => m !== e.marker);
    }
  }
}

// pruneDuplicateMarkers는 "여백 x"를 기준으로 진짜/가짜를 가르는데, 그 기준을
// 세우지 못하는 문제지가 있다 — computeDocMarginX는 최빈 x가 그 칼럼 마커의
// 절반(DOC_MARGIN_MIN_SHARE) 이상일 때만 기준을 세우는데, 한 자리 수와 두 자리
// 수 마커의 x가 갈리면(실측: 2025 군무원 9급 네트워크 보안 왼쪽 칼럼 — "1."이
// x=49.2, "10."이 x=46.5로 나뉘어 최빈 비율 41%) 어느 쪽도 과반이 안 돼 기준이
// 없다. 그 상태에서 지문 속 번호 목록(같은 문제지 4쪽 "1. A는 통신을 시작하기
// 전에…" 등 x=71.4)이 걸리면 진짜 1~4번과 번호가 겹쳐 "N번이 두 번 잘렸습니다"
// 하드 에러로 문제지 전체가 버려진다.
//
// 여백 x에 기대지 않고 **열람 순서**만으로 가른다. 가짜 마커는 정의상 문서
// 어딘가의 진짜 마커와 번호가 겹쳐야만 드러나므로(그래야 "두 번" 잘린다), 딱 한
// 번만 나오는 번호는 절대 건드리지 않고 2회 이상 나온 번호만 다룬다. 중복 번호는
// "유일 번호들의 골격"(열람 순서상 항상 증가해야 하는, 한 번만 나온 번호들의
// 나열)에서 자기 자리 — 바로 아래 골격 번호와 바로 위 골격 번호 사이 — 에 놓인
// 등장만 진짜로 인정한다. 그 구간에 걸리는 등장이 하나도 없거나 둘 이상이면
// (모호함) 전부 버려서 개수 불일치 경고로 남긴다 — 틀린 이미지를 올리느니
// 수동 확인 대상이 되는 편이 낫다.
export function dropOutOfSequenceMarkers(pageMarkerDataList, columnMode, columnSplitX) {
  const ordered = [];
  for (const data of pageMarkerDataList) {
    const { left, right } = splitIntoColumns(
      data.markers,
      data.pageWidthPt,
      columnMode,
      columnSplitX,
    );
    ordered.push(...(columnMode === "single" ? left : [...left, ...right]));
  }
  const indexed = ordered.map((m, index) => ({ m, index }));

  const counts = new Map();
  for (const { m } of indexed) counts.set(m.number, (counts.get(m.number) ?? 0) + 1);
  if ([...counts.values()].every((c) => c === 1)) return;

  const skeleton = indexed.filter(({ m }) => counts.get(m.number) === 1);

  const keep = new Set();
  for (const { m } of indexed) {
    if (counts.get(m.number) === 1) keep.add(m);
  }
  for (const [number, count] of counts) {
    if (count === 1) continue;
    let before = -Infinity;
    let after = Infinity;
    for (const { m, index } of skeleton) {
      if (m.number < number && index > before) before = index;
      if (m.number > number && index < after) after = index;
    }
    const candidates = indexed.filter(
      ({ m, index }) => m.number === number && index > before && index < after,
    );
    if (candidates.length === 1) keep.add(candidates[0].m);
  }

  for (const data of pageMarkerDataList) {
    data.markers = data.markers.filter((m) => keep.has(m));
  }
}

function filterMarginMarkers(columnMarkers) {
  if (columnMarkers.length === 0) return columnMarkers;

  const trusted = columnMarkers.filter((m) => m.hasMun);
  if (trusted.length === 0) {
    const sorted = [...columnMarkers].sort((a, b) => a.x - b.x);
    let clusterEndIndex = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x - sorted[i - 1].x > MARGIN_CLUSTER_GAP_PT) break;
      clusterEndIndex = i;
    }
    const marginX = new Set(sorted.slice(0, clusterEndIndex + 1).map((m) => m.x));
    return columnMarkers.filter((m) => marginX.has(m.x));
  }

  const trustedXs = trusted.map((m) => m.x);
  const minX = Math.min(...trustedXs) - TRUSTED_MARGIN_TOLERANCE_PT;
  const maxX = Math.max(...trustedXs) + TRUSTED_MARGIN_TOLERANCE_PT;
  return columnMarkers.filter((m) => m.hasMun || (m.x >= minX && m.x <= maxX));
}

// 페이지 안의 마커들을 x좌표 기준으로 좌/우 두 단으로 나누고, 각 단 안에서
// 위→아래 순서(= y 내림차순, PDF 좌표는 위로 갈수록 y가 큼)로 정렬한다.
// columnMode==="single"인 문제지(전체 폭 1단 편집 — 실측: 2015 경력경쟁 9급
// 다수 과목)는 나누지 않고 전부 왼쪽 단 하나로 취급한다. 마커/안내문이 전부
// 왼쪽 여백(x<half)에서만 나오는 편집이라, 오른쪽으로 안 나누는 것 자체가
// 이미 올바른 동작이다 — findAnnotationLines의 col 분류(x<half → "L")와도
// 자연히 맞아떨어진다.
// columnSplitX는 computeColumnSplitX가 실측한 진짜 칼럼 경계다(있으면). 페이지
// 폭 절반이 경계와 어긋나는 조판(국회직 등)에서도 정확히 좌/우를 가르기 위해
// pageWidthPt/2 대신 이 값을 우선한다.
export function splitIntoColumns(markers, pageWidthPt, columnMode, columnSplitX) {
  const half = columnSplitX ?? pageWidthPt / 2;
  if (columnMode === "single") {
    const left = filterMarginMarkers(markers).sort((a, b) => b.y - a.y);
    return { left, right: [], half };
  }
  const left = filterMarginMarkers(markers.filter((m) => m.x < half)).sort((a, b) => b.y - a.y);
  const right = filterMarginMarkers(markers.filter((m) => m.x >= half)).sort((a, b) => b.y - a.y);
  return { left, right, half };
}

// 안내문이 걸린 문제 범위(N~M)라고 해서 다 지문을 공유하는 건 아니다. 실측해
// 보니 두 가지 서로 다른 관례가 섞여 있다:
//   - "다음 글을 읽고 물음에 답하시오. [7~8]" 같은 진짜 공통지문형은 안내문과
//     첫 문제(N) 마커 사이에 지문 전체가 끼어 있어 그 간격이 아주 크다(실측
//     460~590pt). N~M 사이 각 문제 자체는 지문 없이 짧다.
//   - "밑줄 친 부분에 들어갈 말로 가장 적절한 것을 고르시오. [1~5]" 같은
//     지시문 재사용형은 안내문 바로 다음 줄에 곧장 N번 마커가 오고(실측
//     12~21pt), N~M 각 문제가 저마다 자기 지문/보기를 따로 갖는다.
// 이 둘을 안내문 문구만으로는 구분할 수 없어(둘 다 "다음 글을..."로 시작할 수
// 있음), "안내문→첫 마커 간격"과 "문제 사이 평균 간격"을 실제로 재서 비교한다.
//   - 공통지문형 → 안내문+지문+문제들을 한 덩어리로 병합하고 그룹 전원이 같은
//     이미지를 공유한다(문제별 보기에서 세트로 묶여 답 선택 줄이 여러 개 나온다).
//   - 지시문 재사용형 → 각 문제를 따로 자르되, 안내문 줄을 얇게 떼어(스트립)
//     그룹 전원의 크롭 위에 이어붙인다. 안 붙이면 "밑줄 친 부분에 들어갈 말로..."
//     같은 발문이 모든 문제에서 잘려나가 무엇을 묻는지 알 수 없게 된다.
const GROUP_GAP_RATIO = 2.5;
const GROUP_MIN_GAP_PT = 150;
// 안내문과 첫 문제 사이가 이만큼 벌어져 있으면 그 사이에 있는 건 지문일 수밖에
// 없으므로(지시문 재사용형은 실측 12~21pt) 문제 사이 간격과의 비율을 더 따지지
// 않고 공통지문형으로 인정한다. 비율만으로 판정하면 세트의 뒷 문항이 길어
// 문제 사이 간격이 큰 경우에 공통지문형을 놓친다(실측: 2026 군무원 9급 국어
// [23~24] — 지문 427.7pt인데 23→24 간격이 207.8pt라 2.5배에 못 미쳐 탈락했다).
const GROUP_STRONG_GAP_PT = 300;

// 세트를 칼럼 넘어 이어붙일 때 두 조각 사이에 둘 흰 여백(pt).
const SEGMENT_GAP_PT = 14;
// 안내문 스트립의 아래 경계는 안내문 baseline(y)보다 살짝 아래로 내려잡아야
// 한글 받침/디센더가 잘리지 않는다.
const STRIP_DESCENT_PAD = 4;

// 아래쪽 크롭 경계를 다음 잉크 위로 띄울 최소 여유. 윗줄이 없어 여백 한가운데를
// 계산할 수 없을 때만 쓰는 폴백이라 작게 잡는다 — 남는 여백은 어차피
// finalizeQuestionImage가 걷어낸다.
const BOUNDARY_PAD = 3;

// 페이지마다 같은 자리에 되풀이되는 꼬리말(쪽번호 등)을 찾을 때 쓰는 값들.
const FOOTER_ZONE_RATIO = 0.25;
const FOOTER_Y_TOLERANCE_PT = 3;
// 꼬리말은 본문과 "줄간격의 몇 배" 이상 떨어져 있어야 한다. 위치와 페이지 간
// 반복만으로 판정하면 지면을 아래까지 꽉 채우는 조판에서 마지막 문항의 선택지를
// 꼬리말로 오인한다(실측: 2017 국가직 9급 국어 — 841pt 지면에서 5번 문항이
// y=101에서 시작해 선택지가 y=32까지 내려가는데, 매 페이지가 같은 구조라
// "아래쪽 + 반복" 조건을 그대로 통과해 5번이 통째로 사라졌다). 실측상 문항 안의
// 큰 여백(발문↔상자↔선택지)은 줄간격의 1.3~1.7배, 꼬리말 앞 여백은 2.5배 이상.
const FOOTER_GAP_RATIO = 2.1;
// 꼬리말은 한두 줄이다. 이보다 두꺼운 덩어리는 문항 본문으로 보고 손대지 않는다.
const FOOTER_MAX_LINES = 2;

// trim()으로 가장자리 흰 여백을 걷어낸 뒤 보기 좋게 약간만 다시 패딩한다.
// (내용이 거의 없어 trim이 실패하면 원본을 그대로 쓴다.) 최종 저장은 WebP
// 무손실로 — 문제 이미지는 사진이 아니라 흰 배경+얇은 텍스트/선 위주라 PNG보다
// 60%대로 작아지면서 화질 손실은 없다(실측 결과).
// 세로(위/아래) 여백만 걷어내고 원본 칼럼 폭은 그대로 둔다. 좌우까지 trim하면
// 선택지가 짧은 문항("① 라이신 …")이 좁게 잘려, 프런트가 이미지를 컨테이너
// 폭(w-full)에 맞춰 늘릴 때 넓은 문항보다 크게 확대돼 글씨 크기가 문항마다
// 들쭉날쭉해진다(실측: 2026 지방직 9급 공업화학 8번이 폭 516px로 같은 문제지
// 다른 문항 ~1050px의 절반 → 표시 글씨 약 2배). 한 문제지 안에서 폭을 칼럼
// 폭으로 통일해 표시 배율을 맞춘다.
// 잉크가 하나도 없으면(빈 영역) null.
//
// 세로 여백은 걷어내고, 가로는 **폭을 유지한 채 내용만 한가운데로 옮긴다.** 칼럼
// 크롭 영역은 지면 바깥 여백까지 포함하는데 그 여백이 좌우 비대칭이라(실측: 2026
// 군무원 9급 국어는 왼쪽 칼럼이 x=6..360인데 본문은 57에서 시작 → 왼쪽에 51pt가
// 남고 오른쪽엔 10pt만 남는다. 오른쪽 칼럼은 정확히 그 반대) 왼쪽 칼럼 문항은
// 오른쪽으로, 오른쪽 칼럼 문항은 왼쪽으로 치우쳐 보였다(실측 좌우 여백 차 150px
// 안팎). 폭 자체를 줄이면 안 된다 — 프런트가 w-full로 늘려 표시하므로 문항마다
// 폭이 다르면 글씨 크기가 들쭉날쭉해진다(2026 지방직 9급 공업화학 8번 사례,
// commit 167df71). 그래서 폭은 그대로 두고 내용 블록만 가운데로 재배치한다.
async function trimVerticalWhitespace(rawPng) {
  const { data, info } = await sharp(rawPng)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let top = -1;
  let bottom = -1;
  let inkLeft = width;
  let inkRight = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    let hasInk = false;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x] < 245) {
        hasInk = true;
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
      }
    }
    if (hasInk) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (top === -1) return null;

  const contentWidth = inkRight - inkLeft + 1;
  const padLeft = Math.floor((width - contentWidth) / 2);
  const region = sharp(rawPng).extract({
    left: inkLeft,
    top,
    width: contentWidth,
    height: bottom - top + 1,
  });
  if (padLeft <= 0 && width === contentWidth) return region.png().toBuffer();
  return region
    .extend({
      left: padLeft,
      right: width - contentWidth - padLeft,
      background: "#ffffff",
    })
    .png()
    .toBuffer();
}

async function finalizeQuestionImage(rawPng, scale) {
  const pad = Math.round(8 * scale);
  try {
    const trimmed = await trimVerticalWhitespace(rawPng);
    if (!trimmed) {
      // 내용이 거의 없어 잉크 행을 못 찾으면 원본을 그대로 쓴다.
      return await sharp(rawPng).webp({ lossless: true }).toBuffer();
    }
    return await sharp(trimmed)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
      .webp({ lossless: true })
      .toBuffer();
  } catch {
    return sharp(rawPng).webp({ lossless: true }).toBuffer();
  }
}

// 안내문 스트립과 문제 본문 크롭을 위아래로 이어붙인다. 둘 다 같은 배율의 칼럼
// 폭 크롭이라 너비가 사실상 같지만, 반올림 오차나 좌우 칼럼 폭 차이에 대비해
// 넓은 쪽에 맞추고 빈 자리는 흰색으로 채운다.
async function stackVertically(buffers, gapPx = 0) {
  const parts = buffers.filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const metas = await Promise.all(parts.map((b) => sharp(b).metadata()));
  const width = Math.max(...metas.map((m) => m.width));
  const height =
    metas.reduce((sum, m) => sum + m.height, 0) + gapPx * (parts.length - 1);
  const composite = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    composite.push({ input: parts[i], top: offset, left: 0 });
    offset += metas[i].height + gapPx;
  }
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(composite)
    .png()
    .toBuffer();
}

// carriedStrips: 이전 페이지에서 넘어온, 아직 어떤 문제에도 붙지 못한 안내문
// 스트립(번호 → 이미지 버퍼). 세트가 페이지 경계를 걸치면(예: 안내문+9번은
// 페이지1, 10~11번은 페이지2) findQuestionMarkers가 페이지 단위로만 동작해
// 10, 11번은 이 페이지의 groups에 안내문이 없어 스트립을 못 만든다. 그래서
// 페이지1에서 만든 9~11용 스트립 중 9번만 쓰고 남은 10, 11번 몫을 다음 페이지
// 호출로 이어받는다. 반환하는 pendingStrips는 이번 페이지에서도 못 쓴(3페이지
// 이상 걸치는 등) 스트립을 그다음 페이지로 다시 넘기기 위한 것이다.
//
// markerData는 findQuestionMarkers(page)의 결과를 미리 계산해서 넘겨받는다 —
// columnMode(전체 폭 1단인지 좌우 2단인지)는 문서 전체를 봐야 정확히 판단할 수
// 있어서(마지막 페이지만 보면 마커가 몇 개 안 남아 우연히 한쪽에만 몰릴 수
// 있다) extractQuestionsFromPdf가 모든 페이지를 먼저 훑어 한 번만 정하고, 그
// 김에 얻은 결과를 여기서 재사용해 페이지당 텍스트 추출을 두 번 하지 않는다.
// 한 페이지의 기하(칼럼 정의, 영역 잘라내기, 경계 계산)를 한 군데서 만든다.
// 페이지 단위 크롭과, 페이지를 넘는 세트 조각 모으기가 같은 규칙을 쓰도록
// 공유하기 위한 것이다 — 두 곳에 따로 두면 경계 계산이 어긋난다.
async function makePageContext(page, markerData, scale, opts) {
  const {
    columnMode = "double",
    columnSplitX = null,
    footerInkTopY = null,
    columnCropX = null,
    headerInkBottomY = null,
  } = opts ?? {};
  const { markers, groups, lines = [], pageWidthPt, pageHeightPt } = markerData;
  const { left, right, half } = splitIntoColumns(markers, pageWidthPt, columnMode, columnSplitX);
  // 분류는 half(columnSplitX), 픽셀 자르기는 cropX로 나눠 쓴다 — 자세한 이유는
  // computeColumnCropX 주석. columnCropX가 없으면(1단이거나 클러스터를 못 찾으면)
  // 예전처럼 half를 그대로 쓴다.
  const cropX = columnCropX ?? half;
  const { buffer: pageImage, width: pageWidthPx, height: pageHeightPx } =
    await renderPageToPng(page, scale);

  const columnDefs =
    columnMode === "single"
      ? [{ key: "L", markers: left, xLeftPt: PAGE_MARGIN_X, xRightPt: pageWidthPt - PAGE_MARGIN_X }]
      : [
          { key: "L", markers: left, xLeftPt: PAGE_MARGIN_X, xRightPt: cropX - COLUMN_GAP },
          { key: "R", markers: right, xLeftPt: cropX + COLUMN_GAP, xRightPt: pageWidthPt - PAGE_MARGIN_X },
        ];

  // (top, bottom)은 PDF 좌표(pt, y가 클수록 위)를 받아 이미지 좌표(y가 아래로
  // 갈수록 커짐)로 뒤집어 잘라낸다. 영역이 비면 null.
  async function extractRegion(colDef, topPt, bottomPt) {
    const leftPx = Math.max(0, Math.round(colDef.xLeftPt * scale));
    const rightPx = Math.min(pageWidthPx, Math.round(colDef.xRightPt * scale));
    const topPx = Math.max(0, Math.round((pageHeightPt - topPt) * scale));
    const bottomPx = Math.min(pageHeightPx, Math.round((pageHeightPt - bottomPt) * scale));
    const width = rightPx - leftPx;
    const height = bottomPx - topPx;
    if (width <= 0 || height <= 0) return null;
    return sharp(pageImage).extract({ left: leftPx, top: topPx, width, height }).png().toBuffer();
  }

  // 반환값은 "다음 것의 baseline"이 아니라 **그 잉크가 시작되는 위쪽 y**다.
  // 예전에는 baseline을 그대로 돌려주고 호출부가 `baseline + TOP_PAD`로 잘랐는데,
  // PDF의 y는 baseline이라 글자는 그보다 위로 (거의 글자높이만큼) 더 올라간다.
  // 그래서 본문 글자높이가 TOP_PAD(10pt)보다 큰 조판에서는 자르는 선이 다음
  // 문제 첫 줄 글자를 관통해, 그 윗동강이 점선처럼 남았다(실측: 2026 군무원 9급
  // 국어 — 글자높이 13pt라 25문항 중 13건이 정확히 3.0pt씩 남음).
  function nextInkTop(thing) {
    return thing.y + (thing.height ?? 0);
  }

  // 잉크가 시작되는 지점 바로 위로 자르되, 바로 윗줄의 디센더까지 먹지 않도록
  // 두 줄 사이 여백의 한가운데를 고른다. 여백 안이기만 하면 어디서 자르든
  // finalizeQuestionImage의 세로 여백 제거가 결과를 똑같이 맞춰준다.
  function cutAboveInk(colKey, inkTopY) {
    const above = lines
      .filter((l) => l.col === colKey && l.y > inkTopY)
      .sort((a, b) => a.y - b.y)[0];
    if (!above) return inkTopY + BOUNDARY_PAD;
    // 윗줄 디센더는 baseline 아래로 글자높이의 30% 남짓 내려간다.
    const aboveInkBottom = above.y - above.height * 0.3;
    if (aboveInkBottom <= inkTopY) return inkTopY + BOUNDARY_PAD;
    return (aboveInkBottom + inkTopY) / 2;
  }

  // 칼럼에 다음 것이 없는 마지막 문항. 예전에는 무조건 페이지 바닥까지 잘라
  // 쪽번호 꼬리말이 딸려 들어왔고, 꼬리말도 잉크라서 세로 여백 제거가 무력화돼
  // 본문과 꼬리말 사이 큰 빈칸이 그대로 남았다(실측: 2026 군무원 9급 국어 3번).
  //
  // footerInkTopY는 **이 페이지에서 실제로 관측된** 값이다. 문서 전체에 값 하나를
  // 쓰면 다른 페이지에서 나온 y가 이 페이지에선 본문 한복판일 수 있어 문항이
  // 통째로 사라진다(실측: 2015 국가직 9급 수학 3번 — 마커 y=195.7인데 문서값이
  // 195.87이라 크롭 영역이 뒤집혔다). 그래도 남는 위험이 있으니 마커보다 확실히
  // 아래일 때만 쓴다. 칼럼을 가리지 않고 페이지 전체에 적용한다 — 꼬리말이 칼럼
  // 경계에 걸치면 텍스트 조각은 한쪽 칼럼에만 기록되지만 픽셀은 반대쪽 크롭에도
  // 들어온다(실측: 군무원 국어 15·19번).
  function bottomForLastInColumn(colDef, fromY) {
    if (footerInkTopY === null || footerInkTopY >= fromY) return BOTTOM_MARGIN;
    let end = null;
    for (const l of lines) {
      if (l.col !== colDef.key) continue;
      if (l.y >= fromY || l.y <= footerInkTopY) continue;
      if (end === null || l.y < end.y) end = l;
    }
    if (end === null) return BOTTOM_MARGIN;
    const endInkBottom = end.y - end.height * 0.3;
    if (endInkBottom <= footerInkTopY) return BOTTOM_MARGIN;
    return (endInkBottom + footerInkTopY) / 2;
  }

  // fromY보다 아래(같은 칼럼)에서 크롭을 끊을 y — 다음 마커와 다음 안내문 중 더
  // 위에 있는 쪽. 안내문을 경계로 안 삼으면 위 문제의 크롭이 다음 세트의
  // 안내문·지문까지 집어삼킨다.
  function findBottomBoundary(colDef, fromY) {
    let next = null;
    const nextMarker = colDef.markers.find((m) => m.y < fromY);
    if (nextMarker) next = nextMarker;
    for (const g of groups) {
      if (g.col !== colDef.key) continue;
      if (g.y < fromY && (next === null || g.y > next.y)) next = g;
    }
    if (next) return cutAboveInk(colDef.key, nextInkTop(next));
    return bottomForLastInColumn(colDef, fromY);
  }

  // 칼럼을 맨 위에서부터 담을 때는 지면 맨 위에서 자르고, 머리글은 픽셀로 걷어낸다
  // (dropRunningHeader). 좌표로 "머리글과 본문 사이"를 노리면 안 된다 — 그 틈이
  // 실측 2.2pt밖에 안 되고, 줄 높이(l.height)가 실제 글리프 높이를 과소평가해서
  // 본문 첫 줄 윗동강이 잘렸다(실측: 2026 법원직 9급 국어 문2).
  const columnTopPt = pageHeightPt;
  // 머리글 잉크 아래선에 해당하는 픽셀 행 — 이보다 위에서 시작하는 잉크 덩어리는
  // 머리글로 본다. null이면 머리글이 없는 문서다.
  const headerBandPx =
    headerInkBottomY === null ? null : Math.round((pageHeightPt - headerInkBottomY) * scale);
  // 칼럼을 끝까지 담을 때의 끝 y — 되풀이 꼬리말 위로 올려잡는다.
  const columnBottomPt =
    footerInkTopY !== null ? footerInkTopY + BOUNDARY_PAD : BOTTOM_MARGIN;

  return {
    markers, groups, lines, pageWidthPt, pageHeightPt,
    columnDefs, extractRegion, findBottomBoundary, nextInkTop, cutAboveInk,
    columnTopPt, headerBandPx, columnBottomPt, columnMode,
  };
}

async function cropQuestionsFromPage(
  page,
  markerData,
  scale,
  carriedStrips = new Map(),
  columnMode = "double",
  columnSplitX = null,
  footerInkTopY = null,
  columnCropX = null,
  headerInkBottomY = null,
  excludeNumbers = new Set(),
) {
  const { markers, groups, lines = [], pageWidthPt, pageHeightPt } = markerData;
  if (markers.length === 0) return { results: [], pendingStrips: carriedStrips };

  const ctx = await makePageContext(page, markerData, scale, {
    columnMode, columnSplitX, footerInkTopY, columnCropX, headerInkBottomY,
  });
  const { columnDefs, extractRegion, findBottomBoundary } = ctx;

  const mergedSets = []; // { numbers, segments: [{ colDef, top, bottom }] }
  const mergedNumbers = new Set();
  const stripRegions = []; // { colDef, top, bottom, memberNumbers }
  const topOverrideByNumber = new Map();

  // 안내문과 첫 문제 사이에 지문이 끼어 있는 "공통지문형"인지 판정한다.
  function looksLikeCommonPassage(gapBeforeFirst, gapsBetween) {
    if (gapBeforeFirst < GROUP_MIN_GAP_PT) return false;
    if (gapBeforeFirst >= GROUP_STRONG_GAP_PT) return true;
    if (gapsBetween.length === 0) return false;
    const avg = gapsBetween.reduce((a, b) => a + b, 0) / gapsBetween.length;
    return gapBeforeFirst >= avg * GROUP_GAP_RATIO;
  }

  function gapsAmong(list) {
    const gaps = [];
    for (let k = 0; k < list.length - 1; k++) gaps.push(list[k].y - list[k + 1].y);
    return gaps;
  }

  function segmentFor(colDef, topPt, lastMarker) {
    return {
      colDef,
      top: Math.min(pageHeightPt, topPt),
      bottom: findBottomBoundary(colDef, lastMarker.y),
    };
  }

  for (const g of groups) {
    // 문서 단위로 이미 처리한 세트(페이지를 넘는 것 등)는 여기서 건드리지 않는다.
    if (excludeNumbers.has(g.start)) continue;
    const colDef = columnDefs.find((c) => c.key === g.col);
    const below = colDef.markers.filter((m) => m.y < g.y);
    const members = below.filter((m) => m.number >= g.start && m.number <= g.end);
    const wanted = g.end - g.start + 1;
    const annotationTop = Math.min(pageHeightPt, g.y + g.height + TOP_PAD);

    // (1) 그룹 전원이 안내문과 같은 칼럼에 있는 표준형 — 한 사각형으로 잘라낸다.
    if (members.length === wanted && members.length >= 2) {
      if (looksLikeCommonPassage(g.y - members[0].y, gapsAmong(members))) {
        mergedSets.push({
          numbers: members.map((m) => m.number),
          segments: [segmentFor(colDef, annotationTop, members[members.length - 1])],
        });
        for (const m of members) mergedNumbers.add(m.number);
        continue;
      }
    }

    // (2) 지문과 앞 문항은 왼쪽 칼럼, 나머지가 오른쪽 칼럼 맨 위로 이어지는 세트
    // (실측: 2026 군무원 9급 국어 [16~17]/[20~21] — 지문+16번이 왼쪽, 17번이
    // 오른쪽 맨 위). 예전에는 이런 세트를 "칼럼을 넘으니 병합 불가"로 보고
    // 지시문 재사용형처럼 처리해, 지문 전체를 두 문항에 각각 복제한 이미지를
    // 만들었다(실측 결과물: 16번 2769px / 17번 2631px 둘 다 지문 포함). 두 칼럼
    // 조각을 세로로 이어붙이면 원래 지면의 읽기 순서 그대로 한 장이 된다.
    if (columnMode === "double" && g.col === "L" && members.length >= 1) {
      const rightCol = columnDefs.find((c) => c.key === "R");
      const rightMembers = (rightCol?.markers ?? []).filter(
        (m) => m.number >= g.start && m.number <= g.end,
      );
      const covered = [...members, ...rightMembers].map((m) => m.number).sort((a, b) => a - b);
      const contiguous =
        covered.length === wanted && covered.every((n, i) => n === g.start + i);
      // 오른쪽 조각은 그 칼럼 맨 위부터 이어져야 한다 — 위에 다른 문항이 끼어
      // 있으면 지면 순서가 "왼쪽 → 오른쪽 위"가 아니므로 이어붙이면 안 된다.
      const continuesAtTopOfRight =
        rightMembers.length > 0 && rightCol.markers[0].number === rightMembers[0].number;
      if (
        contiguous &&
        continuesAtTopOfRight &&
        looksLikeCommonPassage(g.y - members[0].y, gapsAmong(members))
      ) {
        const lastRight = rightMembers[rightMembers.length - 1];
        mergedSets.push({
          numbers: covered,
          segments: [
            segmentFor(colDef, annotationTop, members[members.length - 1]),
            segmentFor(
              rightCol,
              rightMembers[0].y + rightMembers[0].height + TOP_PAD,
              lastRight,
            ),
          ],
        });
        for (const n of covered) mergedNumbers.add(n);
        continue;
      }
    }

    // 지시문 재사용형(또는 칼럼을 넘는 세트): 안내문을 스트립으로 뗀다.
    const memberNumbers = [];
    for (let n = g.start; n <= g.end; n++) memberNumbers.push(n);
    const firstBelow = below[0];
    let stripBottom;
    if (!firstBelow) {
      // 안내문 아래에 이 칼럼 마커가 하나도 없으면(세트가 다음 칼럼으로 넘어감)
      // 칼럼 끝까지가 스트립이다 — 사이에 지문이 있으면 지문째 담긴다.
      stripBottom = BOTTOM_MARGIN;
    } else if (firstBelow.number === g.start && g.y - firstBelow.y < GROUP_MIN_GAP_PT) {
      // 안내문 바로 아래에 첫 문제가 붙어 있는 표준형: 스트립은 안내문 줄만.
      // 바로 아래 문제의 크롭 시작점(topOverride)도 같은 경계로 맞춰야, 첫
      // 문제에 스트립을 이어붙였을 때 원본 지면과 똑같아진다(경계가 어긋나면
      // 안내문 아랫부분이 잘리거나 얇게 두 번 보인다).
      stripBottom = g.y - STRIP_DESCENT_PAD;
      topOverrideByNumber.set(firstBelow.number, stripBottom);
    } else {
      // 안내문과 첫 문제 사이가 먼데(지문이 낀 것) 병합 조건을 못 채운 경우
      // (그룹 일부만 이 칼럼에 있는 등): 지문까지 스트립에 담아 전원 앞에 붙인다.
      stripBottom = firstBelow.y + firstBelow.height + TOP_PAD;
    }
    stripRegions.push({
      colDef,
      top: Math.min(pageHeightPt, g.y + TOP_PAD),
      bottom: stripBottom,
      memberNumbers,
    });
  }

  const stripByNumber = new Map(carriedStrips);
  for (const s of stripRegions) {
    const buffer = await extractRegion(s.colDef, s.top, s.bottom);
    if (!buffer) continue;
    for (const n of s.memberNumbers) stripByNumber.set(n, buffer);
  }
  const consumedNumbers = new Set();

  const results = [];

  for (const set of mergedSets) {
    // 조각이 둘 이상이면(칼럼을 넘는 세트) 각 조각의 세로 여백을 먼저 걷어낸 뒤
    // 이어붙인다 — 안 걷어내면 왼쪽 칼럼 아래쪽 빈 공간이 두 조각 사이에 커다란
    // 흰 띠로 남는다.
    const pieces = [];
    for (const seg of set.segments) {
      const raw = await extractRegion(seg.colDef, seg.top, seg.bottom);
      if (!raw) continue;
      pieces.push(set.segments.length > 1 ? await trimVerticalWhitespace(raw) : raw);
    }
    const raw = await stackVertically(pieces, Math.round(SEGMENT_GAP_PT * scale));
    if (!raw) continue;
    const image = await finalizeQuestionImage(raw, scale);
    // 그룹 전원이 같은 이미지를 공유한다 — 업로드 단계는 groupNumbers를 보고 첫
    // 번호 경로 하나에만 저장하고 나머지 번호는 그 경로를 가리키게 하며, 프런트는
    // image_path가 같은 연속 번호를 세트로 묶어 답 선택 줄을 여러 개 그린다.
    for (const number of set.numbers) {
      results.push({ number, image, groupNumbers: set.numbers });
    }
  }

  for (const colDef of columnDefs) {
    for (const marker of colDef.markers) {
      if (mergedNumbers.has(marker.number) || excludeNumbers.has(marker.number)) continue;
      const top =
        topOverrideByNumber.get(marker.number) ??
        Math.min(pageHeightPt, marker.y + marker.height + TOP_PAD);
      const bottom = findBottomBoundary(colDef, marker.y);

      let raw = await extractRegion(colDef, top, bottom);
      if (!raw) {
        console.warn(`문제 ${marker.number}: 잘라낼 영역이 비어있어 건너뜀`);
        continue;
      }
      const strip = stripByNumber.get(marker.number);
      if (strip) {
        raw = await stackVertically([strip, raw]);
        consumedNumbers.add(marker.number);
      }
      results.push({ number: marker.number, image: await finalizeQuestionImage(raw, scale) });
    }
  }

  const pendingStrips = new Map();
  for (const [number, buffer] of stripByNumber) {
    if (!consumedNumbers.has(number)) pendingStrips.set(number, buffer);
  }

  return { results, pendingStrips };
}

// 한 문서에 대해 마커 인식 → 정리 → 크롭까지 한 번의 "전략"으로 끝까지 돌린다.
// useColumnSplitOverride가 false면 예전(이번 세션 이전) 그대로 페이지 폭 절반만
// 칼럼 경계로 쓴다 — 이미 통하던 문서에 대한 100% 동일 동작을 보장하기 위한
// 값이다. true면 실측 마커 클러스터 기반 경계(computeColumnSplitX)를 우선한다 —
// 페이지 폭 정확히 절반이 경계와 어긋나는 조판(국회직 등)에서 우측 칼럼 마커가
// 통째로 사라지는 걸 막는다. 아래 extractQuestionsFromPdf가 두 전략을 순서대로
// 시도해 더 나은 쪽을 고른다.
// 페이지마다 같은 높이에 되풀이되는 꼬리말(쪽번호 "국어(9급) 6 - 1" 등)의 잉크
// 윗선을 구한다. 칼럼의 마지막 문항은 아래에 다음 마커가 없어 페이지 바닥까지
// 잘리는데, 그때 이 값을 경계로 삼아 꼬리말을 빼낸다.
//
// 네 가지 조건을 모두 만족해야 꼬리말로 본다 — 잘못 잡으면 마지막 문항의 아래쪽이
// 통째로 잘려나가므로, 애매하면 아예 포기(null)하고 예전대로 페이지 바닥까지 둔다:
//   (1) 칼럼의 맨 아래 덩어리일 것
//   (2) 바로 위 본문과 줄간격의 FOOTER_GAP_RATIO배 넘게 떨어져 있을 것
//   (3) 한두 줄로 얇을 것
//   (4) 여러 페이지에서 같은 y에 되풀이될 것
// 페이지가 하나뿐이면 (4)를 확인할 수 없으니 포기한다.
function medianLineLead(lines) {
  const gaps = [];
  for (const col of new Set(lines.map((l) => l.col))) {
    const arr = lines.filter((l) => l.col === col).sort((a, b) => b.y - a.y);
    for (let i = 0; i + 1 < arr.length; i++) {
      const g = arr[i].y - arr[i + 1].y;
      if (g > 0.5) gaps.push(g);
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// 페이지별 꼬리말 잉크 윗선을 구한다(없으면 null). 반환값은 페이지 인덱스 배열.
//
// 문서 전체에 하나의 값을 쓰면 안 된다 — 다른 페이지에서 나온 y가 이 페이지에선
// 본문 한복판일 수 있어 문항이 통째로 사라진다(실측: 2015 국가직 9급 수학 3번,
// 마커 y=195.7 vs 문서값 195.87). 그래서 "되풀이 여부"만 문서 전체로 판정하고,
// 실제 자르는 y는 **그 페이지에 실제로 있는 꼬리말 줄**에서 가져온다.
//
// 또 꼬리말은 칼럼 경계에 걸쳐 있을 수 있다(실측: 2026 군무원 9급 국어의
// "국어(9급) 6 - 3"은 x=323.6에서 시작해 칼럼 경계 364를 넘어 오른쪽 칼럼
// 크롭 영역까지 뻗는다). 텍스트 조각은 시작 x로 왼쪽 칼럼에 기록되지만 픽셀은
// 오른쪽 칼럼 크롭에도 들어오므로, 페이지 값은 **칼럼과 무관하게 그 페이지 전체**
// 에 적용해야 한다(실측: 이걸 칼럼별로만 적용했더니 15·19번에 쪽번호가 남았다).
function computeFooterInkTopByPage(pageDataList) {
  const empty = pageDataList.map(() => null);
  if (pageDataList.length < 2) return empty;
  const buckets = new Map();
  for (let i = 0; i < pageDataList.length; i++) {
    const data = pageDataList[i];
    const lines = data.lines ?? [];
    const lead = medianLineLead(lines);
    if (!lead) continue;
    const zoneTop = data.pageHeightPt * FOOTER_ZONE_RATIO;
    for (const col of new Set(lines.map((l) => l.col))) {
      const arr = lines.filter((l) => l.col === col).sort((a, b) => b.y - a.y);
      if (arr.length < 2) continue;
      // 맨 아래에서 위로, 줄간격 이내로 붙어 있는 만큼을 한 덩어리로 묶는다.
      let start = arr.length - 1;
      while (start > 0 && arr[start - 1].y - arr[start].y <= lead * 1.5) start--;
      if (start === 0) continue; // 칼럼 전체가 한 덩어리 = 꼬리말이 아니다
      const block = arr.slice(start);
      if (block.length > FOOTER_MAX_LINES) continue;
      if (arr[start - 1].y - arr[start].y <= lead * FOOTER_GAP_RATIO) continue;
      if (block[0].y >= zoneTop) continue;
      for (const l of block) {
        const key = Math.round(l.y / FOOTER_Y_TOLERANCE_PT);
        if (!buckets.has(key)) buckets.set(key, { perPage: new Map() });
        const b = buckets.get(key);
        b.perPage.set(i, Math.max(b.perPage.get(i) ?? -Infinity, l.y + l.height));
      }
    }
  }
  // 문서 절반 이상의 페이지에 같은 자리로 나타나야 되풀이 꼬리말로 인정한다.
  const minPages = Math.max(2, Math.ceil(pageDataList.length / 2));
  const result = empty;
  for (const b of buckets.values()) {
    if (b.perPage.size < minPages) continue;
    for (const [pageIdx, inkTop] of b.perPage) {
      if (result[pageIdx] === null || inkTop > result[pageIdx]) result[pageIdx] = inkTop;
    }
  }
  return result;
}

// 페이지나 칼럼을 넘어가는 공통지문 세트를 문서 단위로 모아 한 장으로 만든다.
//
// 법원직 국어가 이 구조를 기본으로 쓴다(실측: 2026 법원직 9급 국어 [문1~4] —
// 안내문이 1쪽 좌측 맨 위, 지문이 1쪽 좌·우 두 칼럼에 걸쳐 흐르고, 문1은 1쪽
// 우측 하단, 문2~4는 2쪽 좌측). 페이지 단위 병합으로는 담을 수 없어 안내문
// 스트립 방식으로 빠지는데, 그러면 **좌측 칼럼만 잘라 붙여 지문이 중간에서
// 끊기고** 그 잘린 지문이 그룹 전원에게 복제된다. 실측 표본 25장에서 안내문
// 그룹 16개 중 14개가 이 상태였다.
//
// 해결: 지면의 읽기 순서(페이지 → 좌칼럼 → 우칼럼)를 따라 안내문 자리에서
// 마지막 멤버 문항 끝까지를 (페이지, 칼럼) 조각으로 잘라 세로로 이어붙인다.
// 원래 지면을 한 칼럼으로 펴놓은 것과 같아져 지문이 온전하고 중복도 없다.
// 조각이 새 칼럼 맨 위에서 시작할 때는 되풀이 머리글을 넘겨 잡아야 한다
// (안 그러면 "1교시 ①책형"이 지문 사이에 박힌다).
const CROSS_PAGE_SET_MAX_SEGMENTS = 8;

// 조각 맨 위의 되풀이 머리글을 픽셀로 걷어낸다. headerBandPx보다 위에서 시작하는
// 잉크 덩어리를 머리글로 보고, 그 아래 첫 본문 잉크 행부터 남긴다. 자르는 자리를
// "첫 본문 잉크 행" 자체로 잡으므로 본문이 한 픽셀도 깎이지 않는다 — 좌표만으로
// 머리글과 본문 사이를 노리다 본문을 잘라먹은 적이 있어(법원직 문2) 픽셀로 잰다.
async function dropRunningHeader(rawPng, headerBandPx, scale) {
  if (headerBandPx === null) return rawPng;
  const { data, info } = await sharp(rawPng)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const hasInk = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < 245) {
        hasInk[y] = 1;
        break;
      }
    }
  }
  // 머리글로 인정하는 조건 두 가지를 **함께** 본다:
  //   (a) 덩어리가 머리글 띠 안에서 시작하고,
  //   (b) 덩어리가 머리글다운 높이일 것.
  // (a)만 보면 지문 상자를 머리글로 오인한다 — 상자 테두리 때문에 상자 높이 전체가
  // 잉크 한 덩어리로 잡혀서 칼럼 맨 위에서 시작하는 지문이 통째로 날아갔다(실측:
  // 2026 법원직 9급 국어 1쪽 우측 칼럼 2,422행 중 2,060행 소실).
  // 반대로 "띠 안에서 끝날 것"으로 걸면 머리글 아래 괘선까지 한 덩어리인 조판을
  // 놓친다(실측: 2022 국가직 7급 언어논리 "언어논리영역 ㉮책형 7쪽" + 가로줄).
  const slackPx = Math.round(4 * scale);
  const maxHeaderBlockPx = Math.round(40 * scale);
  // 머리글 아래에 가로 괘선을 한 줄 긋는 조판이 있다(실측: 2022 국가직 7급
  // 언어논리). 글자 덩어리와 떨어져 있어 위 조건에 안 걸리므로, 머리글 바로 아래의
  // "아주 얇은 줄" 하나는 따로 걷어낸다. 지문 상자의 윗변은 상자 옆선과 이어져
  // 한 덩어리라 얇게 잡히지 않으므로 안전하다.
  const thinPx = Math.round(4 * scale);
  const ruleBandPx = headerBandPx + Math.round(24 * scale);
  let y = 0;
  for (;;) {
    while (y < height && !hasInk[y]) y++;
    if (y >= height) return null; // 잉크가 없다 = 빈 조각
    let end = y;
    while (end < height && hasInk[end]) end++;
    const blockHeight = end - y;
    const startsInHeaderBand = y <= headerBandPx + slackPx;
    const isRuleUnderHeader = y > headerBandPx + slackPx && y <= ruleBandPx && blockHeight <= thinPx;
    if (startsInHeaderBand && blockHeight > maxHeaderBlockPx) break; // 지문 상자 등
    if (!startsInHeaderBand && !isRuleUnderHeader) break; // 본문
    y = end;
  }
  if (y === 0) return rawPng;
  return sharp(rawPng).extract({ left: 0, top: y, width, height: height - y }).png().toBuffer();
}

export function planCrossPageSets(pageDataList, columnMode) {
  const colKeys = columnMode === "single" ? ["L"] : ["L", "R"];
  // 읽기 순서 슬롯: [{ pageIdx, col }]
  const slots = [];
  for (let p = 0; p < pageDataList.length; p++) {
    for (const col of colKeys) slots.push({ pageIdx: p, col });
  }
  const slotIndex = (pageIdx, col) => slots.findIndex((s) => s.pageIdx === pageIdx && s.col === col);

  // 번호 → { pageIdx, col, marker }
  const markerAt = new Map();
  for (let p = 0; p < pageDataList.length; p++) {
    const d = pageDataList[p];
    const { left, right } = splitIntoColumns(d.markers, d.pageWidthPt, columnMode, d._columnSplitX);
    for (const m of left) if (!markerAt.has(m.number)) markerAt.set(m.number, { pageIdx: p, col: "L", marker: m });
    for (const m of right) if (!markerAt.has(m.number)) markerAt.set(m.number, { pageIdx: p, col: "R", marker: m });
  }

  const plans = [];
  for (let p = 0; p < pageDataList.length; p++) {
    for (const g of pageDataList[p].groups ?? []) {
      const wanted = g.end - g.start + 1;
      if (wanted < 2) continue;
      const members = [];
      for (let n = g.start; n <= g.end; n++) {
        const at = markerAt.get(n);
        if (!at) break;
        members.push(at);
      }
      if (members.length !== wanted) continue; // 못 찾은 번호가 있으면 손대지 않는다

      const startSlot = slotIndex(p, g.col);
      const endSlot = slotIndex(members[wanted - 1].pageIdx, members[wanted - 1].col);
      if (startSlot < 0 || endSlot < startSlot) continue;
      // 한 슬롯 안에서 끝나면 페이지 단위 병합이 이미 처리한다 — 건드리지 않는다.
      if (endSlot === startSlot) continue;
      // 읽기 순서가 뒤섞이면(멤버가 앞 슬롯으로 되돌아가면) 이어붙이면 안 된다.
      let monotonic = true;
      let prev = startSlot;
      for (const m of members) {
        const s = slotIndex(m.pageIdx, m.col);
        if (s < prev) { monotonic = false; break; }
        prev = s;
      }
      if (!monotonic) continue;
      if (endSlot - startSlot + 1 > CROSS_PAGE_SET_MAX_SEGMENTS) continue;

      // 안내문 바로 아래에 첫 문항이 붙어 있으면 공통지문형이 아니라 "지시문
      // 재사용형"이다 — 그건 페이지 단위의 스트립 처리가 맞다.
      const first = members[0];
      if (first.pageIdx === p && first.col === g.col && g.y - first.marker.y < GROUP_MIN_GAP_PT) continue;

      plans.push({
        numbers: members.map((m) => m.marker.number),
        annotation: { pageIdx: p, col: g.col, y: g.y, height: g.height },
        slots: slots.slice(startSlot, endSlot + 1),
        lastMember: members[wanted - 1],
      });
    }
  }
  return plans;
}

// 꼬리말 감지의 대칭 — 페이지마다 되풀이되는 **머리글**의 잉크 아래선을 구한다.
// 세트 조각이 칼럼 맨 위에서 시작할 때 이게 없으면 쪽 머리글이 지문 사이에 끼어
// 들어온다(실측: 2026 법원직 9급 국어 — 1쪽 우측 칼럼 맨 위의 "1교시 ①책형"이
// 지문과 문1 사이에 그대로 박혔다). 판정 기준은 꼬리말과 같다: 지면 위쪽 구역에
// 있고, 아래 본문과 줄간격의 FOOTER_GAP_RATIO배가 넘는 여백으로 떨어져 있고,
// 문서 절반 이상의 페이지에 같은 자리로 나타날 것.
// 꼬리말과 달리 **여백으로는 못 가른다.** 꼬리말은 본문에서 뚝 떨어져 있지만
// 머리글은 첫 본문 줄에 바로 붙어 있는 조판이 있다(실측: 2026 법원직 9급 국어 —
// 머리글 "【국어 25문】"이 y=769, 첫 문항이 y=755.1로 13.9pt 차이. 줄간격의 2.1배
// 조건에 한참 못 미친다).
//
// 되풀이 여부만으로 판정하는 것도 위험하다 — 각 페이지의 **첫 본문 줄도 매 페이지
// 같은 y**에 온다(법원직은 어느 페이지든 첫 줄이 y=755.1). 그래서 y가 아니라
// **글자 내용이 페이지마다 똑같은지**를 본다. 머리글은 문서 내내 같은 문구지만
// (`【국어 25문】`, `1교시 ①책형`) 본문 첫 줄은 페이지마다 다르다. 쪽번호처럼
// 숫자만 바뀌는 경우까지 잡으려고 숫자는 #으로 뭉개고 비교한다.
function normalizeRunningText(text) {
  return text.replace(/\s+/g, "").replace(/\d+/g, "#");
}

function computeHeaderInkBottomByPage(pageDataList) {
  const empty = pageDataList.map(() => null);
  if (pageDataList.length < 2) return empty;
  const buckets = new Map();
  for (let i = 0; i < pageDataList.length; i++) {
    const data = pageDataList[i];
    const lines = data.lines ?? [];
    const zoneBottom = data.pageHeightPt * (1 - FOOTER_ZONE_RATIO);
    for (const l of lines) {
      if (l.y <= zoneBottom) continue; // 지면 위쪽 구역만
      const key = normalizeRunningText(l.text ?? "");
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, new Map());
      const b = buckets.get(key);
      // baseline을 그대로 쓴다. 잉크 아래선(baseline - 높이*0.3)을 기준으로 잡으면
      // 바로 아래 본문 줄의 잉크 시작과 1~2px밖에 안 떨어져, 픽셀 판정이 본문
      // 덩어리를 머리글로 오인해 여러 줄을 날린 적이 있다(법원직에서 문항 5줄 소실).
      // baseline은 머리글 덩어리 안쪽이라 본문과 넉넉히 떨어진다.
      b.set(i, Math.min(b.get(i) ?? Infinity, l.y));
    }
  }
  const minPages = Math.max(2, Math.ceil(pageDataList.length / 2));
  const result = empty;
  for (const perPage of buckets.values()) {
    if (perPage.size < minPages) continue;
    for (const [pageIdx, inkBottom] of perPage) {
      if (result[pageIdx] === null || inkBottom < result[pageIdx]) result[pageIdx] = inkBottom;
    }
  }
  return result;
}

// 한 문제지 안에서 이미지 폭을 전부 같게 맞춘다(좁은 쪽에 흰 여백을 양옆으로
// 덧대며, 내용은 절대 자르지 않는다). 프런트가 이미지를 컨테이너 폭(w-full)에
// 맞춰 늘려 보여주므로, 폭이 다르면 그만큼 확대율이 달라져 문항마다 글씨 크기가
// 달라 보인다. 좌우 칼럼 폭이 실제로 다른 조판이 있어서(실측: 2026 국회직 8급
// 행정법총론 — 좌 342pt / 우 367pt) 크롭 단계만으로는 폭이 안 맞는다.
async function normalizeWidths(cropped) {
  if (cropped.length === 0) return;
  // 세트 병합분은 여러 번호가 같은 버퍼를 공유하므로 버퍼 단위로 한 번만 처리한다.
  const unique = new Map();
  for (const c of cropped) {
    if (!unique.has(c.image)) unique.set(c.image, await sharp(c.image).metadata());
  }
  const target = Math.max(...[...unique.values()].map((m) => m.width));
  const resized = new Map();
  for (const [buf, meta] of unique) {
    if (meta.width === target) continue;
    const extra = target - meta.width;
    const left = Math.floor(extra / 2);
    resized.set(
      buf,
      await sharp(buf)
        .extend({ left, right: extra - left, background: "#ffffff" })
        .webp({ lossless: true })
        .toBuffer(),
    );
  }
  if (resized.size === 0) return;
  for (const c of cropped) {
    const next = resized.get(c.image);
    if (next) c.image = next;
  }
}

// 마커 인식부터 정리(구멍 메우기·중복 제거·순서 정리)까지, **렌더링 없이 텍스트만
// 보고** 끝나는 앞단을 한 덩어리로 묶는다. extractWithStrategy가 이걸 그대로 쓰고,
// scripts/audit-crop-orphans.mjs 같은 검사 도구도 같은 결과를 렌더링 비용 없이
// 재현할 수 있다 — 검사 도구가 이 순서를 따로 베껴 쓰면 크롭 로직이 바뀔 때 조용히
// 어긋나므로 반드시 이 함수를 공유할 것.
export async function buildMarkerPlan(pdf, useColumnSplitOverride) {
  // 1차 패스: 렌더링 없이 텍스트만 뽑아 페이지 폭 절반 기준으로 findQuestionMarkers를
  // 한 번 돌려본다.
  const roughMarkerData = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const data = await findQuestionMarkers(page);
    roughMarkerData.push({ page, data });
  }
  const roughColumnSplitX = useColumnSplitOverride
    ? computeColumnSplitX(roughMarkerData.map((d) => d.data))
    : null;

  // 2차 패스: 1차에서 구한 칼럼 경계로 안내문 줄 분류를 다시 정확히 해서
  // 페이지당 마커를 재추출한다 — 그렇지 않으면 우측 칼럼 마커가 좌측 여백의
  // 안내문과 같은 줄로 오인 병합돼 사라지는 문제가 남는다(실측: 2026 국회직
  // 8급 상황판단 20번 — "[문 19.∼문 20.]" 안내문과 같은 y, 둘 다 페이지폭
  // 절반보다 왼쪽이라 잘못 같은 줄로 묶임). 문서 전체의 마커를 모아 한 번만
  // 정한다 — 페이지 하나만 보면 마커가 몇 개 안 남는 마지막 페이지 같은 데서
  // 우연히 한쪽에만 몰려 오판할 수 있다.
  const pageMarkerData = [];
  for (const { page } of roughMarkerData) {
    const data = await findQuestionMarkers(page, roughColumnSplitX);
    pageMarkerData.push({ page, data });
  }
  const columnSplitX = useColumnSplitOverride
    ? (computeColumnSplitX(pageMarkerData.map((d) => d.data)) ?? roughColumnSplitX)
    : null;
  // 크롭 경계는 분류 경계와 별개로 구한다(computeColumnCropX 주석 참고). 예전
  // 방식(페이지 폭 절반)으로 도는 문제지는 건드리지 않는다 — 이미 잘 나오던
  // 수천 장의 동작을 그대로 유지하기 위해서다.
  const columnCropX = useColumnSplitOverride
    ? computeColumnCropX(pageMarkerData.map((d) => d.data))
    : null;
  const columnMode =
    columnSplitX != null || pageMarkerData.some((d) => d.data.markers.some((m) => m.x >= d.data.pageWidthPt / 2))
      ? "double"
      : "single";
  // "문" 표기가 없는 조판(경찰 간부후보 등)은 문서 전체 기준 여백 x를 구해
  // 빠진 번호 메우기와 중복 번호 정리의 기준으로 쓴다.
  const docMarginX = computeDocMarginX(pageMarkerData.map((d) => d.data), columnSplitX);
  fillMissingNumbersFromRelaxed(
    pageMarkerData.map((d) => d.data),
    docMarginX,
    columnSplitX,
  );
  pruneDuplicateMarkers(
    pageMarkerData.map((d) => d.data),
    docMarginX,
    columnSplitX,
  );
  // 여백 x 기준으로 못 가른 중복이 남아 있으면 열람 순서로 마지막 정리를 한다.
  // 여기까지 와서 중복이 남으면 아래 중복 감지가 하드 에러로 문제지를 통째로
  // 버리므로, 그 전에 확실한 것만 살려낸다.
  dropOutOfSequenceMarkers(
    pageMarkerData.map((d) => d.data),
    columnMode,
    columnSplitX,
  );

  for (const d of pageMarkerData) d.data._columnSplitX = columnSplitX;
  return { pageMarkerData, columnSplitX, columnCropX, columnMode };
}

async function extractWithStrategy(pdf, scale, onPage, useColumnSplitOverride) {
  const { pageMarkerData, columnSplitX, columnCropX, columnMode } = await buildMarkerPlan(
    pdf,
    useColumnSplitOverride,
  );

  const footerInkTopByPage = computeFooterInkTopByPage(pageMarkerData.map((d) => d.data));
  const headerInkBottomByPage = computeHeaderInkBottomByPage(pageMarkerData.map((d) => d.data));

  const cropped = [];

  // 페이지/칼럼을 넘는 공통지문 세트를 먼저 문서 단위로 처리한다(planCrossPageSets
  // 주석 참고). 여기서 처리한 번호는 아래 페이지 단위 크롭에서 제외한다.
  const crossPagePlans = planCrossPageSets(pageMarkerData.map((d) => d.data), columnMode);
  const handledNumbers = new Set();
  const pageCtxCache = new Map();
  async function ctxFor(pageIdx) {
    if (!pageCtxCache.has(pageIdx)) {
      const { page, data } = pageMarkerData[pageIdx];
      pageCtxCache.set(
        pageIdx,
        await makePageContext(page, data, scale, {
          columnMode,
          columnSplitX,
          footerInkTopY: footerInkTopByPage[pageIdx],
          columnCropX,
          headerInkBottomY: headerInkBottomByPage[pageIdx],
        }),
      );
    }
    return pageCtxCache.get(pageIdx);
  }

  for (const plan of crossPagePlans) {
    if (plan.numbers.some((n) => handledNumbers.has(n))) continue;
    const pieces = [];
    let broken = false;
    for (let s = 0; s < plan.slots.length; s++) {
      const slot = plan.slots[s];
      const ctx = await ctxFor(slot.pageIdx);
      const colDef = ctx.columnDefs.find((c) => c.key === slot.col);
      if (!colDef) { broken = true; break; }
      const isFirst = s === 0;
      const isLast = s === plan.slots.length - 1;
      const top = isFirst
        ? Math.min(ctx.pageHeightPt, plan.annotation.y + plan.annotation.height + TOP_PAD)
        : ctx.columnTopPt;
      const bottom = isLast
        ? ctx.findBottomBoundary(colDef, plan.lastMember.marker.y)
        : ctx.columnBottomPt;
      const raw = await ctx.extractRegion(colDef, top, bottom);
      if (!raw) continue; // 빈 칼럼(조판상 비어 있는 칼럼)은 그냥 건너뛴다
      // 첫 조각은 안내문에서 시작하므로 머리글이 애초에 안 들어온다. 이어지는
      // 조각은 칼럼 맨 위부터라 머리글을 걷어내야 한다.
      const deheaded = isFirst ? raw : await dropRunningHeader(raw, ctx.headerBandPx, scale);
      if (!deheaded) continue;
      const trimmed = await trimVerticalWhitespace(deheaded);
      if (trimmed) pieces.push(trimmed);
    }
    if (broken || pieces.length === 0) continue;
    const stacked = await stackVertically(pieces, Math.round(SEGMENT_GAP_PT * scale));
    if (!stacked) continue;
    const image = await finalizeQuestionImage(stacked, scale);
    for (const n of plan.numbers) {
      cropped.push({ number: n, image, groupNumbers: plan.numbers });
      handledNumbers.add(n);
    }
  }

  let carriedStrips = new Map();
  for (let p = 1; p <= pageMarkerData.length; p++) {
    const { page, data } = pageMarkerData[p - 1];
    const { results: pageResults, pendingStrips } = await cropQuestionsFromPage(
      page,
      data,
      scale,
      carriedStrips,
      columnMode,
      columnSplitX,
      footerInkTopByPage[p - 1],
      columnCropX,
      headerInkBottomByPage[p - 1],
      handledNumbers,
    );
    carriedStrips = pendingStrips;
    cropped.push(...pageResults);
    onPage?.(p, pageResults);
  }

  cropped.sort((a, b) => a.number - b.number);
  await normalizeWidths(cropped);

  const seen = new Set();
  for (const c of cropped) {
    if (seen.has(c.number)) {
      throw new Error(`문제 번호 중복 감지: ${c.number}번이 두 번 잘렸습니다. 레이아웃 인식을 확인하세요.`);
    }
    seen.add(c.number);
  }

  // cropped 외에 판정 결과도 같이 돌려준다 — 호출자가 "1단으로 봤는데 실측은
  // 2단"인 오판을 걸러내는 데 쓴다(extractQuestionsFromPdf 주석 참고).
  cropped.columnMode = columnMode;
  cropped.markerData = pageMarkerData.map((d) => d.data);
  return cropped;
}

// PDF 버퍼 전체를 문항별로 잘라 { number, image } 목록을 반환한다. 페이지 순회,
// 정렬, 번호 중복 검사까지 여기서 끝내고, 호출자는 결과를 업로드/DB 반영만 하면
// 된다 — main()의 단일 문제지 흐름과 batch-crop-questions.mjs의 여러 문제지 순회가
// 이 함수 하나를 공유한다. 중복 번호가 감지되면(레이아웃 오인식) 에러를 던진다.
//
// expectedCount(exam_papers.question_count)를 넘기면 두 전략을 시도해 더 정확한
// 쪽을 고른다: 먼저 예전 방식(페이지 폭 절반 기준)으로 시도해 정확히
// expectedCount개가 나오면 그걸 그대로 쓴다 — 이미 잘 크롭되던 수천 장의 기존
// 문제지에 대해 100% 예전과 동일한 동작을 보장하기 위해서다(실측 사고: 실측
// 마커 클러스터 기반 경계 추정이 지문 속 표/목록의 가짜 번호 분포에 따라 오히려
// 더 나쁜 결과를 낼 수 있는 문서가 있었다 — 2025 국가직 7급 상황판단). 예전
// 방식이 실패(에러 또는 개수 불일치)할 때만 실측 클러스터 기반 경계 추정으로
// 재시도하고, 그 결과가 더 나으면(에러 없음 + expectedCount와 일치하거나, 최소
// 예전 방식보다 인식 개수가 많으면) 그걸 쓴다. expectedCount를 안 넘기면(옛
// 호출자와의 호환) 예전 방식이 에러 없이 끝나는 한 그대로 쓴다.
export async function extractQuestionsFromPdf(pdfBuffer, { scale = 3, onPage, expectedCount } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

  let legacyResult;
  let legacyError;
  try {
    legacyResult = await extractWithStrategy(pdf, scale, onPage, false);
  } catch (err) {
    legacyError = err;
  }
  // 개수가 맞아도 legacy를 그대로 믿으면 안 되는 경우가 하나 있다: legacy가 이
  // 문서를 1단으로 판정했는데 실측 마커는 뚜렷하게 두 칼럼으로 갈리는 경우다.
  // legacy의 1단/2단 판정은 "마커 x가 지면 절반보다 오른쪽에 하나라도 있는가"인데,
  // 우측 칼럼이 지면 절반보다 아주 살짝 왼쪽에서 시작하는 조판이 있다(실측: 법원직
  // 9급 — 지면 폭 595, 절반 297.5인데 우측 칼럼 마커가 x=297.4). 그러면 우측 마커가
  // 전부 좌측으로 분류되어 1단으로 오판하고, 문항 수는 25/25로 정확히 맞는 채로
  // 지면 전체 폭을 한 장에 담은 이미지가 나온다 — 문서가 경고하는 "개수만 맞고
  // 반쪽인" 사고 그대로다. 실측 마커 x가 80pt 이상 떨어진 두 무리를 이루면
  // (computeColumnSplitX가 값을 돌려주면) 그건 2단이 확실하므로 legacy를 버린다.
  const legacyMisreadAsSingle =
    legacyResult &&
    legacyResult.columnMode === "single" &&
    computeColumnSplitX(legacyResult.markerData ?? []) != null;
  if (
    legacyResult &&
    !legacyMisreadAsSingle &&
    (expectedCount == null || legacyResult.length === expectedCount)
  ) {
    return legacyResult;
  }

  let overrideResult;
  let overrideError;
  try {
    overrideResult = await extractWithStrategy(pdf, scale, onPage, true);
  } catch (err) {
    overrideError = err;
  }
  if (overrideResult && (expectedCount == null || overrideResult.length === expectedCount)) {
    return overrideResult;
  }

  // 어느 쪽도 정확히 맞아떨어지지 않으면(오류거나 여전히 개수가 다르면) 더 많이
  // 인식한 쪽을 돌려준다 — 둘 다 실패면 호출자가 익숙한 예전 방식의 오류를
  // 그대로 보고 원인을 진단할 수 있게 legacyError를 우선한다.
  if (legacyResult && overrideResult) {
    return overrideResult.length > legacyResult.length ? overrideResult : legacyResult;
  }
  if (legacyResult) return legacyResult;
  if (overrideResult) return overrideResult;
  throw legacyError ?? overrideError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paperId = args["paper-id"];
  const dryRun = Boolean(args["dry-run"]);
  const scale = args.scale ? Number(args.scale) : 3;

  if (!paperId) {
    console.error("사용법: npm run crop-questions -- --paper-id <uuid> [--dry-run]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: paper, error: paperError } = await supabase
    .from("exam_papers")
    .select("id, title, file_path, question_count, choice_count")
    .eq("id", paperId)
    .single();

  if (paperError || !paper) {
    console.error(`문제지를 찾을 수 없습니다: ${paperId}`, paperError?.message);
    process.exit(1);
  }

  console.log(`대상: ${paper.title} (${paper.file_path})`);

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(paper.file_path);
  if (downloadError || !fileBlob) {
    console.error(`PDF 다운로드 실패: ${downloadError?.message}`);
    process.exit(1);
  }
  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());

  let cropped;
  try {
    cropped = await extractQuestionsFromPdf(pdfBuffer, {
      scale,
      expectedCount: paper.question_count,
      onPage: (p, pageResults) =>
        console.log(`페이지 ${p}: 문제 ${pageResults.map((r) => r.number).join(", ") || "(없음)"}`),
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // 개수가 안 맞으면 레이아웃을 잘못 읽었다는 뜻이라(정규식 버그, 1단 레이아웃
  // 등 이번 세션에서 겪은 사례 전부 이랬다), 절반만 맞는 이미지를 올리느니
  // 아예 안 올리고 멈춘다. dry-run은 미리보기 목적이라 그대로 저장해서 원인을
  // 눈으로 확인할 수 있게 둔다.
  const expected = paper.question_count;
  if (expected && cropped.length !== expected && !dryRun) {
    console.error(
      `실패: exam_papers.question_count=${expected}인데 ${cropped.length}개 문제만 인식됐습니다. 레이아웃을 확인하세요.`,
    );
    process.exit(1);
  }
  if (expected && cropped.length !== expected) {
    console.warn(
      `주의: exam_papers.question_count=${expected}인데 ${cropped.length}개 문제만 인식됐습니다.`,
    );
  }

  if (dryRun) {
    const outDir = path.join(process.cwd(), "uploads", "crop-preview", paperId);
    await mkdir(outDir, { recursive: true });
    for (const c of cropped) {
      await writeFile(path.join(outDir, `${String(c.number).padStart(2, "0")}.webp`), c.image);
    }
    console.log(`\n[dry-run] ${cropped.length}개 이미지를 ${outDir} 에 저장했습니다. DB/Storage는 건드리지 않았습니다.`);
    return;
  }

  // 세트문제(공통지문 병합)는 그룹의 첫 번호 경로 하나에만 실제로 업로드하고,
  // 나머지 번호들은 question_images.image_path를 그 경로로 같이 가리키게 한다 —
  // 똑같은 바이트를 번호 수만큼 중복 저장하지 않고, 프런트에서도 image_path가
  // 같은지만 비교하면(바이트를 다시 안 받아도) 세트 여부를 알 수 있다.
  const uploadedPaths = new Set();
  let uploaded = 0;
  for (const c of cropped) {
    const groupStart = Math.min(...(c.groupNumbers ?? [c.number]));
    const storagePath = `questions/${paperId}/${String(groupStart).padStart(2, "0")}.webp`;

    if (!uploadedPaths.has(storagePath)) {
      const { error: uploadError } = await supabase.storage
        .from("exam-papers")
        .upload(storagePath, c.image, { contentType: "image/webp", upsert: true });
      if (uploadError) {
        console.error(`문제 ${c.number}: 업로드 실패 - ${uploadError.message}`);
        continue;
      }
      uploadedPaths.add(storagePath);
    }

    const { data: questionRow, error: questionError } = await supabase
      .from("questions")
      .upsert(
        {
          paper_id: paperId,
          question_number: c.number,
          choice_count: paper.choice_count ?? 4,
        },
        { onConflict: "paper_id,question_number" },
      )
      .select("id")
      .single();

    if (questionError || !questionRow) {
      console.error(`문제 ${c.number}: questions upsert 실패 - ${questionError?.message}`);
      continue;
    }

    const { error: imageError } = await supabase
      .from("question_images")
      .upsert(
        {
          question_id: questionRow.id,
          order_index: 0,
          image_path: storagePath,
        },
        { onConflict: "question_id,order_index" },
      );

    if (imageError) {
      console.error(`문제 ${c.number}: question_images upsert 실패 - ${imageError.message}`);
      continue;
    }

    // 예전 실행이 이 번호 몫으로 올려뒀던 개별 파일이 있다면(이번에 세트 병합으로
    // 공유 경로를 쓰게 된 경우) 지워서 고아 오브젝트를 남기지 않는다.
    if (c.groupNumbers && c.number !== groupStart) {
      await supabase.storage
        .from("exam-papers")
        .remove([`questions/${paperId}/${String(c.number).padStart(2, "0")}.webp`]);
    }

    uploaded++;
    console.log(`완료: ${c.number}번`);
  }

  console.log(`\n총 ${uploaded}/${cropped.length}개 문제 이미지 등록 완료.`);
}

// batch-crop-questions.mjs가 extractQuestionsFromPdf만 가져다 쓰려고 import할 때는
// 이 CLI용 main()이 (process.argv를 오독하며) 같이 실행되면 안 되므로, 직접 실행된
// 경우에만 돌린다.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
