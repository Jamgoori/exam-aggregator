// 사용법: node scripts/next-explanation-chunk.mjs [--target-size 10] [--chunks N] [--reverse]
//
// explanation_batch_priority 순서대로, question_explanations에 아직 없는 문항이
// 남아있는 첫 문제지를 찾아서 다음에 처리할 청크(문항 목록 + 이미지 URL)를 JSON으로
// stdout에 출력한다. 세트문제(같은 문항이 여러 이미지에 이어지는 경우는 그렇다 치고,
// 여기서 말하는 "세트"는 서로 다른 문항이 같은 이미지를 공유하는 경우 — 크롭 스크립트가
// 공통지문형 세트문제를 이렇게 저장한다)는 절대 청크 경계에서 쪼개지 않는다: target-size를
// 넘기더라도 세트 끝까지 포함해서 담는다.
//
// --chunks N: 청크를 한 번의 호출로 최대 N개까지 스냅샷으로 잘라서
//   { done, chunks: [{ paper, questions }, ...] } 형태로 출력한다 (병렬 처리용).
//   소진 시에는 { done: true, reason, chunks: [] } — chunks 키는 multi 모드에서 항상 있다.
//   주의: 이 스냅샷은 "같은 호출 안"의 청크끼리만 겹치지 않음을 보장한다. 저장이 끝나기
//   전에 다시 호출하면(같은 세션이든 다른 세션이든) 아직 저장 안 된 문항이 다시 배정된다.
//   호출 규약은 "배치 하나를 전부 저장한 뒤에만 다음 호출" — 세션 겹침 방지는 여전히
//   루틴 쪽 시간 제한 규칙이 담당한다.
//   청크는 문제지 경계를 넘지 않으며, 한 문제지의 잔여 문항이 target-size보다 적으면
//   그만큼만 담긴 작은 청크가 된다. 플래그가 없으면 기존과 완전히 동일한 단일 청크
//   형식({ done, paper, questions })을 출력한다 — 구버전 호출부와의 호환 유지.
// --reverse: 처리 목록을 반대쪽 끝에서부터 순회한다 (우선순위·문제지는 DB 정렬 방향을
//   반전, 문제지 안에서는 청크 단위로 끝에서부터). 청크 경계 자체는 방향과 무관하게
//   항상 순방향 기준으로 잘라 두 방향이 같은 분할을 보게 한다 — 중간에서 수렴할 때
//   경계가 어긋나 겹치는 일을 막기 위함. 세트 경계 규칙은 동일하게 지킨다.
//
// 플래그는 공백 구분 값만 지원한다 (--chunks 3). --chunks=3 같은 = 문법이나 알 수 없는
// 플래그, 값이 붙은 --reverse는 조용히 오동작하는 대신 즉시 에러로 종료한다.
//
// EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD로 로그인해서 실행하므로, 이 스크립트가
// 쓸 수 있는 권한은 공개 읽기 + explanation_batch_priority 조회(봇 전용)뿐이다. 정답
// 자체는 이 스크립트에서 전혀 다루지 않는다(정답 대조는 save-explanations.mjs에서
// verify_question_answer()로만 한다).

import { createClient } from "@supabase/supabase-js";

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

