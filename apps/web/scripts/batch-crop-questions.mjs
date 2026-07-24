// 사용법: npm run batch-crop-questions -- --exam-type 지방직 --level 9급 [--dry-run] [--concurrency 2] [--limit 5]
//
// crop-question-images.mjs를 문제지 하나씩 손으로 돌리는 대신, 시험유형/급수로
// 대상을 걸러서 아직 크롭 안 된(question_images가 없는) 문제지를 한 번에 순회한다.
// 문항별 크롭은 그 자체로 여러 이미지를 업로드하는 무거운 작업이라, 레이아웃이
// 다른 문제지가 섞여 있을 위험(문제 번호 중복 등)에 대비해 한 문제지 실패가 나머지
// 진행을 막지 않게 하고, 끝에 성공/실패/주의 목록을 모아 보여준다.

import { createClient } from "@supabase/supabase-js";
import { extractQuestionsFromPdf } from "./crop-question-images.mjs";

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

async function fetchAllRows(supabase, table, columns, build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function cropOnePaper(supabase, paper, { dryRun, scale }) {
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(paper.file_path);
  if (downloadError || !fileBlob) {
    return { paper, error: `PDF 다운로드 실패: ${downloadError?.message}` };
  }
  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());

  let cropped;
  try {
    cropped = await extractQuestionsFromPdf(pdfBuffer, { scale, expectedCount: paper.question_count });
  } catch (err) {
    return { paper, error: err.message };
  }

  if (cropped.length === 0) {
    return { paper, error: "문제 번호 마커를 하나도 못 찾음 (레이아웃 불일치 가능성)" };
  }

  const expected = paper.question_count;
  const warning =
    expected && cropped.length !== expected
      ? `question_count=${expected}인데 ${cropped.length}개만 인식됨`
      : null;

  if (dryRun) {
    return { paper, cropped: cropped.length, warning, dryRun: true };
  }

  // 개수가 안 맞으면 레이아웃을 잘못 읽었다는 뜻이라(이번 세션에서 실제로 겪은
  // 사례 전부 이랬다 — 정규식 버그, 1단 레이아웃 등), 절반만 맞는 이미지를
  // 올리느니 아예 안 올리고 수동 확인 대상으로 돌린다.
  if (warning) {
    return { paper, error: warning };
  }

  // 세트문제(공통지문 병합)는 그룹의 첫 번호 경로 하나에만 실제로 업로드하고,
  // 나머지 번호들은 question_images.image_path를 그 경로로 같이 가리키게 한다.
  const uploadedPaths = new Set();
  let uploaded = 0;
  const uploadErrors = [];
  for (const c of cropped) {
    const groupStart = Math.min(...(c.groupNumbers ?? [c.number]));
    const storagePath = `questions/${paper.id}/${String(groupStart).padStart(2, "0")}.webp`;

    if (!uploadedPaths.has(storagePath)) {
      const { error: uploadError } = await supabase.storage
        .from("exam-papers")
        .upload(storagePath, c.image, { contentType: "image/webp", upsert: true });
      if (uploadError) {
        uploadErrors.push(`${c.number}번 업로드 실패: ${uploadError.message}`);
        continue;
      }
      uploadedPaths.add(storagePath);
    }

    const { data: questionRow, error: questionError } = await supabase
      .from("questions")
      .upsert(
        { paper_id: paper.id, question_number: c.number, choice_count: paper.choice_count ?? 4 },
        { onConflict: "paper_id,question_number" },
      )
      .select("id")
      .single();
    if (questionError || !questionRow) {
      uploadErrors.push(`${c.number}번 questions upsert 실패: ${questionError?.message}`);
      continue;
    }

    const { error: imageError } = await supabase
      .from("question_images")
      .upsert(
        { question_id: questionRow.id, order_index: 0, image_path: storagePath },
        { onConflict: "question_id,order_index" },
      );
    if (imageError) {
      uploadErrors.push(`${c.number}번 question_images upsert 실패: ${imageError.message}`);
      continue;
    }

    // 예전 실행이 이 번호 몫으로 올려뒀던 개별 파일이 있다면(이번에 세트 병합으로
    // 공유 경로를 쓰게 된 경우) 지워서 고아 오브젝트를 남기지 않는다.
    if (c.groupNumbers && c.number !== groupStart) {
      await supabase.storage
        .from("exam-papers")
        .remove([`questions/${paper.id}/${String(c.number).padStart(2, "0")}.webp`]);
    }

    uploaded++;
  }

  return { paper, cropped: cropped.length, uploaded, warning, uploadErrors };
}

