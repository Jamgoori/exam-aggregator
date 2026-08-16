// 정답표 PDF의 텍스트 레이어를 좌표 기반으로 파싱해 과목별 정답 배열을 복원한다.
//
// 배경: 정답 등록 파이프라인(extract-answer-keys.mjs)이 Claude 비전으로 격자를
// 옮겨 적다가 열 중간 구간을 오독한 사고가 있었다 (2026-08-16 발견 — 국회직 9급
// 15개 문제지 46셀 오염, AI 해설 배치의 unverified 급증으로 드러남). 텍스트
// 레이어가 있는 PDF는 이 파서가 결정적으로(모델 개입 없이) 격자를 읽을 수 있으므로,
// 추출 결과의 교차 검증 증인 및 사후 감사(audit-answer-keys.mjs)에 쓴다.
//
// 지원 레이아웃 세 가지 (한 페이지에 섞여 있어도 각각 인식된다):
//  A. "문N" 행 라벨 × 과목 헤더 열 격자 (국회직 등).
//     - 구형 PDF는 라벨이 "문"과 "N" 두 아이템으로 쪼개져 있다 → 병합해서 인식.
//     - 5급처럼 열마다 문항 수가 다르면(PSAT 40 vs 헌법 25) 빈 자리는 null.
//     - 한 페이지에 표가 여러 개(직렬별 표 등)면 행 라벨 x-군집으로 분리한다.
//  B. 전치형: "1번".."25번" 열 헤더 × 과목 행 (군무원·기상직 등).
//     - 군무원처럼 과목명에 "7급" 급수가 붙으면 levelHint로 떼어 보고한다.
//  C. 과목마다 "번호|정답" 쌍이 반복되고 정답이 원문자(①~⑤)인 격자 (법원직 등).
//     - "◉ ○○직렬" 제목이 있으면 trackHint로 보고한다. 블록(직렬 표)마다 분리.
// 전항정답 등으로 숫자가 인쇄되지 않은 셀은 null (호출 쪽이 대조 제외로 처리).
// 텍스트 레이어가 없거나(스캔본) 구조가 안 잡히면 빈 결과를 반환하고, 호출 쪽이
// "교차 검증 불가"로 처리한다 — 이 파서는 절대 추측하지 않는다.

export async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export function normalizeSubjectName(name) {
  // 헤더는 "국 어"처럼 자간 공백이 들어가거나 줄바꿈으로 쪼개지고, "(상용한자
  // 포함)" 병기가 붙기도 한다. 공백류와 괄호·구분 기호를 걷어내고 비교한다.
  return (name ?? "").replace(/[\s ()（）·ㆍ,【】『』「」]+/g, "");
}

