// 사용법: node scripts/next-explanation-chunk.mjs [--target-size 10]
//
// explanation_batch_priority 순서대로, question_explanations에 아직 없는 문항이
// 남아있는 첫 문제지를 찾아서 다음에 처리할 청크(문항 목록 + 이미지 URL)를 JSON으로
// stdout에 출력한다. 세트문제(같은 문항이 여러 이미지에 이어지는 경우는 그렇다 치고,
// 여기서 말하는 "세트"는 서로 다른 문항이 같은 이미지를 공유하는 경우 — 크롭 스크립트가
// 공통지문형 세트문제를 이렇게 저장한다)는 절대 청크 경계에서 쪼개지 않는다: target-size를
// 넘기더라도 세트 끝까지 포함해서 담는다.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetSize = Number(args["target-size"] ?? 10);

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

  const { data: priorities, error: priorityError } = await supabase
    .from("explanation_batch_priority")
    .select("exam_type_id, level, priority")
    .order("priority", { ascending: true });
  if (priorityError) {
    console.error(`우선순위 조회 실패: ${priorityError.message}`);
    process.exit(1);
  }
  if (!priorities || priorities.length === 0) {
    console.log(JSON.stringify({ done: true, reason: "explanation_batch_priority가 비어있음" }));
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

  for (const { exam_type_id, level } of priorities) {
    const { data: papers, error: papersError } = await supabase
      .from("exam_papers")
      .select("id, title, year, level, subject_id")
      .eq("exam_type_id", exam_type_id)
      .eq("level", level)
      .order("year", { ascending: true })
      .order("id", { ascending: true });
    if (papersError) {
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

      const chunk = [];
      for (let i = 0; i < pending.length; i++) {
        chunk.push(pending[i]);
        if (chunk.length >= targetSize) {
          const next = pending[i + 1];
          const last = chunk[chunk.length - 1];
          if (next && next.set_key === last.set_key) {
            continue; // 세트 중간이면 target-size를 넘기더라도 세트 끝까지 포함
          }
          break;
        }
      }

      const bucket = supabase.storage.from("exam-papers");
      const questionsWithUrls = chunk.map((q) => ({
        question_id: q.question_id,
        question_number: q.question_number,
        image_urls: q.image_paths.map((p) => bucket.getPublicUrl(p).data.publicUrl),
      }));

      console.log(
        JSON.stringify(
          {
            done: false,
            paper: { id: paper.id, title: paper.title, year: paper.year, level: paper.level },
            questions: questionsWithUrls,
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  console.log(JSON.stringify({ done: true, reason: "모든 우선순위 그룹 처리 완료" }));
}

main();