// 여러 문제지를 concurrency만큼 동시에 처리하는 간단한 워커 풀.
async function runPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;
  let done = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
      done++;
      const r = results[index];
      const label = `${r.paper.year}년 ${r.paper.round}회 ${r.paper.title}`;
      if (r.error) {
        console.error(`[${done}/${items.length}] 실패: ${label} - ${r.error}`);
      } else {
        console.log(
          `[${done}/${items.length}] 완료: ${label} - ${r.uploaded ?? r.cropped}/${r.cropped}개${r.warning ? ` (주의: ${r.warning})` : ""}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const examTypeName = args["exam-type"];
  const level = args.level;
  const dryRun = Boolean(args["dry-run"]);
  const concurrency = args.concurrency ? Number(args.concurrency) : 2;
  const limit = args.limit ? Number(args.limit) : undefined;
  const scale = args.scale ? Number(args.scale) : 3;
  const force = Boolean(args.force);

  // 급수(level)가 없는 시험(경찰 공채/간부후보 등)은 --track으로 대상을 좁힌다.
  // 둘 다 없으면 그 시험유형 전체가 대상이 되어 의도치 않게 크게 도는 걸 막는다.
  const track = args.track;
  if (!examTypeName || (!level && !track)) {
    console.error(
      "사용법: npm run batch-crop-questions -- --exam-type <시험유형명> (--level <급수> | --track <직류>) [--dry-run] [--concurrency 2] [--limit N] [--force]",
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: examType, error: examTypeError } = await supabase
    .from("exam_types")
    .select("id, name")
    .eq("name", examTypeName)
    .single();
  if (examTypeError || !examType) {
    console.error(`시험유형을 찾을 수 없습니다: ${examTypeName}`, examTypeError?.message);
    process.exit(1);
  }

  const papers = await fetchAllRows(
    supabase,
    "exam_papers",
    "id, title, year, round, level, file_path, question_count, choice_count",
    (q) => {
      let built = q.eq("exam_type_id", examType.id);
      if (level) built = built.eq("level", level);
      if (track) built = built.eq("track", track);
      return built;
    },
  );

  const questionRows = await fetchAllRows(supabase, "questions", "id, paper_id");
  const questionIdToPaperId = new Map(questionRows.map((r) => [r.id, r.paper_id]));
  const imageRows = await fetchAllRows(supabase, "question_images", "question_id");
  const paperIdsAlreadyCropped = new Set(
    imageRows.map((r) => questionIdToPaperId.get(r.question_id)).filter(Boolean),
  );

  let targets = force ? papers : papers.filter((p) => !paperIdsAlreadyCropped.has(p.id));
  targets.sort((a, b) => a.year - b.year || a.round - b.round);
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `${examTypeName} ${level ?? track}: 전체 ${papers.length}개 중 ${paperIdsAlreadyCropped.size}개 이미 크롭됨, ${targets.length}개 처리 대상${force ? " (--force: 이미 크롭된 것도 다시)" : ""}${dryRun ? " (dry-run)" : ""} (동시성 ${concurrency})\n`,
  );

  if (targets.length === 0) {
    console.log("처리할 문제지가 없습니다.");
    return;
  }

  const results = await runPool(targets, concurrency, (paper) =>
    cropOnePaper(supabase, paper, { dryRun, scale }),
  );

  const errors = results.filter((r) => r.error);
  const warnings = results.filter((r) => !r.error && r.warning);
  const ok = results.filter((r) => !r.error && !r.warning);

  console.log(`\n=== 요약 ===`);
  console.log(`성공: ${ok.length}개, 주의: ${warnings.length}개, 실패: ${errors.length}개 (총 ${targets.length}개)`);

  if (warnings.length > 0) {
    console.log(`\n[주의 - 문항 수 불일치, 확인 필요]`);
    for (const r of warnings) {
      console.log(`  - ${r.paper.year}년 ${r.paper.round}회 ${r.paper.title} (id=${r.paper.id}): ${r.warning}`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n[실패 - 레이아웃 인식 실패 등, 수동 확인 필요]`);
    for (const r of errors) {
      console.log(`  - ${r.paper.year}년 ${r.paper.round}회 ${r.paper.title} (id=${r.paper.id}): ${r.error}`);
    }
  }
  if (dryRun) {
    console.log("\ndry-run이라 Storage/DB는 건드리지 않았습니다.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