const ROW_LABEL = /^문\s*(\d{1,3})$/;
const DIGIT = /^[1-5]$/;
const CIRCLED = { "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5 };
// 셀 값: 맨숫자 1~5 또는 원문자 ①~⑤. "②, ③"(복수정답 병기)는 값으로 안 읽는다
// — 해당 셀은 null로 남고, DB의 voided_questions가 그 자리를 대조에서 빼준다.
function cellValue(str) {
  if (DIGIT.test(str)) return Number(str);
  if (CIRCLED[str] !== undefined) return CIRCLED[str];
  return null;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

// "문" + "N"으로 쪼개진 라벨을 병합하고, 라벨로 소비된 숫자 아이템을 표시한다.
function extractLabels(items) {
  const labels = [];
  const consumed = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const m = it.str.match(ROW_LABEL);
    if (m) {
      labels.push({ q: Number(m[1]), x: it.x, y: it.y });
      continue;
    }
    if (it.str !== "문") continue;
    // 오른쪽으로 30pt 안, 같은 y 밴드(±4)의 첫 숫자 아이템이 문항 번호다.
    let best = null;
    for (let j = 0; j < items.length; j++) {
      if (i === j || consumed.has(j)) continue;
      const n = items[j];
      if (!/^\d{1,3}$/.test(n.str)) continue;
      const dx = n.x - it.x;
      if (dx <= 0 || dx > 30 || Math.abs(n.y - it.y) > 4) continue;
      if (best === null || dx < best.dx) best = { j, dx };
    }
    if (best) {
      consumed.add(best.j);
      labels.push({ q: Number(items[best.j].str), x: it.x, y: it.y });
    }
  }
  return { labels, consumed };
}

// 한 페이지의 텍스트 아이템들에서 표들을 찾아낸다.
// 반환: [{ columns: [{ header, values, levelHint?, trackHint? }], rowNumbers, warnings }]
//   values[i]는 rowNumbers[i] 문항의 정답 (없는 셀은 null)
export function parsePageItems(rawItems) {
  const items = rawItems
    .map((it) => ({
      str: (it.str ?? "").trim(),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
    }))
    .filter((it) => it.str.length > 0);

  return [
    ...parseGridTables(items),
    ...parseTransposedTables(items),
    ...parsePairedTables(items),
    ...parseStripTables(items),
    ...parseInlinePairTables(items),
  ];
}

// 맨숫자 행 라벨(1,2,3,…) 열 탐지 — "문" 접두 없는 구형 표(기상직 2010 등).
// 1부터 시작해 1씩 증가하는 6개 이상의 세로 수열만 라벨 열로 인정한다. 정답 값은
// 1~5 반복이라 이 조건을 만족할 수 없어 데이터 열이 라벨로 오인되지 않는다.
function extractBareNumberLabels(items) {
  const labels = [];
  const consumed = new Set();
  const clusters = [];
  items.forEach((it, idx) => {
    if (!/^\d{1,3}$/.test(it.str)) return;
    const c = clusters.find((c) => Math.abs(c.x - it.x) <= 6);
    if (c) c.members.push({ idx, q: Number(it.str), y: it.y });
    else clusters.push({ x: it.x, members: [{ idx, q: Number(it.str), y: it.y }] });
  });
  for (const c of clusters) {
    const sorted = [...c.members].sort((a, b) => b.y - a.y);
    // 위에서 아래로 1,2,3,… 이어지는 구간들을 뽑는다 (표가 위아래로 여러 개면 재시작).
    let run = [];
    const flush = () => {
      if (run.length >= 6) {
        for (const m of run) {
          consumed.add(m.idx);
          labels.push({ q: m.q, x: c.x, y: m.y });
        }
      }
      run = [];
    };
    for (const m of sorted) {
      if (run.length === 0 ? m.q === 1 : m.q === run[run.length - 1].q + 1) run.push(m);
      else {
        flush();
        if (m.q === 1) run.push(m);
      }
    }
    flush();
  }
  return { labels, consumed };
}

// ---- 레이아웃 A: "문N"(또는 맨숫자) 행 × 과목 열 ----
function parseGridTables(items) {
  let { labels, consumed } = extractLabels(items);
  if (labels.length === 0) {
    // 다른 레이아웃의 표식이 있는 페이지에서는 맨숫자 라벨을 시도하지 않는다 —
    // "번호|정답" 쌍(레이아웃 C)의 문항 번호나 전치형(레이아웃 B)의 연번 열을
    // 행 라벨로 오인하는 것을 막는다.
    const hasPairMarkers = items.filter((it) => it.str === "정답").length >= 2;
    const hasTransposedMarkers = items.filter((it) => COL_LABEL.test(it.str)).length >= 5;
    if (hasPairMarkers || hasTransposedMarkers) return [];
    ({ labels, consumed } = extractBareNumberLabels(items));
  }
  if (labels.length === 0) return [];

  // 행 라벨을 x 군집으로 묶는다 — 군집 하나가 표 하나의 왼쪽 라벨 열이다.
  const X_CLUSTER_TOL = 20;
  const clusters = [];
  for (const label of [...labels].sort((a, b) => a.x - b.x)) {
    const c = clusters.find((c) => Math.abs(c.x - label.x) <= X_CLUSTER_TOL);
    if (c) {
      c.labels.push(label);
      c.x = median(c.labels.map((l) => l.x));
    } else {
      clusters.push({ x: label.x, labels: [label] });
    }
  }

  // 같은 x 군집 안에서 문항 번호가 되돌아가면(표 두 개가 위아래로 쌓인 경우) 분리.
  const tablesRaw = [];
  for (const c of clusters) {
    const sorted = [...c.labels].sort((a, b) => b.y - a.y); // 위(큰 y) → 아래
    let current = [];
    for (const label of sorted) {
      if (current.length > 0 && label.q <= current[current.length - 1].q) {
        tablesRaw.push({ x: c.x, labels: current });
        current = [];
      }
      current.push(label);
    }
    if (current.length > 0) tablesRaw.push({ x: c.x, labels: current });
  }

  const tableXs = tablesRaw.map((t) => t.x).sort((a, b) => a - b);
  const xRangeOf = (tx) => {
    const next = tableXs.filter((x) => x > tx + X_CLUSTER_TOL);
    return [tx, next.length > 0 ? Math.min(...next) : Infinity];
  };

  const tables = [];
  for (const t of tablesRaw) {
    const warnings = [];
    const rows = [...t.labels].sort((a, b) => b.y - a.y);
    const [, x1] = xRangeOf(t.x);
    const yTop = rows[0].y;
    const yBottom = rows[rows.length - 1].y;
    const rowGap = rows.length > 1 ? (yTop - yBottom) / (rows.length - 1) : 12;
    const rowTol = Math.min(rowGap / 2, 8);

    // 이 표 영역의 정답 값들을 행별로 모은다 (라벨로 소비된 아이템 제외).
    const rowDigits = new Map(rows.map((r) => [r.q, []]));
    items.forEach((it, idx) => {
      if (consumed.has(idx)) return;
      const v = cellValue(it.str);
      if (v === null) return;
      if (it.x <= t.x + 4 || it.x >= x1) return;
      let best = null;
      for (const r of rows) {
        const dy = Math.abs(it.y - r.y);
        if (dy <= rowTol && (best === null || dy < Math.abs(it.y - best.y))) best = r;
      }
      if (best) rowDigits.get(best.q).push({ x: it.x, v });
    });
    for (const arr of rowDigits.values()) arr.sort((a, b) => a.x - b.x);

    // 열 개수 = 행별 숫자 개수의 최빈값. 그 행들의 k번째 x 중앙값이 열 중심이다.
    const countFreq = new Map();
    for (const arr of rowDigits.values())
      countFreq.set(arr.length, (countFreq.get(arr.length) ?? 0) + 1);
    let nCols = 0;
    let bestFreq = 0;
    for (const [n, f] of countFreq) {
      if (n > 0 && (f > bestFreq || (f === bestFreq && n > nCols))) {
        nCols = n;
        bestFreq = f;
      }
    }
    if (nCols === 0) continue;
    const centers = [];
    for (let k = 0; k < nCols; k++) {
      const xs = [...rowDigits.values()]
        .filter((a) => a.length === nCols)
        .map((a) => a[k].x);
      centers.push(median(xs));
    }
    const colSpacing =
      centers.length > 1
        ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1)
        : 40;
    const assignTol = Math.min(colSpacing / 2, 18);

    // 모든 행의 숫자를 가장 가까운 열 중심에 배정한다. 개수가 최빈값과 다른 행
    // (문항 수가 다른 과목, 전항정답 빈 셀)도 x 기준으로 제자리에 놓인다.
    const grid = new Map(rows.map((r) => [r.q, Array(nCols).fill(null)]));
    for (const r of rows) {
      const cells = grid.get(r.q);
      for (const d of rowDigits.get(r.q)) {
        let bestK = -1;
        let bestD = Infinity;
        for (let k = 0; k < nCols; k++) {
          const dist = Math.abs(d.x - centers[k]);
          if (dist < bestD) {
            bestD = dist;
            bestK = k;
          }
        }
        if (bestK < 0 || bestD > assignTol) {
          warnings.push(`문${r.q}: x=${Math.round(d.x)} 숫자를 열에 못 붙임`);
          continue;
        }
        if (cells[bestK] !== null) {
          warnings.push(`문${r.q}: ${bestK + 1}번째 열에 숫자 중복`);
          continue;
        }
        cells[bestK] = d.v;
      }
    }

    // 헤더: 문1 행 위쪽 밴드의 텍스트 조각을 (조각 중점 기준) 가장 가까운 열에 붙인다.
    // 라벨 열("가형" 등)에 더 가까운 조각은 버린다.
    const headerParts = items.filter(
      (it) =>
        cellValue(it.str) === null &&
        !/^\d+$/.test(it.str) &&
        !ROW_LABEL.test(it.str) &&
        it.str !== "문" &&
        it.y > yTop + rowTol &&
        it.y <= yTop + rowGap * 4 &&
        it.x + it.w / 2 >= t.x - colSpacing / 2 &&
        it.x + it.w / 2 < x1,
    );
    // 책형 하위 열: 한 과목 아래 "가형|다형" 두 열이 나란한 판(2011 국회직 등).
    // 형 글자를 먼저 열에 배정한 뒤, 연속한 형 열 구간(가|다)을 그룹으로 묶고
    // 과목명은 그룹 중심에 배정한다 — 과목명이 쌍 정중앙에 있어 한쪽 하위 열로
    // 쏠리는 문제와, 그룹 경계 너머로 물려받는 문제를 함께 막는다.
    const FORM_SUB = /^[가나다라]형$/;
    const formByCol = Array.from({ length: nCols }, () => null);
    const formParts = [];
    const subjectParts = [];
    for (const part of headerParts) {
      if (FORM_SUB.test(part.str)) {
        const mid = part.x + part.w / 2;
        let bestK = -1;
        let bestD = colSpacing;
        for (let k = 0; k < nCols; k++) {
          const d = Math.abs(mid - centers[k]);
          if (d < bestD) {
            bestD = d;
            bestK = k;
          }
        }
        if (bestK >= 0) {
          formByCol[bestK] = part.str;
          formParts.push(part);
        }
      } else {
        subjectParts.push(part);
      }
    }

    const headers = Array.from({ length: nCols }, () => "");
    if (formParts.length >= 2) {
      // 형 행 바로 위 두 행 안의 조각만 과목명이다 — 더 위의 직류 상자("경위·속기직")
      // 같은 제목은 버린다.
      const formY = median(formParts.map((p) => p.y));
      const nearParts = subjectParts.filter(
        (p) => p.y > formY + 2 && p.y <= formY + rowGap * 2.5,
      );
      // 연속한 형 열 구간 = 그룹 (형 글자가 반복되면 새 그룹).
      const groups = [];
      let cur = null;
      for (let k = 0; k < nCols; k++) {
        if (!formByCol[k]) {
          cur = null;
          continue;
        }
        if (cur && !cur.forms.includes(formByCol[k])) {
          cur.cols.push(k);
          cur.forms.push(formByCol[k]);
        } else {
          cur = { cols: [k], forms: [formByCol[k]] };
          groups.push(cur);
        }
      }
      for (const g of groups) {
        g.center =
          g.cols.reduce((s, k) => s + centers[k], 0) / g.cols.length;
      }
      const partsByGroup = groups.map(() => []);
      const groupSpan = colSpacing * 2;
      for (const part of nearParts) {
        const mid = part.x + part.w / 2;
        let bestG = -1;
        let bestD = groupSpan;
        for (let gi = 0; gi < groups.length; gi++) {
          const d = Math.abs(mid - groups[gi].center);
          if (d < bestD) {
            bestD = d;
            bestG = gi;
          }
        }
        // 라벨 열("구분" 등)에 더 가까운 조각은 과목명이 아니다.
        if (bestG >= 0 && bestD < Math.abs(mid - t.x)) partsByGroup[bestG].push(part);
      }
      groups.forEach((g, gi) => {
        const name = normalizeSubjectName(
          partsByGroup[gi]
            .sort((a, b) => b.y - a.y || a.x - b.x)
            .map((p) => p.str)
            .join(""),
        );
        for (const k of g.cols) headers[k] = name;
      });
    } else {
      // 형 하위 열이 없는 일반 격자: 조각을 가장 가까운 열에 붙인다.
      const headerByCol = Array.from({ length: nCols }, () => []);
      for (const part of subjectParts) {
        const mid = part.x + part.w / 2;
        let bestK = -1;
        let bestD = Math.abs(mid - t.x); // 라벨 열이 기본 승자 → 열에 못 붙으면 버려짐
        for (let k = 0; k < nCols; k++) {
          const d = Math.abs(mid - centers[k]);
          if (d < bestD) {
            bestD = d;
            bestK = k;
          }
        }
        if (bestK >= 0 && bestD <= colSpacing) headerByCol[bestK].push(part);
      }
      headerByCol.forEach((parts, k) => {
        headers[k] = normalizeSubjectName(
          parts
            .sort((a, b) => b.y - a.y || a.x - b.x)
            .map((p) => p.str)
            .join(""),
        );
      });
    }

    tables.push({
      columns: headers.map((header, k) => ({
        header,
        values: rows.map((r) => grid.get(r.q)[k]),
        formHint: formByCol[k],
      })),
      rowNumbers: rows.map((r) => r.q),
      warnings,
    });
  }
  return tables;
}

