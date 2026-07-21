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
// RELAXED_QUESTION_MARKER_RE가 "빠진 번호 메우기" 용도로만 따로 처리한다.
const QUESTION_MARKER_RE = /^(?:문\s*)?(\d{1,3})\.(?:\s|$)/;

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
  for (const item of items) {
    const [, , , , x, y] = item.transform;
    const col = x < half ? "L" : "R";
    const key = lineKey(y, col);
    if (!lines.has(key)) lines.set(key, { y, col, parts: [] });
    lines.get(key).parts.push({ x, str: item.str });
  }

  // 같은 칼럼 안에서 위→아래(y 내림차순) 순서로 줄을 늘어놓는다 — 안내문이
  // 줄바꿈으로 두 줄에 걸치는 경우(예: "...밑줄 친 부분에... [문 19～" 다음
  // 줄에 "문 20.]") 인접한 다음 줄과 이어붙여 다시 검사하기 위해서다. 이런
  // 경우 한 줄만으로는 "[" 만 있고 "]"가 없어(또는 그 반대) 안내문으로 인식
  //못 하고 그 안의 "19." "20."이 진짜 마커로 오인돼 중복 크래시가 났다
  // (실측: 2022 지방직 9급 영어).
  const linesByCol = new Map();
  for (const [key, line] of lines) {
    const text = line.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join("");
    if (!linesByCol.has(line.col)) linesByCol.set(line.col, []);
    linesByCol.get(line.col).push({ key, y: line.y, text });
  }
  for (const arr of linesByCol.values()) arr.sort((a, b) => b.y - a.y);

  const keys = new Set();
  const groups = [];
  for (const [col, arr] of linesByCol) {
    for (let i = 0; i < arr.length; i++) {
      const line = arr[i];
      let match = ANNOTATION_RANGE_RE.exec(line.text);
      const usedKeys = [line.key];
      if (!match && line.text.includes("[") && !line.text.includes("]")) {
        const next = arr[i + 1];
        if (next) {
          match = ANNOTATION_RANGE_RE.exec(line.text + next.text);
          if (match) usedKeys.push(next.key);
        }
      }
      if (!match) continue;
      for (const k of usedKeys) keys.add(k);
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (end > start && end - start <= 10) {
        groups.push({ start, end, y: line.y, col });
      }
    }
  }
  return { keys, groups };
}

async function findQuestionMarkers(page) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i) => "str" in i);
  const half = viewport.width / 2;
  const { keys: annotationKeys, groups } = findAnnotationLines(items, half);

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
    if (annotationKeys.has(lineKey(itemY, itemX < half ? "L" : "R"))) continue;

    // 진짜 문제 마커는 거의 항상 "문"이 앞에 붙는다(같은 조각이든 "문"만 따로
    // 떨어진 조각이든) — 지문 속 조항·보기 번호("1. 다음의 농지는...")에는
    // "문"이 절대 안 붙는다. 이 유무가 위치(x)보다 훨씬 믿을 수 있는 신호라
    // filterMarginMarkers에서 "문 확인된 마커"를 우선 신뢰하는 데 쓴다.
    const hasMun = /^문\s*/.test(str) || hasMunBefore(itemX, itemY);

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

