// 사용법:
//   npm run split-fire -- --file "TEST/소방 공채/2024/문제.pdf" --out uploads/incoming/2024-소방 [--dry]
//   npm run split-fire -- --dir "TEST/소방 공채/2024" --out uploads/incoming/2024-소방 [--dry]
//
// 소방공무원 공채·경채 통합 문제지를 과목별로 자른다. 소방 조판은 과목 첫 쪽에만
// 【 소방학개론 】처럼 대괄호 머리글이 박히고 나머지 쪽에는 아무 표시가 없어서,
// 매 쪽 머리글을 쓰는 split-by-subject-header도, 표지 목차를 쓰는 split-by-toc도
// 그대로는 못 쓴다(소방 표지는 "제1과목 소방학개론 1~6"처럼 쪽번호 범위만 준다).
//
// 경계는 두 경로로 잡고 서로 대조한다.
//   1) 본문 【 과목명 】 머리글 (2018~2025 전 연도, 2026 경채)
//   2) 표지의 "제N과목 과목명 시작~끝" 쪽범위 + 본문 시작 쪽 오프셋 (2023~2026)
// 둘 다 있으면 반드시 일치해야 하고, 어긋나면 그 파일은 건너뛴다. 2026 공채처럼
// 머리글이 아예 없는 판본은 2)만으로 자른다.
//
// 자른 결과는 "과목명.pdf"로 저장되어 scripts/bulk-upload.mjs가 그대로 집어간다.
// --dry로 먼저 돌려 과목/페이지 범위/경고를 확인할 것.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// 소방 공채·경채·간부후보·승진시험에 나오는 과목 전량. 여기에 없는 이름은
// 머리글로 인정하지 않는다 (본문 【보 기】·【별표 4】나 표지의 【인문사회계열 :
// 필수과목】이 과목으로 오인되는 걸 막는다).
const FIRE_SUBJECTS = [
  // 공채·경채
  "국어",
  "한국사",
  "영어",
  "생활영어",
  "소방학개론",
  "행정법총론",
  "소방관계법규",
  "사회",
  "과학",
  "수학",
  "응급처치학개론",
  "화학개론",
  "컴퓨터일반",
  // 간부후보생 (필수: 헌법·한국사·행정법/자연과학개론, 선택: 계열별 5과목)
  "헌법",
  "행정법",
  "행정학",
  "민법총칙",
  "형사소송법",
  "경제학",
  "자연과학개론",
  "물리학개론",
  "건축공학개론",
  "전기공학개론",
  // 승진시험 (소방교·소방장·소방위)
  "소방법령Ⅰ",
  "소방법령Ⅱ",
  "소방법령Ⅲ",
  "소방법령Ⅳ",
  "소방전술",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const squeeze = (s) => s.replace(/\s+/g, "");

async function readPageTexts(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    texts.push(tc.items.map((it) => it.str).join("").replace(/\s+/g, " ").trim());
  }
  return texts;
}

// 저작권 워터마크가 글자마다 겹쳐 찍힌 판본(간부후보 2019 인문)은 텍스트 추출이
// "행정학행정학행정학행정학"처럼 같은 이름을 그대로 반복해 낸다. 반복이면 한 벌만 남긴다.
function undupe(name) {
  for (let len = 1; len <= name.length / 2; len++) {
    if (name.length % len !== 0) continue;
    const unit = name.slice(0, len);
    if (unit.repeat(name.length / len) === name) return unit;
  }
  return name;
}

// 본문 【 과목명 】 머리글로 과목 시작 페이지(1-base)를 찾는다.
function findHeaderStarts(pageTexts) {
  const starts = [];
  pageTexts.forEach((text, idx) => {
    for (const m of text.matchAll(/【\s*([^】]{2,40}?)\s*】/g)) {
      const name = undupe(squeeze(m[1]).replace(/^【+/, ""));
      if (FIRE_SUBJECTS.includes(name) && !starts.some((s) => s.subject === name)) {
        starts.push({ subject: name, page: idx + 1 });
      }
    }
  });
  return starts.sort((a, b) => a.page - b.page);
}