// ---- 레이아웃 B: "N번" 열 헤더 × 과목 행 (전치형, 군무원·기상직) ----
const COL_LABEL = /^(\d{1,3})\s*번$/;
const LEVEL_HINT = /\s*([579]급)\s*$/;

// 전치형 행들의 y 간격 중앙값 (세로 병합 과목명 상속 거리 기준).
function rowGaps(columns) {
  const ys = columns.map((c) => c.y).sort((a, b) => b - a);
  const gaps = [];
  for (let i = 1; i < ys.length; i++) {
    const g = ys[i - 1] - ys[i];
    if (g > 2) gaps.push(g);
  }
  return gaps.length > 0 ? median(gaps) : 18;
}

function parseTransposedTables(items) {
  // 같은 y에 "1번","2번",...이 5개 이상 늘어서 있으면 전치형 헤더 행이다.
  const colLabels = [];
  const rawLabels = [];
  for (const it of items) {
    const m = it.str.match(COL_LABEL);
    if (m) {
      colLabels.push({ q: Number(m[1]), x: it.x + it.w / 2, y: it.y });
      rawLabels.push(it);
    }
  }
  if (colLabels.length === 0) return [];
  // "1번 ④ 2번 ④ …" 인라인 쌍 레이아웃(경찰 2020~)과의 구분: "N번" 대부분의 바로
  // 오른쪽에 정답 값이 붙어 있으면 전치형이 아니다 — parseInlinePairTables가 맡는다.
  const withValueRight = rawLabels.filter((l) =>
    items.some(
      (it) =>
        cellValue(it.str) !== null &&
        Math.abs(it.y - l.y) <= 4 &&
        it.x > l.x &&
        it.x - (l.x + l.w) < 40,
    ),
  ).length;
  if (withValueRight > rawLabels.length / 2) return [];
  const byY = new Map();
  for (const l of colLabels) {
    const key = [...byY.keys()].find((y) => Math.abs(y - l.y) <= 4) ?? l.y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(l);
  }

  const tables = [];
  const headerYs = [...byY.keys()].sort((a, b) => b - a);
  for (const hy of headerYs) {
    const cols = byY.get(hy).sort((a, b) => a.x - b.x);
    if (cols.length < 5) continue;
    const qns = cols.map((c) => c.q);
    const colSpacing =
      cols.length > 1 ? (cols[cols.length - 1].x - cols[0].x) / (cols.length - 1) : 30;
    const assignTol = Math.min(colSpacing / 2, 16);
    // 이 표의 y 범위: 헤더 아래부터 다음 전치형 헤더 위까지.
    const nextHy = headerYs.find((y) => y < hy - 4);
    const yLimit = nextHy !== undefined ? nextHy : -Infinity;

    // 데이터 행: 헤더 아래의 숫자들을 y 밴드로 묶는다.
    const digitRows = new Map(); // y(대표) → [{x, v}]
    for (const it of items) {
      if (!DIGIT.test(it.str)) continue;
      if (it.y >= hy - 2 || it.y <= yLimit + 2) continue;
      const mid = it.x + it.w / 2;
      if (mid < cols[0].x - colSpacing || mid > cols[cols.length - 1].x + colSpacing) continue;
      const key = [...digitRows.keys()].find((y) => Math.abs(y - it.y) <= 4) ?? it.y;
      if (!digitRows.has(key)) digitRows.set(key, []);
      digitRows.get(key).push({ x: mid, v: Number(it.str) });
    }

    const warnings = [];
    const columns = [];
    const rowYList = [...digitRows.keys()].sort((a, b) => b - a);
    const dataRowGap =
      rowYList.length > 1
        ? (rowYList[0] - rowYList[rowYList.length - 1]) / (rowYList.length - 1)
        : 18;
    for (const [ry, digits] of [...digitRows.entries()].sort((a, b) => b[0] - a[0])) {
      const values = Array(cols.length).fill(null);
      for (const d of digits) {
        let bestK = -1;
        let bestD = Infinity;
        for (let k = 0; k < cols.length; k++) {
          const dist = Math.abs(d.x - cols[k].x);
          if (dist < bestD) {
            bestD = dist;
            bestK = k;
          }
        }
        if (bestK < 0 || bestD > assignTol) continue;
        if (values[bestK] !== null) {
          warnings.push(`y=${Math.round(ry)} 행 ${qns[bestK]}번 열에 숫자 중복`);
          continue;
        }
        values[bestK] = d.v;
      }
      if (values.every((v) => v === null)) continue;

      // 행 라벨(과목명): 이 y 밴드에서 첫 문항 열보다 왼쪽에 있는 텍스트.
      // 연번 숫자는 빼고, 책형 코드(가/나 또는 S/T 같은 한 글자)는 formHint로 뗀다.
      // 국가직처럼 과목명 셀이 책형 두 행에 세로 병합된 판은 과목명이 행 y에서
      // 반 행쯤 비껴 있으므로 허용치를 행 간격의 60%로 잡는다.
      const zoneParts = items
        .filter(
          (it) =>
            Math.abs(it.y - ry) <= Math.max(4, dataRowGap * 0.6) &&
            it.x + it.w / 2 < cols[0].x - assignTol &&
            !/^\d+$/.test(it.str) &&
            !COL_LABEL.test(it.str) &&
            !["과목명", "연번", "책형"].includes(it.str),
        )
        .sort((a, b) => a.x - b.x);
      const formPart = zoneParts.find((p) => /^[A-Za-z가-힣]$/.test(p.str));
      const labelParts = zoneParts.filter(
        (p) => p !== formPart && Math.abs(p.y - ry) <= Math.max(4, dataRowGap * 0.6),
      );
      let header = labelParts.map((p) => p.str).join(" ").trim();
      let levelHint = null;
      const lm = header.match(LEVEL_HINT);
      if (lm) {
        levelHint = lm[1];
        header = header.replace(LEVEL_HINT, "");
      }
      header = normalizeSubjectName(header);
      columns.push({ header, values, levelHint, formHint: formPart?.str ?? null, y: ry });
    }
    // 세로 병합 과목명 상속: 책형 코드만 있고 과목명이 빈 행은, 행 간격 1.6배 안의
    // 이웃 행에서 과목명을 물려받는다 (국가직 S/T 책형 두 행 = 한 과목).
    const rGap = rowGaps(columns);
    for (const c of columns) {
      if (c.header || !c.formHint) continue;
      let best = null;
      for (const o of columns) {
        if (!o.header || o === c) continue;
        const d = Math.abs(o.y - c.y);
        if (d <= rGap * 1.6 && (best === null || d < Math.abs(best.y - c.y))) best = o;
      }
      if (best) {
        c.header = best.header;
        c.levelHint = c.levelHint ?? best.levelHint;
      }
    }
    for (const c of columns) delete c.y;
    const named = columns.filter((c) => c.header);
    if (named.length > 0) tables.push({ columns: named, rowNumbers: qns, warnings });
  }
  return tables;
}

