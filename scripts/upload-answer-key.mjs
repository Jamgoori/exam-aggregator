// 사용법: npm run upload-answer [-- --dir uploads/incoming]
//
// --dir (기본 uploads/incoming) 폴더에서 파일명에 "정답"이 들어간 PDF를 찾아,
// 연도/시험종류/급수를 파일명에서 자동으로 추출해 answer_keys 테이블에 업로드한다.
// 과목별 exam_papers와 달리 (시험종류+연도+급수+회차) 조합당 1개만 저장되며,
// 이미 있으면 upsert로 덮어쓴다. 성공한 파일은 --dir/_done/answers/ 로 이동된다.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { optimizePdf } from "./lib/optimize-pdf.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// 파일명에 포함된 키워드로 exam_types.name을 추론
const EXAM_TYPE_KEYWORDS = {
  국가공무원: "국가직",
  지방공무원: "지방직",
  국가직: "국가직",
  지방직: "지방직",
  서울시: "서울시",
  경찰공무원: "경찰",
  소방공무원: "소방",
  해양경찰: "해경",
  국회: "국회직",
  법원: "법원직",
  기상: "기상직",
  지역인재: "지역인재",
  계리: "계리직",
  간호: "간호직",
  // "해양경찰"이 먼저 매칭되도록 일반 "경찰"은 맨 뒤에 둔다.
  경찰: "경찰",
};

// 같은 연도/급수를 공유하는 특수모집 분야 키워드 -> exam_papers.track과 동일한 값으로 매핑
const TRACK_KEYWORDS = {
  근로감독: "근로감독 및 산업안전분야",
  // 경찰 간부후보(경위 공채)는 같은 해 순경 공채와 정답표가 별개다. track을 안 붙이면
  // (exam_type_id, year, level, round, track) unique upsert에서 서로 덮어쓴다.
  간부후보: "간부후보",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir ?? "uploads/incoming";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: examTypes, error: examTypesError } = await supabase
    .from("exam_types")
    .select("*");
  if (examTypesError) throw examTypesError;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`폴더를 찾을 수 없습니다: ${dir}`);
    process.exit(1);
  }

  const candidates = entries.filter(
    (e) =>
      e.isFile() &&
      e.name.toLowerCase().endsWith(".pdf") &&
      e.name.includes("정답"),
  );

  if (candidates.length === 0) {
    console.log(`${dir} 안에 "정답"이 포함된 PDF 파일이 없습니다.`);
    return;
  }

  const doneDir = path.join(dir, "_done", "answers");
  await mkdir(doneDir, { recursive: true });

  const skipped = [];
  let uploaded = 0;

  for (const entry of candidates) {
    const filename = entry.name;

    const yearMatch = filename.match(/20\d{2}/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    const level = filename.includes("9급")
      ? "9급"
      : filename.includes("8급")
        ? "8급"
        : filename.includes("7급")
          ? "7급"
          : filename.includes("5급")
            ? "5급"
            : null;
    // 2017 국가직 9급 추가선발(2차모집), 7급 1차/2차 시험처럼 회차가 나뉘는 경우 round로 구분
    const round = filename.includes("추가") || filename.includes("2차") ? 2 : 1;

    let track = null;
    for (const [keyword, mapped] of Object.entries(TRACK_KEYWORDS)) {
      if (filename.includes(keyword)) {
        track = mapped;
        break;
      }
    }

    let examTypeName = null;
    for (const [keyword, mapped] of Object.entries(EXAM_TYPE_KEYWORDS)) {
      if (filename.includes(keyword)) {
        examTypeName = mapped;
        break;
      }
    }
    const examType = examTypes.find((t) => t.name === examTypeName);

    if (!year || !examType) {
      skipped.push(
        `${filename} (연도 또는 시험종류를 인식하지 못함: year=${year}, type=${examTypeName})`,
      );
      continue;
    }

    const filePath = path.join(dir, filename);
    const rawBuffer = await readFile(filePath);
    const fileBuffer = await optimizePdf(rawBuffer);
    const storagePath = `answers/${year}/${randomUUID()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("exam-papers")
      .upload(storagePath, fileBuffer, { contentType: "application/pdf" });

    if (uploadError) {
      skipped.push(`${filename} (업로드 실패: ${uploadError.message})`);
      continue;
    }

    const { error: upsertError } = await supabase
      .from("answer_keys")
      .upsert(
        {
          exam_type_id: examType.id,
          year,
          level,
          round,
          track,
          file_path: storagePath,
          file_name: filename,
          file_size: fileBuffer.byteLength,
        },
        { onConflict: "exam_type_id,year,level,round,track" },
      );

    if (upsertError) {
      await supabase.storage.from("exam-papers").remove([storagePath]);
      skipped.push(`${filename} (저장 실패: ${upsertError.message})`);
      continue;
    }

    await rename(filePath, path.join(doneDir, filename));
    uploaded++;
    console.log(
      `완료: ${year} ${examType.name}${level ? " " + level : ""}${track ? ` (${track})` : ""} 정답${round > 1 ? ` (${round}회차/추가선발)` : ""}`,
    );
  }

  console.log(`\n총 ${uploaded}개 업로드 완료.`);
  if (skipped.length > 0) {
    console.log(`건너뜀 (${skipped.length}개):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