// 표지의 "제1과목 소방학개론 1~6" 쪽범위. 2026 공채처럼 텍스트 추출이 꼬여
// "제 과목 소방학개론1 1~6"으로 나오는 판본이 있어 과목명 뒤 숫자는 흘려보낸다.
function findCoverRanges(pageTexts) {
  const cover = pageTexts.slice(0, 3).join(" ");
  const names = FIRE_SUBJECTS.join("|");
  // 과목명 뒤에 "제N과목"의 N이 붙어 나오는 판본이 있어 한 자리 숫자 + 공백이면
  // 흘려보낸다. "행정법총론 13~19"의 1을 과목 번호로 잘못 먹지 않도록 뒤 공백을 요구한다.
  const re = new RegExp(`(${names})(?:\\s*\\d\\s)?\\s*(\\d{1,2})\\s*[~∼]\\s*(\\d{1,3})`, "g");
  const ranges = [];
  for (const m of cover.matchAll(re)) {
    if (ranges.some((r) => r.subject === m[1])) continue;
    ranges.push({ subject: m[1], from: Number(m[2]), to: Number(m[3]) });
  }
  return ranges;
}

// 본문 쪽번호 1쪽("1 / 24", "A - 1 / 36")이 찍힌 PDF 페이지. 표지·안내쪽 수만큼
// 표지 쪽범위와 어긋나므로 오프셋 계산에 쓴다.
function findBodyStart(pageTexts) {
  for (let i = 0; i < pageTexts.length; i++) {
    if (/^(?:[A-Z]\s*-\s*)?1\s*\/\s*\d+/.test(pageTexts[i])) return i + 1;
  }
  return null;
}

function lastNonBlankPage(pageTexts, from, to) {
  for (let p = to; p >= from; p--) {
    if (pageTexts[p - 1].length > 0) return p;
  }
  return to;
}

// 시작 페이지 목록 -> {subject, from, to} 구간. 마지막 과목은 PDF 끝까지 가되
// 뒤에 붙은 빈 쪽은 떼어낸다.
function toSections(starts, pageTexts) {
  return starts.map((s, i) => {
    const rawTo = i + 1 < starts.length ? starts[i + 1].page - 1 : pageTexts.length;
    return {
      subject: s.subject,
      from: s.page,
      to: lastNonBlankPage(pageTexts, s.page, rawTo),
    };
  });
}

function analyze(pageTexts) {
  const warnings = [];
  const headerStarts = findHeaderStarts(pageTexts);
  const coverRanges = findCoverRanges(pageTexts);
  const bodyStart = findBodyStart(pageTexts);

  let sections = null;
  if (headerStarts.length > 0) {
    sections = toSections(headerStarts, pageTexts);
  } else if (coverRanges.length > 0 && bodyStart != null) {
    const offset = bodyStart - 1;
    sections = coverRanges.map((r) => ({
      subject: r.subject,
      from: r.from + offset,
      to: lastNonBlankPage(pageTexts, r.from + offset, Math.min(r.to + offset, pageTexts.length)),
    }));
    warnings.push("본문 머리글이 없어 표지 쪽범위로만 잘랐습니다 - 결과를 눈으로 확인할 것");
  } else {
    warnings.push("과목 경계를 찾지 못했습니다 (머리글·표지 쪽범위 모두 없음)");
    return { sections: null, warnings };
  }

  // 두 경로가 모두 있으면 교차 검증한다. 어긋나면 자르지 않는다.
  if (headerStarts.length > 0 && coverRanges.length > 0 && bodyStart != null) {
    const offset = bodyStart - 1;
    for (const r of coverRanges) {
      const hit = headerStarts.find((h) => h.subject === r.subject);
      if (!hit) {
        warnings.push(`표지에는 있는데 본문 머리글이 없는 과목: ${r.subject}`);
      } else if (hit.page !== r.from + offset) {
        warnings.push(
          `${r.subject}: 머리글 p${hit.page} vs 표지 p${r.from + offset} 불일치`,
        );
      }
    }
    for (const h of headerStarts) {
      if (!coverRanges.some((r) => r.subject === h.subject)) {
        warnings.push(`본문에는 있는데 표지에 없는 과목: ${h.subject}`);
      }
    }
  }

  for (const s of sections) {
    if (s.to < s.from) warnings.push(`${s.subject}: 페이지 범위가 뒤집혔습니다`);
    // 소방 과목은 20~42문항이라 한 과목이 1쪽이면 잘림이 의심된다.
    if (s.to - s.from + 1 < 2) warnings.push(`${s.subject}: ${s.to - s.from + 1}쪽뿐입니다`);
  }

  return { sections, warnings };
}

