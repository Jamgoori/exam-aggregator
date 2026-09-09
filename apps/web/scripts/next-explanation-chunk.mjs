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
// 청크에는 그 문제지 과목의 정본 개념 목록(concepts)이 함께 실린다. 해설 배치가
// 개념 이름을 자유 문자열로 쓰면 표기가 표류해서 — 실측으로 keyword_title의 표기
// 유일도가 96~99%였다, 즉 사실상 문항마다 다른 문자열이다 — 약점 진단의 개념별
// 분포를 만들 수 없다. 그래서 "고르게" 한다. 목록이 아직 없는 과목은 빈 배열이고,
// 그때는 프롬프트가 개념을 비워 두게 돼 있다.
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

// concepts 행들에서 "고를 수 있는 개념 목록"을 만든다.
//
// 단원도 concepts 행이라 컬럼으로는 안 갈린다. 자식이 달린 최상위 행이 단원이고,
// 자식이 없는 최상위 행은 "단원 없는 개념"이다 — 후자는 고를 수 있어야 한다.
// 합쳐진 개념(merged_into)은 더 이상 고를 대상이 아니다.
function shapeConceptList(rows) {
  const live = (rows ?? []).filter((r) => !r.merged_into);
  const nameById = new Map(live.map((r) => [r.id, r.name]));
  const hasChild = new Set(live.map((r) => r.parent_id).filter(Boolean));
  return live
    .filter((r) => !(r.parent_id === null && hasChild.has(r.id)))
    .map((r) => ({
      name: r.name,
      unit: r.parent_id ? (nameById.get(r.parent_id) ?? null) : null,
      // knowledge = 지식형, skill = 기능형(독해처럼 묻는 능력). 독해 문항이 지문
      // 주제 대신 기능을 고르게 하려면 이 값이 보여야 한다.
      kind: r.kind ?? "knowledge",
    }))
    .sort(
      (a, b) =>
        (a.unit ?? "").localeCompare(b.unit ?? "", "ko") || a.name.localeCompare(b.name, "ko"),
    );
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

  // 과목별 정본 개념 목록. 청크마다 같은 과목을 다시 묻지 않도록 캐시한다.
  //
  // 이 조회가 실패해도 배치를 멈추지 않는다. 개념은 나중에 백필로 붙일 수 있지만
  // 해설은 이 세션에서만 만들 수 있다 — 개념 때문에 해설 생성을 통째로 날리는 건
  // 손해가 훨씬 크다. 실패하면 stderr에 남기고 빈 목록으로 진행한다.
  const conceptCache = new Map();
  async function conceptListFor(subjectId) {
    if (!subjectId) return { subject: null, concepts: [] };
    const cached = conceptCache.get(subjectId);
    if (cached) return cached;

    let subject = null;
    const { data: subjectRow, error: subjectError } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("id", subjectId)
      .maybeSingle();
    if (subjectError) console.error(`과목 조회 실패 (${subjectId}): ${subjectError.message}`);
    else if (subjectRow) subject = { id: subjectRow.id, name: subjectRow.name };

    let concepts = [];
    const { data: rows, error } = await supabase
      .from("concepts")
      .select("id, name, parent_id, kind, merged_into")
      .eq("subject_id", subjectId);
    if (error) {
      console.error(`개념 목록 조회 실패 (${subjectId}): ${error.message} — 개념 없이 진행`);
    } else {
      concepts = shapeConceptList(rows);
    }

    const result = { subject, concepts };
    conceptCache.set(subjectId, result);
    return result;
  }

  const bucket = supabase.storage.from("exam-papers");
  const publicUrls = (paths) => (paths ?? []).map((path) => bucket.getPublicUrl(path).data.publicUrl);

  // 같은 선별을 SQL 한 번으로 하는 RPC(next_explanation_pending_papers, 2026-08-25 DB 배포).
  // 아래 JS 순회는 완료된 그룹이 앞에 쌓일수록 그룹·문제지마다 조회를 날려 급격히 느려진다
  // (2026-09-09 실측: 잔여가 우선순위 19 한 그룹만 남은 상태에서 순방향 단일 청크가 540초
  // 타임아웃, 같은 선별이 RPC로는 5~9초). 실패하면(권한 없음·statement timeout) null을
  // 돌려주고 기존 순회로 그대로 떨어진다 — 배치를 멈추지 않는다.
  async function collectViaRpc() {
    // 이 RPC는 8초 statement timeout 에 아슬아슬하다 — 캐시가 식어 있으면 첫 호출이
    // 넘어가고 곧바로 다시 부르면 4초대로 떨어진다(2026-09-09 실측: 9회 중 2회 타임아웃,
    // 전부 첫 호출). 그래서 타임아웃만 짧게 재시도하고, 그래도 안 되면 JS 순회로 간다.
    let data = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await supabase.rpc("next_explanation_pending_papers", {
        p_reverse: reverse,
        p_max_papers: maxChunks,
      });
      if (!res.error) {
        data = res.data;
        break;
      }
      const timedOut = res.error.code === "57014" || /statement timeout/i.test(res.error.message ?? "");
      if (!timedOut || attempt === 3) {
        console.error(`pending 문제지 RPC 실패 — JS 순회로 대체: ${res.error.message}`);
        return null;
      }
      console.error(`pending 문제지 RPC 타임아웃 (${attempt}/3) — 재시도`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
    const papers = data?.papers;
    if (!Array.isArray(papers)) {
      console.error("pending 문제지 RPC 응답 형식이 예상과 다름 — JS 순회로 대체");
      return null;
    }
    if (papers.length === 0) return [];

    // RPC는 subject_id를 싣지 않는다. 제외 과목 필터와 개념 목록에 필요하므로 한 번에 받는다.
    const paperIds = papers.map((entry) => entry?.paper?.id).filter(Boolean);
    const { data: subjectRows, error: subjectError } = await supabase
      .from("exam_papers")
      .select("id, subject_id")
      .in("id", paperIds);
    if (subjectError) {
      console.error(`문제지 과목 조회 실패 — JS 순회로 대체: ${subjectError.message}`);
      return null;
    }
    const subjectOf = new Map((subjectRows ?? []).map((row) => [row.id, row.subject_id]));

    const out = [];
    for (const entry of papers) {
      const paper = entry?.paper;
      const rows = entry?.questions;
      if (!paper?.id || !Array.isArray(rows) || rows.length === 0) continue;
      const subjectId = subjectOf.get(paper.id) ?? null;
      if (subjectId && excludedSubjectIds.has(subjectId)) continue;

      const pending = rows
        .map((q) => ({
          question_id: q.question_id,
          question_number: q.question_number,
          image_paths: q.image_paths ?? [],
          // 대표 이미지가 같으면 같은 세트 — JS 순회 쪽과 같은 규칙이다.
          set_key: (q.image_paths ?? [])[0] ?? q.question_id,
        }))
        .sort((a, b) => a.question_number - b.question_number);

      // 청크 경계는 방향과 무관하게 항상 순방향 기준으로 자른다 (JS 순회와 동일).
      const paperChunks = cutChunks(pending, targetSize);
      if (reverse) paperChunks.reverse();
      const { subject, concepts } = await conceptListFor(subjectId);

      for (const chunk of paperChunks) {
        out.push({
          paper: { id: paper.id, title: paper.title, year: paper.year, level: paper.level },
          subject,
          concepts,
          questions: chunk.map((q) => ({
            question_id: q.question_id,
            question_number: q.question_number,
            image_urls: publicUrls(q.image_paths),
          })),
        });
        if (out.length >= maxChunks) return out;
      }
    }

    // 돌려받은 문제지가 전부 제외 과목이면 RPC로는 다음 대상을 알 수 없다 —
    // 여기서 done으로 끝내면 남은 물량을 통째로 건너뛰므로 JS 순회에 넘긴다.
    if (out.length === 0) return null;
    return out;
  }

  const collected = []; // { paper, subject, concepts, questions } 단위로 최대 maxChunks개 수집
  let truncatedBy = null; // 수집 도중 조회 오류가 나도 이미 수집한 청크는 살려서 출력

  const fromRpc = await collectViaRpc();
  if (fromRpc) collected.push(...fromRpc);

  outer: for (const { exam_type_id, level } of fromRpc ? [] : priorities) {
    // 경찰·계리직처럼 급수(level)가 없는 직렬은 priority 행의 level이 null이다.
    // .eq("level", null)은 에러 없이 0건만 매칭해 그룹이 조용히 건너뛰어지므로
    // (2026-08-09 실측), null은 반드시 .is()로 걸러야 한다.
    let papersQuery = supabase
      .from("exam_papers")
      .select("id, title, year, level, subject_id")
      .eq("exam_type_id", exam_type_id);
    papersQuery = level === null ? papersQuery.is("level", null) : papersQuery.eq("level", level);
    const { data: papers, error: papersError } = await papersQuery
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

      // 서브에이전트는 스냅샷 전체가 아니라 청크 하나만 받는다. 그래서 개념 목록도
      // 청크마다 실어야 한다(같은 과목이면 내용은 같다).
      const { subject, concepts } = await conceptListFor(paper.subject_id);

      for (const chunk of paperChunks) {
        collected.push({
          paper: { id: paper.id, title: paper.title, year: paper.year, level: paper.level },
          subject,
          concepts,
          questions: chunk.map((q) => ({
            question_id: q.question_id,
            question_number: q.question_number,
            image_urls: publicUrls(q.image_paths),
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
    // 기존 단일 청크 형식 (구버전 호출부 호환). 키가 늘어나는 건 호환을 깨지 않는다.
    console.log(
      JSON.stringify(
        {
          done: false,
          paper: collected[0].paper,
          subject: collected[0].subject,
          concepts: collected[0].concepts,
          questions: collected[0].questions,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