// ---- 레이아웃 C: 과목별 "번호|정답" 쌍 + 원문자/숫자 정답 (법원직·계리직) ----
const TRACK_HEADING = /^◉?\s*(.+?직렬|.+?서기보)\s*$/;

function parsePairedTables(items) {
  // "정답" 헤더마다 왼쪽에서 가장 가까운 "번호"(계리직은 "문항/번호" 두 줄이라
  // y가 어긋난다)가 짝이다. 쌍의 번호 열 아래 숫자가 문항 번호, 정답 열 아래
  // 원문자/숫자가 정답이다.
  const numHeaders = items.filter((it) => it.str === "번호" || it.str === "문항번호");
  const ansHeaders = items.filter((it) => it.str === "정답");
  const pairs = [];
  for (const a of ansHeaders) {
    let best = null;
    for (const n of numHeaders) {
      const dx = a.x - n.x;
      if (dx <= 0 || dx > 120 || Math.abs(a.y - n.y) > 15) continue;
      if (!best || dx < best.dx) best = { n, dx };
    }
    if (best)
      pairs.push({ numX: best.n.x + best.n.w / 2, ansX: a.x + a.w / 2, y: a.y });
  }
  if (pairs.length < 2) return [];

  // 쌍들을 y 밴드로 묶는다 — 밴드 하나가 블록(직렬 표 등) 하나다.
  const bands = [];
  for (const p of [...pairs].sort((a, b) => b.y - a.y)) {
    const b = bands.find((b) => Math.abs(b.y - p.y) <= 15);
    if (b) b.pairs.push(p);
    else bands.push({ y: p.y, pairs: [p] });
  }

  const tables = [];
  for (let bi = 0; bi < bands.length; bi++) {
    const bandPairs = bands[bi].pairs.sort((a, b) => a.numX - b.numX);
    if (bandPairs.length < 2) continue;
    const hy = bands[bi].y;
    const pairSpacing =
      bandPairs.length > 1
        ? (bandPairs[bandPairs.length - 1].numX - bandPairs[0].numX) / (bandPairs.length - 1)
        : 120;
    const yLimit = bands[bi + 1] ? bands[bi + 1].y : -Infinity;
    const inBlock = (y) => y < hy - 4 && y > yLimit + 4;
    // 번호 열과 정답 열이 붙어 있으므로(법원직은 30pt) 배정 허용치는 그 절반 이내로.
    const tolOf = (p) => Math.min(pairSpacing / 3, (p.ansX - p.numX) / 2);

    // 행 y 밴드: 정답 열 위치의 값 아이템으로 잡는다.
    const rowYs = [];
    for (const it of items) {
      if (cellValue(it.str) === null || !inBlock(it.y)) continue;
      const mid = it.x + it.w / 2;
      if (!bandPairs.some((p) => Math.abs(mid - p.ansX) <= tolOf(p))) continue;
      if (!rowYs.some((y) => Math.abs(y - it.y) <= 4)) rowYs.push(it.y);
    }
    if (rowYs.length === 0) continue;
    rowYs.sort((a, b) => b - a);
    const rowGap =
      rowYs.length > 1 ? (rowYs[0] - rowYs[rowYs.length - 1]) / (rowYs.length - 1) : 22;

    // 과목 헤더: 블록 헤더 위 ~ 4행 높이 안의 텍스트 조각을 쌍 중심에 붙인다.
    const headerParts = items.filter(
      (it) =>
        it.y > hy + 2 &&
        it.y <= hy + rowGap * 4 &&
        !["번호", "정답", "문항", "문항번호"].includes(it.str) &&
        !TRACK_HEADING.test(it.str) &&
        !/책형|정답표|공무원|시행/.test(it.str) &&
        !/^[<>①②③④⑤◉ㆍ\d\s]+$/.test(it.str),
    );
    const headerByPair = bandPairs.map(() => []);
    for (const part of headerParts) {
      const mid = part.x + part.w / 2;
      let bestK = -1;
      let bestD = Infinity;
      for (let k = 0; k < bandPairs.length; k++) {
        const center = (bandPairs[k].numX + bandPairs[k].ansX) / 2;
        const d = Math.abs(mid - center);
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      if (bestK >= 0 && bestD <= pairSpacing) headerByPair[bestK].push(part);
    }

    // 직렬 제목(◉ 법원사무직렬): 블록 위쪽에서 가장 가까운 것.
    let trackHint = null;
    let trackY = -Infinity;
    for (const it of items) {
      const m = it.str.match(TRACK_HEADING);
      if (m && it.y > hy && it.y > trackY && it.y <= hy + rowGap * 8) {
        trackHint = m[1].replace(/직렬$/, "");
        trackY = it.y;
      }
    }

    const warnings = [];
    const columns = [];
    const allQns = new Set();
    // 문항 번호 숫자가 텍스트 레이어에 아예 없는 PDF(계리직 — 번호가 그래픽으로만
    // 그려짐)를 위한 위치 폴백: 행 간격이 균일할 때만 "위에서 k번째 행 = 문k"로
    // 대응시킨다. 간격이 불균일하면 폴백하지 않는다 (추측 금지).
    const uniformRows = rowYs.every(
      (y, i) => i === 0 || Math.abs(rowYs[i - 1] - y - rowGap) <= rowGap * 0.35,
    );
    const perPair = bandPairs.map((p, k) => {
      const cells = new Map(); // qn → 정답
      const tol = tolOf(p);
      const byRow = rowYs.map((ry) => ({
        numIt: items.find(
          (it) =>
            /^\d{1,3}$/.test(it.str) &&
            Math.abs(it.y - ry) <= 4 &&
            Math.abs(it.x + it.w / 2 - p.numX) <= tol,
        ),
        ansIt: items.find(
          (it) =>
            cellValue(it.str) !== null &&
            Math.abs(it.y - ry) <= 4 &&
            Math.abs(it.x + it.w / 2 - p.ansX) <= tol,
        ),
      }));
      const anyNum = byRow.some((r) => r.numIt);
      byRow.forEach(({ numIt, ansIt }, ri) => {
        if (!ansIt) return;
        let qn = null;
        if (numIt) qn = Number(numIt.str);
        else if (!anyNum && uniformRows) qn = ri + 1;
        if (qn === null) return;
        if (cells.has(qn)) {
          warnings.push(`${k + 1}번째 쌍 문${qn} 중복`);
          return;
        }
        cells.set(qn, cellValue(ansIt.str));
        allQns.add(qn);
      });
      return cells;
    });

    const qns = [...allQns].sort((a, b) => a - b);
    if (qns.length === 0) continue;
    perPair.forEach((cells, k) => {
      if (cells.size === 0) return;
      const header = normalizeSubjectName(
        headerByPair[k]
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((p) => p.str)
          .join(""),
      ).replace(/[<>①②③④⑤◉ㆍ]/g, ""); // "< ① 책형 >" 조각이 붙은 경우 정리
      columns.push({
        header,
        values: qns.map((q) => cells.get(q) ?? null),
        trackHint,
      });
    });
    if (columns.length > 0) tables.push({ columns, rowNumbers: qns, warnings });
  }
  return tables;
}

// ---- 레이아웃 D: 과목 섹션마다 "문항: 1~10 / 정답: …" 가로 줄무늬 (경찰 2014~2019) ----
function parseStripTables(items) {
  const stripHeads = items.filter((it) => it.str === "문항");
  if (stripHeads.length < 2) return [];
  const strips = [];
  for (const h of stripHeads) {
    const qItems = items
      .filter((it) => /^\d{1,3}$/.test(it.str) && Math.abs(it.y - h.y) <= 4 && it.x > h.x)
      .sort((a, b) => a.x - b.x);
    if (qItems.length < 2) continue;
    const ansHead = items.find(
      (it) =>
        it.str === "정답" && Math.abs(it.x - h.x) <= 12 && it.y < h.y - 2 && h.y - it.y < 40,
    );
    if (!ansHead) continue;
    const vItems = items
      .filter((it) => cellValue(it.str) !== null && Math.abs(it.y - ansHead.y) <= 4 && it.x > ansHead.x)
      .sort((a, b) => a.x - b.x);
    if (vItems.length === 0) continue;
    strips.push({ y: h.y, qItems, vItems });
  }
  if (strips.length === 0) return [];

  const titleCands = items.filter(
    (it) =>
      cellValue(it.str) === null &&
      !/^\d+$/.test(it.str) &&
      !["문항", "정답"].includes(it.str) &&
      !/정답표|시험|채용|공고|책형/.test(it.str) &&
      /[가-힣]{2,}/.test(it.str),
  );

  // 문항-값 정렬은 x 근접으로 맞춘다. 같은 과목 섹션이 한 페이지에 여러 개면
  // (책형별 반쪽 등) 문항 범위가 겹치는 순간 새 섹션으로 분리한다 — 서로 다른
  // 책형의 값이 한 배열에 섞이는 것을 막는다.
  const sections = []; // { name, map }
  for (const s of strips) {
    let title = null;
    for (const t of titleCands) {
      if (t.y <= s.y) continue;
      if (title === null || t.y < title.y) title = t;
    }
    const name = title
      ? normalizeSubjectName(title.str).replace(/[<>〈〉[\]]/g, "")
      : "";
    if (!name) continue;
    const qns = s.qItems.map((q) => Number(q.str));
    let target = null;
    for (const sec of sections) {
      if (sec.name === name && qns.every((q) => !sec.map.has(q))) {
        target = sec;
        break;
      }
    }
    if (!target) {
      target = { name, map: new Map() };
      sections.push(target);
    }
    const gap =
      s.qItems.length > 1
        ? (s.qItems[s.qItems.length - 1].x - s.qItems[0].x) / (s.qItems.length - 1)
        : 40;
    for (const q of s.qItems) {
      let best = null;
      for (const v of s.vItems) {
        const d = Math.abs(v.x - q.x);
        if (d <= gap / 2 && (best === null || d < Math.abs(best.x - q.x))) best = v;
      }
      if (best) target.map.set(Number(q.str), cellValue(best.str));
    }
  }

  const tables = [];
  for (const { name, map } of sections) {
    if (map.size < 5) continue;
    const qns = [...map.keys()].sort((a, b) => a - b);
    tables.push({
      columns: [{ header: name, values: qns.map((q) => map.get(q)) }],
      rowNumbers: qns,
      warnings: [],
    });
  }
  return tables;
}

// ---- 레이아웃 E: "<과목>" 아래 "1번 ④ 2번 ④ …" 인라인 쌍 (경찰 2020~) ----
function parseInlinePairTables(items) {
  const pairs = [];
  for (const it of items) {
    const m = it.str.match(COL_LABEL);
    if (!m) continue;
    const v = items.find(
      (o) =>
        cellValue(o.str) !== null &&
        Math.abs(o.y - it.y) <= 4 &&
        o.x > it.x &&
        o.x - (it.x + it.w) < 40,
    );
    if (v) pairs.push({ q: Number(m[1]), v: cellValue(v.str), y: it.y });
  }
  if (pairs.length < 10) return [];

  const titleCands = items.filter(
    (it) =>
      cellValue(it.str) === null &&
      !COL_LABEL.test(it.str) &&
      !/^\d+$/.test(it.str) &&
      /[가-힣]{2,}/.test(it.str) &&
      !/정답표|시험|채용|공고|책형|없음|이의|정답처리/.test(it.str),
  );
  // 같은 과목이 여러 번 나오면(책형별 섹션) 문항 번호가 겹치는 순간 새 섹션으로
  // 분리한다 — 서로 다른 책형의 값이 한 배열에 섞이는 것을 막는다.
  const sections = []; // { name, map }
  for (const p of pairs) {
    let title = null;
    for (const t of titleCands) {
      if (t.y <= p.y + 4) continue;
      if (title === null || t.y < title.y) title = t;
    }
    const name = title
      ? normalizeSubjectName(title.str).replace(/[<>〈〉[\]]/g, "")
      : "";
    if (!name) continue;
    let target = null;
    for (const sec of sections) {
      if (sec.name === name && !sec.map.has(p.q)) {
        target = sec;
        break;
      }
    }
    if (!target) {
      target = { name, map: new Map() };
      sections.push(target);
    }
    target.map.set(p.q, p.v);
  }

  const tables = [];
  for (const { name, map } of sections) {
    if (map.size < 5) continue;
    const qns = [...map.keys()].sort((a, b) => a - b);
    tables.push({
      columns: [{ header: name, values: qns.map((q) => map.get(q)) }],
      rowNumbers: qns,
      warnings: [],
    });
  }
  return tables;
}

// 헤더가 이 과목을 가리키는지 판정한다.
//  - 정확 일치가 1순위.
//  - 접미 일치: 페이지 제목이 헤더 밴드에 붙어 "…정답표(가)사회"처럼 온 경우.
//  - 접두(축약) 일치: PDF가 "행정법"처럼 줄인 경우 ("행정법총론"의 접두).
//  - 병기 확장: "한국사(상용한자 포함)"처럼 과목명 뒤에 부연이 붙은 경우.
//  - 포함 일치: 제목·책형 글자가 앞뒤로 붙은 경우 ("A한국사상용한자포함").
// 각 단계에서 다른 후보 과목명과 모호하면 매칭하지 않는다.
export function headerMatches(h, target, allTargets) {
  if (!h) return false;
  if (h === target) return true;
  if (h.endsWith(target)) {
    return !allTargets.some((n) => n !== target && h.endsWith(n) && n.length >= target.length);
  }
  if (h.length >= 2 && target.startsWith(h)) {
    return allTargets.filter((n) => n.startsWith(h)).length === 1;
  }
  if (h.startsWith(target)) {
    return !allTargets.some((n) => n !== target && h.startsWith(n) && n.length >= target.length);
  }
  if (h.includes(target)) {
    return !allTargets.some((n) => n !== target && h.includes(n));
  }
  return false;
}

// 파싱된 페이지들에서 이 과목의 후보 "정답 맵"(문항번호 → 값)을 모은다.
//  - 같은 페이지에서 문항 범위가 겹치지 않는 같은 과목 표들은 분할표로 보고 병합.
//    범위가 겹치면 직렬/책형별 표이므로 각각 후보로 남긴다.
//  - 다른 페이지끼리는 절대 병합하지 않는다 (책형이 다른 판일 수 있다).
//  - 값 없는 셀(전항정답 표기 등)은 빠진 채 반환 — 호출 쪽이 대조 제외로 센다.
//    1..wantLength 중 구멍이 3개 이상이거나 wantLength 초과 문항에 값이 있으면
//    이 과목의 열이 아니라고 보고 버린다.
//  - paper.level/track이 있으면 levelHint/trackHint가 어긋나는 열은 제외한다.
export function findSubjectColumns(pages, subjectName, allSubjectNames, wantLength, paper) {
  const target = normalizeSubjectName(subjectName);
  const allTargets = allSubjectNames.map(normalizeSubjectName);
  const trackOk = (hint) => {
    if (!hint || !paper?.track) return true;
    return paper.track.includes(hint) || hint.includes(paper.track);
  };
  const out = [];
  for (const pg of pages) {
    const groups = []; // { qns: Set, map: Map(qn→v), headers: [] }
    for (const t of pg.tables) {
      for (const c of t.columns) {
        if (!headerMatches(c.header, target, allTargets)) continue;
        if (c.levelHint && paper?.level && c.levelHint !== paper.level) continue;
        if (!trackOk(c.trackHint)) continue;
        const cellQns = t.rowNumbers;
        let merged = null;
        for (const g of groups) {
          if (cellQns.every((q) => !g.qns.has(q))) {
            merged = g;
            break;
          }
        }
        if (!merged) {
          merged = { qns: new Set(), map: new Map(), headers: [] };
          groups.push(merged);
        }
        cellQns.forEach((q, i) => {
          merged.qns.add(q);
          if (c.values[i] !== null) merged.map.set(q, c.values[i]);
        });
        merged.headers.push(c.header);
      }
    }
    for (const g of groups) {
      let holes = 0;
      for (let q = 1; q <= wantLength; q++) if (!g.map.has(q)) holes++;
      const overflow = [...g.map.keys()].some((q) => q > wantLength);
      if (holes > 2 || overflow) continue;
      out.push({ page: pg.pageNumber, map: g.map, header: g.headers.join("+"), holes });
    }
  }
  return out;
}

// PDF 버퍼 전체를 파싱한다. 반환: { pages: [{ pageNumber, tables }], hasText }
export async function parseAnswerPdf(pdfjs, buffer) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pages = [];
  let hasText = false;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      if (tc.items.length > 0) hasText = true;
      pages.push({ pageNumber: p, tables: parsePageItems(tc.items) });
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages, hasText };
}