async function writeSections(buffer, sections, outDir) {
  const src = await PDFDocument.load(buffer);
  await mkdir(outDir, { recursive: true });
  for (const s of sections) {
    const out = await PDFDocument.create();
    const indices = [];
    for (let p = s.from; p <= s.to; p++) indices.push(p - 1);
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    await writeFile(path.join(outDir, `${s.subject}.pdf`), bytes);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out;
  if ((!args.file && !args.dir) || !outDir) {
    console.error(
      '사용법: npm run split-fire -- --file "문제.pdf" --out uploads/incoming/2024-소방 [--dry]',
    );
    process.exit(1);
  }

  let files;
  if (args.file) {
    files = [args.file];
  } else {
    const entries = await readdir(args.dir, { withFileTypes: true });
    files = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.toLowerCase().endsWith(".pdf") &&
          !/정답|답안/.test(e.name) &&
          // DB는 전 시험 A책형 기준이라 B형 이후 판은 대상에서 뺀다
          // (간부후보 2019~2021은 A형·B형 두 벌이 같이 배포된다).
          !/[B-Z]형/.test(e.name),
      )
      .map((e) => path.join(args.dir, e.name));
  }

  // 같은 폴더의 여러 문제지가 같은 과목을 담고 있을 수 있다 (간부후보: 인문·자연
  // 두 벌이 헌법·한국사·소방학개론을 공통으로 싣는다). 먼저 전부 분석해 두고,
  // 같은 과목이 두 번 나오면 본문 텍스트를 대조해 같을 때만 한 벌로 합친다.
  const taken = new Map(); // 과목명 → { file, text }
  const plans = [];
  for (const file of files) {
    const buffer = await readFile(file);
    const pageTexts = await readPageTexts(buffer);
    const { sections, warnings } = analyze(pageTexts);

    console.log(`\n[${path.basename(file)}] ${pageTexts.length}쪽`);
    if (sections) {
      for (const s of sections) {
        console.log(`  ${s.subject}: p${s.from}~${s.to} (${s.to - s.from + 1}쪽)`);
      }
    }
    warnings.forEach((w) => console.log(`  ! ${w}`));

    if (!sections) continue;
    // 경고가 하나라도 있으면(쪽범위 전용 판본 안내는 제외) 반쪽 분리본을 만들지 않는다.
    const blocking = warnings.filter((w) => !w.startsWith("본문 머리글이 없어"));
    if (blocking.length > 0) {
      console.log("  -> 경고가 있어 건너뜁니다.");
      continue;
    }

    const keep = [];
    for (const s of sections) {
      // 대조 전에 쪽마다 붙는 러닝 헤더("인문사회계열 - 필수1 / 24")를 떼어낸다.
      // 같은 문제지라도 계열 표기와 총 쪽수가 달라 그대로 비교하면 항상 어긋난다.
      const text = pageTexts
        .slice(s.from - 1, s.to)
        .map((t) => t.replace(/^.*?\d+\s*\/\s*\d+/, "").replace(/\s+/g, ""))
        .join("\n");
      const prev = taken.get(s.subject);
      if (!prev) {
        taken.set(s.subject, { file: path.basename(file), text });
        keep.push(s);
      } else if (prev.text === text) {
        console.log(`  = ${s.subject}: [${prev.file}]와 같은 문제지 - 한 벌만 남김`);
      } else {
        console.log(
          `  ! ${s.subject}: [${prev.file}]와 내용이 달라 건너뜁니다 - 사람이 확인할 것`,
        );
      }
    }
    plans.push({ buffer, sections: keep });
  }

  if (args.dry) return;
  let saved = 0;
  for (const plan of plans) {
    if (plan.sections.length === 0) continue;
    await writeSections(plan.buffer, plan.sections, outDir);
    saved += plan.sections.length;
  }
  console.log(`\n-> ${outDir}에 ${saved}개 저장`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