// pending 목록을 세트 경계를 지키며 청크들로 자른다. 각 청크는 targetSize를 채우되,
// 세트 중간이면 세트 끝까지 포함해서 넘긴다 (기존 단일 청크 로직의 일반화).
function cutChunks(pending, targetSize) {
  const chunks = [];
  let current = [];
  for (let i = 0; i < pending.length; i++) {
    current.push(pending[i]);
    if (current.length >= targetSize) {
      const next = pending[i + 1];
      if (next && next.set_key === pending[i].set_key) {
        continue; // 세트 중간이면 target-size를 넘기더라도 세트 끝까지 포함
      }
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 무인 루틴이 호출하는 스크립트라서, 잘못 쓴 플래그가 조용히 다른 동작(순방향/단일
  // 청크)으로 굴러가면 겹침 사고로 이어진다. 애매한 입력은 전부 즉시 에러.
  const knownFlags = new Set(["target-size", "chunks", "reverse"]);
  for (const key of Object.keys(args)) {
    if (!knownFlags.has(key)) {
      console.error(
        `알 수 없는 플래그: --${key} (지원: --target-size N, --chunks N, --reverse / = 문법 미지원)`,
      );
      process.exit(1);
    }
  }
  const reverse = "reverse" in args;
  if (reverse && args["reverse"] !== true) {
    console.error(
      `--reverse는 값을 받지 않습니다 (받은 값: ${JSON.stringify(args["reverse"])}). 방향이 조용히 바뀌는 것을 막기 위해 종료합니다.`,
    );
    process.exit(1);
  }
  // --chunks가 명시된 경우에만 다중 청크 형식으로 출력한다 (미지정 시 기존 형식 유지)
  const multi = "chunks" in args;
  let maxChunks = 1;
  if (multi) {
    if (typeof args["chunks"] !== "string" || !/^\d+$/.test(args["chunks"])) {
      console.error("--chunks는 정수 값이 필요합니다 (예: --chunks 3).");
      process.exit(1);
    }
    maxChunks = Number(args["chunks"]);
    if (maxChunks < 1 || maxChunks > 10) {
      console.error("--chunks는 1~10 사이의 정수여야 합니다.");
      process.exit(1);
    }
  }
  const targetSize = Number(args["target-size"] ?? 10);
  if (!Number.isInteger(targetSize) || targetSize < 1) {
    console.error("--target-size는 1 이상의 정수여야 합니다.");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;

  if (!supabaseUrl || !publishableKey || !botEmail || !botPassword) {
    console.error(
      "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPLANATION_BOT_EMAIL, EXPLANATION_BOT_PASSWORD",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  const done = (reason) => {
    // multi 모드에서는 소진 시에도 chunks 키를 항상 포함해 출력 형태를 일정하게 유지한다
    if (multi) console.log(JSON.stringify({ done: true, reason, chunks: [] }));
    else console.log(JSON.stringify({ done: true, reason }));
  };

  // 순방향과 역방향이 정확히 서로의 거울이 되도록, 정렬은 DB에서 방향만 반전한다.
  // priority 동률일 때도 두 방향의 순회 순서가 어긋나지 않게 tiebreaker를 명시한다.
  const { data: priorities, error: priorityError } = await supabase
    .from("explanation_batch_priority")
    .select("exam_type_id, level, priority")
    .order("priority", { ascending: !reverse })
    .order("exam_type_id", { ascending: !reverse })
    .order("level", { ascending: !reverse });
  if (priorityError) {
    console.error(`우선순위 조회 실패: ${priorityError.message}`);
    process.exit(1);
  }
  if (!priorities || priorities.length === 0) {
    done("explanation_batch_priority가 비어있음");
    return;
  }

  // 특정 과목(외국어 제2외국어, 수학, 과학 등)은 해설 생성 대상에서 제외한다 —
  // explanation_excluded_subjects에 등록된 subject_id를 가진 문제지는 통째로 건너뛴다.
  const { data: excluded, error: excludedError } = await supabase
    .from("explanation_excluded_subjects")
    .select("subject_id");
  if (excludedError) {
    console.error(`제외 과목 조회 실패: ${excludedError.message}`);
    process.exit(1);
  }
  const excludedSubjectIds = new Set((excluded ?? []).map((e) => e.subject_id));

  const collected = []; // { paper, questions } 단위로 최대 maxChunks개 수집
  let truncatedBy = null; // 수집 도중 조회 오류가 나도 이미 수집한 청크는 살려서 출력

  outer: for (const { exam_type_id, level } of priorities) {
    const { data: papers, error: papersError } = await supabase
      .from("exam_papers")
      .select("id, title, year, level, subject_id")
      .eq("exam_type_id", exam_type_id)
      .eq("level", level)
      .order("year", { ascending: !reverse })
      .order("id", { ascending: !reverse });
    if (papersError) {
      if (collected.length > 0) {
        truncatedBy = `문제지 조회 실패: ${papersError.message}`;
        break;
      }
      console.error(`문제지 조회 실패: ${papersError.message}`);
      process.exit(1);
    }

    for (const paper of papers ?? []) {
      if (excludedSubjectIds.has(paper.subject_id)) continue;
      const { data: questions, error: questionsError } = await supabase
        .from("questions")
        .select("id, question_number, question_images(image_path, order_index)")
        .eq("paper_id", paper.id)
        .order("question_number", { ascending: true });
      if (questionsError) {
        if (collected.length > 0) {
          truncatedBy = `문항 조회 실패 (paper ${paper.id}): ${questionsError.message}`;
          break outer;
        }
        console.error(`문항 조회 실패 (paper ${paper.id}): ${questionsError.message}`);
        process.exit(1);
      }
      if (!questions || questions.length === 0) continue;

      const questionIds = questions.map((q) => q.id);
      const { data: existing, error: existingError } = await supabase
        .from("question_explanations")
        .select("question_id")
        .in("question_id", questionIds);
      if (existingError) {
        if (collected.length > 0) {
          truncatedBy = `기존 해설 조회 실패: ${existingError.message}`;
          break outer;
        }
        console.error(`기존 해설 조회 실패: ${existingError.message}`);
        process.exit(1);
      }
      const doneIds = new Set((existing ?? []).map((e) => e.question_id));

      // 대표 이미지(order_index 0)의 경로가 같으면 같은 세트로 취급한다 — 크롭
      // 스크립트가 공통지문형 세트문제를 이렇게(같은 image_path를 여러 문항이
      // 공유) 저장하기 때문.
      const pending = questions
        .filter((q) => !doneIds.has(q.id))
        .map((q) => {
          const images = (q.question_images ?? []).sort((a, b) => a.order_index - b.order_index);
          return {
            question_id: q.id,
            question_number: q.question_number,
            image_paths: images.map((img) => img.image_path),
            set_key: images[0]?.image_path ?? q.id,
          };
        });

      if (pending.length === 0) continue;

      // 청크 분할은 방향과 무관하게 항상 순방향 기준으로 잘라, 순방향/역방향 세션이
      // 같은 문제지에서 수렴해도 동일한 청크 경계를 보게 한다 (경계가 어긋나 일부
      // 문항이 양쪽에 걸치는 일 방지). 역방향은 그 분할에서 뒤 청크부터 집는다.
      const paperChunks = cutChunks(pending, targetSize);
      if (reverse) paperChunks.reverse();

      const bucket = supabase.storage.from("exam-papers");
      for (const chunk of paperChunks) {
        collected.push({
          paper: { id: paper.id, title: paper.title, year: paper.year, level: paper.level },
          questions: chunk.map((q) => ({
            question_id: q.question_id,
            question_number: q.question_number,
            image_urls: q.image_paths.map((p) => bucket.getPublicUrl(p).data.publicUrl),
          })),
        });
        if (collected.length >= maxChunks) break outer;
      }
    }
  }

  if (truncatedBy) {
    console.error(`경고: 조회 오류로 수집을 조기 종료했습니다 (수집분은 그대로 출력) — ${truncatedBy}`);
  }

  if (collected.length === 0) {
    done("모든 우선순위 그룹 처리 완료");
    return;
  }

  if (multi) {
    console.log(JSON.stringify({ done: false, chunks: collected }, null, 2));
  } else {
    // 기존 단일 청크 형식 (구버전 호출부 호환)
    console.log(
      JSON.stringify({ done: false, paper: collected[0].paper, questions: collected[0].questions }, null, 2),
    );
  }
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