// 문서 전체 마커에서 칼럼별 최빈 x를 구한다. "문" 신호가 하나라도 있으면
// 기존의 신뢰 마커 기반 필터가 더 정확하므로 계산하지 않는다(null 반환).
export function computeDocMarginX(pageMarkerDataList) {
  const all = pageMarkerDataList.flatMap((d) =>
    d.markers.map((m) => ({ ...m, col: m.x < d.pageWidthPt / 2 ? "L" : "R" })),
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
export function fillMissingNumbersFromRelaxed(pageMarkerDataList, docMarginX) {
  if (docMarginX == null) return;
  const strictNumbers = new Set();
  for (const data of pageMarkerDataList) for (const m of data.markers) strictNumbers.add(m.number);
  if (strictNumbers.size === 0) return;
  const maxNumber = Math.max(...strictNumbers);

  // 같은 번호의 완화형 후보가 여러 개면 여백에 가장 가까운 하나만 쓴다.
  const candidates = new Map();
  for (const data of pageMarkerDataList) {
    const half = data.pageWidthPt / 2;
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

export function pruneDuplicateMarkers(pageMarkerDataList, docMarginX) {
  if (docMarginX == null) return;
  const byNumber = new Map();
  for (const data of pageMarkerDataList) {
    const half = data.pageWidthPt / 2;
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
function splitIntoColumns(markers, pageWidthPt, columnMode) {
  const half = pageWidthPt / 2;
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
// 안내문 스트립의 아래 경계는 안내문 baseline(y)보다 살짝 아래로 내려잡아야
// 한글 받침/디센더가 잘리지 않는다.
const STRIP_DESCENT_PAD = 4;

// trim()으로 가장자리 흰 여백을 걷어낸 뒤 보기 좋게 약간만 다시 패딩한다.
// (내용이 거의 없어 trim이 실패하면 원본을 그대로 쓴다.) 최종 저장은 WebP
// 무손실로 — 문제 이미지는 사진이 아니라 흰 배경+얇은 텍스트/선 위주라 PNG보다
// 60%대로 작아지면서 화질 손실은 없다(실측 결과).
async function finalizeQuestionImage(rawPng, scale) {
  const pad = Math.round(8 * scale);
  try {
    // 세로(위/아래) 여백만 걷어내고 원본 칼럼 폭은 그대로 둔다. 좌우까지 trim하면
    // 선택지가 짧은 문항("① 라이신 …")이 좁게 잘려, 프런트가 이미지를 컨테이너
    // 폭(w-full)에 맞춰 늘릴 때 넓은 문항보다 크게 확대돼 글씨 크기가 문항마다
    // 들쭉날쭉해진다(실측: 2026 지방직 9급 공업화학 8번이 폭 516px로 같은 문제지
    // 다른 문항 ~1050px의 절반 → 표시 글씨 약 2배). 한 문제지 안에서 폭을 칼럼
    // 폭으로 통일해 표시 배율을 맞춘다.
    const { data, info } = await sharp(rawPng)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      let hasInk = false;
      for (let x = 0; x < width; x++) {
        if (data[rowStart + x] < 245) {
          hasInk = true;
          break;
        }
      }
      if (hasInk) {
        if (top === -1) top = y;
        bottom = y;
      }
    }
    if (top === -1) {
      // 내용이 거의 없어 잉크 행을 못 찾으면 원본을 그대로 쓴다.
      return await sharp(rawPng).webp({ lossless: true }).toBuffer();
    }
    return await sharp(rawPng)
      .extract({ left: 0, top, width, height: bottom - top + 1 })
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
async function stackVertically(topBuffer, bottomBuffer) {
  const [topMeta, bottomMeta] = await Promise.all([
    sharp(topBuffer).metadata(),
    sharp(bottomBuffer).metadata(),
  ]);
  return sharp({
    create: {
      width: Math.max(topMeta.width, bottomMeta.width),
      height: topMeta.height + bottomMeta.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: topBuffer, top: 0, left: 0 },
      { input: bottomBuffer, top: topMeta.height, left: 0 },
    ])
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
async function cropQuestionsFromPage(
  page,
  markerData,
  scale,
  carriedStrips = new Map(),
  columnMode = "double",
) {
  const { markers, groups, pageWidthPt, pageHeightPt } = markerData;
  if (markers.length === 0) return { results: [], pendingStrips: carriedStrips };

  const { left, right, half } = splitIntoColumns(markers, pageWidthPt, columnMode);
  const { buffer: pageImage, width: pageWidthPx, height: pageHeightPx } =
    await renderPageToPng(page, scale);

  const columnDefs =
    columnMode === "single"
      ? [{ key: "L", markers: left, xLeftPt: PAGE_MARGIN_X, xRightPt: pageWidthPt - PAGE_MARGIN_X }]
      : [
          { key: "L", markers: left, xLeftPt: PAGE_MARGIN_X, xRightPt: half - COLUMN_GAP },
          { key: "R", markers: right, xLeftPt: half + COLUMN_GAP, xRightPt: pageWidthPt - PAGE_MARGIN_X },
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

  // fromY보다 아래(같은 칼럼)에서 크롭을 끊을 y — 다음 마커와 다음 안내문 중 더
  // 위에 있는 쪽. 안내문을 경계로 안 삼으면 위 문제의 크롭이 다음 세트의
  // 안내문·지문까지 집어삼킨다(예: 5번 크롭에 "[6~7] 다음 글을..."과 그 지문이
  // 통째로 딸려 들어가는 문제).
  function findBottomBoundary(colDef, fromY) {
    const nextMarker = colDef.markers.find((m) => m.y < fromY);
    let bottomY = nextMarker ? nextMarker.y : null;
    for (const g of groups) {
      if (g.col !== colDef.key) continue;
      if (g.y < fromY && (bottomY === null || g.y > bottomY)) bottomY = g.y;
    }
    return bottomY;
  }

  const mergedSets = []; // { colDef, numbers, top, bottom }
  const mergedNumbers = new Set();
  const stripRegions = []; // { colDef, top, bottom, memberNumbers }
  const topOverrideByNumber = new Map();

  for (const g of groups) {
    const colDef = columnDefs.find((c) => c.key === g.col);
    const below = colDef.markers.filter((m) => m.y < g.y);
    const members = below.filter((m) => m.number >= g.start && m.number <= g.end);

    // 공통지문형 병합은 그룹 전원이 안내문과 같은 칼럼에 있을 때만 가능하다
    // (칼럼을 넘으면 한 사각형으로 잘라낼 수 없다).
    if (members.length === g.end - g.start + 1 && members.length >= 2) {
      const gapBeforeFirst = g.y - members[0].y;
      const gapsBetween = [];
      for (let k = 0; k < members.length - 1; k++) {
        gapsBetween.push(members[k].y - members[k + 1].y);
      }
      const avgBetween = gapsBetween.reduce((a, b) => a + b, 0) / gapsBetween.length;
      if (gapBeforeFirst >= GROUP_MIN_GAP_PT && gapBeforeFirst >= avgBetween * GROUP_GAP_RATIO) {
        const bottomY = findBottomBoundary(colDef, members[members.length - 1].y);
        mergedSets.push({
          colDef,
          numbers: members.map((m) => m.number),
          top: Math.min(pageHeightPt, g.y + TOP_PAD),
          bottom: bottomY !== null ? bottomY + TOP_PAD : BOTTOM_MARGIN,
        });
        for (const m of members) mergedNumbers.add(m.number);
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
    const raw = await extractRegion(set.colDef, set.top, set.bottom);
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
      if (mergedNumbers.has(marker.number)) continue;
      const top =
        topOverrideByNumber.get(marker.number) ??
        Math.min(pageHeightPt, marker.y + marker.height + TOP_PAD);
      const bottomY = findBottomBoundary(colDef, marker.y);
      const bottom = bottomY !== null ? bottomY + TOP_PAD : BOTTOM_MARGIN;

      let raw = await extractRegion(colDef, top, bottom);
      if (!raw) {
        console.warn(`문제 ${marker.number}: 잘라낼 영역이 비어있어 건너뜀`);
        continue;
      }
      const strip = stripByNumber.get(marker.number);
      if (strip) {
        raw = await stackVertically(strip, raw);
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

// PDF 버퍼 전체를 문항별로 잘라 { number, image } 목록을 반환한다. 페이지 순회,
// 정렬, 번호 중복 검사까지 여기서 끝내고, 호출자는 결과를 업로드/DB 반영만 하면
// 된다 — main()의 단일 문제지 흐름과 batch-crop-questions.mjs의 여러 문제지 순회가
// 이 함수 하나를 공유한다. 중복 번호가 감지되면(레이아웃 오인식) 에러를 던진다.
export async function extractQuestionsFromPdf(pdfBuffer, { scale = 3, onPage } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

  // 1차 패스: 렌더링 없이 텍스트만 뽑아 이 문제지가 좌우 2단인지 전체 폭 1단인지
  // 판단한다. 페이지 하나만 보고 정하면 마커가 몇 개 안 남는 마지막 페이지 같은
  // 데서 우연히 한쪽에만 몰려 2단을 1단으로 오판할 수 있어(반대로 1단인데 지문
  // 속 텍스트가 어쩌다 half를 넘어 2단으로 오판할 수도 있고), 문서 전체의 마커를
  // 모아 한 번만 정한다 — 실측상 진짜 2단이면 문서 전체에 오른쪽 마커가 여럿
  // 나오고, 진짜 1단이면 전체를 통틀어 단 하나도 안 나온다. 여기서 얻은 결과를
  // 2차(실제 크롭) 패스가 그대로 재사용해 페이지당 텍스트 추출을 두 번 하지 않는다.
  const pageMarkerData = [];
  let hasRightColumnMarker = false;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const data = await findQuestionMarkers(page);
    pageMarkerData.push({ page, data });
    if (data.markers.some((m) => m.x >= data.pageWidthPt / 2)) hasRightColumnMarker = true;
  }
  const columnMode = hasRightColumnMarker ? "double" : "single";
  // "문" 표기가 없는 조판(경찰 간부후보 등)은 문서 전체 기준 여백 x를 구해
  // 빠진 번호 메우기와 중복 번호 정리의 기준으로 쓴다.
  const docMarginX = computeDocMarginX(pageMarkerData.map((d) => d.data));
  fillMissingNumbersFromRelaxed(
    pageMarkerData.map((d) => d.data),
    docMarginX,
  );
  pruneDuplicateMarkers(
    pageMarkerData.map((d) => d.data),
    docMarginX,
  );

  const cropped = [];
  let carriedStrips = new Map();
  for (let p = 1; p <= pageMarkerData.length; p++) {
    const { page, data } = pageMarkerData[p - 1];
    const { results: pageResults, pendingStrips } = await cropQuestionsFromPage(
      page,
      data,
      scale,
      carriedStrips,
      columnMode,
      docMarginX,
    );
    carriedStrips = pendingStrips;
    cropped.push(...pageResults);
    onPage?.(p, pageResults);
  }

  cropped.sort((a, b) => a.number - b.number);

  const seen = new Set();
  for (const c of cropped) {
    if (seen.has(c.number)) {
      throw new Error(`문제 번호 중복 감지: ${c.number}번이 두 번 잘렸습니다. 레이아웃 인식을 확인하세요.`);
    }
    seen.add(c.number);
  }

  return cropped;
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
