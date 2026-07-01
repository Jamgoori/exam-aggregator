// 사용법:
//   npm run bulk-upload -- --year 2025 --type 지방직 [--level 9급] [--round 1] [--dir uploads/incoming]
//
// uploads/incoming (기본값) 폴더 안에 있는 "과목명.pdf" 파일들을 읽어서,
// --year/--type/--level/--round 값과 함께 Supabase에 업로드하고 exam_papers에 기록한다.
// 성공한 파일은 uploads/incoming/_done/{year}-{type}(-{level})/ 로 이동된다.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

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

// 파일명이 subjects.name과 정확히 일치하지 않을 때를 위한 별칭
const SUBJECT_ALIASES = {
  행정법: "행정법총론",
  행정학: "행정학개론",
  국사: "한국사",
  헌법학: "헌법",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = Number(args.year);
  const examTypeName = args.type;
  const level = args.level ?? null;
  const round = args.round ? Number(args.round) : 1;
  const dir = args.dir ?? "uploads/incoming";

  if (!year || !examTypeName) {
    console.error(
      "사용법: npm run bulk-upload -- --year 2025 --type 지방직 [--level 9급] [--round 1] [--dir uploads/incoming]",
    );
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

  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("*");
  if (subjectsError) throw subjectsError;

  const { data: examTypes, error: examTypesError } = await supabase
    .from("exam_types")
    .select("*");
  if (examTypesError) throw examTypesError;

  const examType = examTypes.find((t) => t.name === examTypeName);
  if (!examType) {
    console.error(
      `시험 종류 "${examTypeName}"를 찾을 수 없습니다. (등록된 값: ${examTypes
        .map((t) => t.name)
        .join(", ")})`,
    );
    process.exit(1);
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`폴더를 찾을 수 없습니다: ${dir}`);
    process.exit(1);
  }

  const pdfFiles = entries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"),
  );

  if (pdfFiles.length === 0) {
    console.log(`${dir} 안에 PDF 파일이 없습니다.`);
    return;
  }

  const doneDir = path.join(
    dir,
    "_done",
    `${year}-${examTypeName}${level ? "-" + level : ""}`,
  );
  await mkdir(doneDir, { recursive: true });

  const skipped = [];
  let uploaded = 0;

  for (const entry of pdfFiles) {
    const filename = entry.name;
    // "국어(지방9급)-D.pdf" -> "국어" : 괄호 설명과 문제책형(-A/-B/-C/-D) 접미사를 제거
    const baseName = filename
      .replace(/\.pdf$/i, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/-[A-Za-z]$/, "")
      .trim();
    const subjectName = SUBJECT_ALIASES[baseName] ?? baseName;
    const subject = subjects.find((s) => s.name === subjectName);

    if (!subject) {
      skipped.push(`${filename} (과목 "${subjectName}"을 찾을 수 없음)`);
      continue;
    }

    const filePath = path.join(dir, filename);
    const [fileBuffer, fileStat] = await Promise.all([
      readFile(filePath),
      stat(filePath),
    ]);
    const storagePath = `${year}/${randomUUID()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("exam-papers")
      .upload(storagePath, fileBuffer, { contentType: "application/pdf" });

    if (uploadError) {
      skipped.push(`${filename} (업로드 실패: ${uploadError.message})`);
      continue;
    }

    const title = `${year} ${examTypeName}${level ? " " + level : ""} ${subject.name}`;

    const { error: insertError } = await supabase.from("exam_papers").insert({
      subject_id: subject.id,
      exam_type_id: examType.id,
      year,
      round,
      level,
      title,
      file_path: storagePath,
      file_name: filename,
      file_size: fileStat.size,
    });

    if (insertError) {
      await supabase.storage.from("exam-papers").remove([storagePath]);
      skipped.push(`${filename} (저장 실패: ${insertError.message})`);
      continue;
    }

    await rename(filePath, path.join(doneDir, filename));
    uploaded++;
    console.log(`완료: ${title}`);
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
