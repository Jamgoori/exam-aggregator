// 사용법: node scripts/next-explanation-chunk.mjs [--target-size 10] [--chunks N] [--reverse]
//
// explanation_batch_priority 순서대로, question_explanations에 아직 없는 문항이
// 남아있는 첫 문제지를 찾아서 다음에 처리할 청크(문항 목록 + 이미지 URL)를 JSON으로
// stdout에 출력한다. 세트문제(같은 문항이 여러 이미지에 이어지는 경우는 그렇다 치고,
// 여기서 말하는 "세트"는 서로 다른 문항이 같은 이미지를 공유하는 경우 — 크롭 스크립트가
// 공통지문형 세트문제를 이렇게 저장한다)는 절대 청크 경계에서 쪼개지 않는다: target-size를
// 넘기더라도 세트 끝까지 포함해서 담는다.
//
// [조회 전략 — 2026-08-25 성능 개편]
// 예전에는 우선순위 그룹의 문제지를 하나씩 돌며 문제지마다 (questions, 기존 해설)
// 2번을 순차로 조회했다. 이미 해설이 끝난 문제지도 매번 2왕복을 치러야 넘어가는
// 구조라, 완료 문제지가 쌓일수록 "다음 청크 찾기"에만 수십 분이 들었다(최우선 그룹
// 문제지 491개 기준 실측 20~35분 = 왕복 약 1,000번). 지금은 두 단계다:
//   1차: DB RPC next_explanation_pending_papers() 한 번. 미해설 문항이 남은 문제지
//        앞쪽 maxChunks개를 NOT EXISTS anti-join + 동일 정렬로 DB에서 바로 골라온다.
//        supabase/migrations/20260825120000_next_explanation_pending_papers.sql 이
//        적용돼 있어야 한다.
//   2차(폴백): RPC가 아직 없거나(마이그레이션 미적용, PGRST202) 실패하면, 문제지
//        전체 목록과 미해설 문항을 벌크(.in() 묶음 + .range() 페이지네이션)로 받아
//        메모리에서 같은 계산을 한다. 문제지당 왕복이 아니라 문제지 150개 단위
//        왕복이라 이쪽도 수십 초면 끝난다.
// 어느 경로든 출력은 종전 문제지별 순회 로직과 100% 동일하다(그룹/문제지/문항 정렬,
// 세트 경계, 청크 분할, 출력 형식 전부). 일부러 "지난 세션 커서 저장" 같은 상태는
// 두지 않는다 — 순방향/역방향 세션이 양 끝에서 좁혀와 중간에서 만나는 수렴 설계는
// 매 호출이 전체 순서를 처음부터 다시 계산해야 안전하다.
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

// PostgREST는 응답을 max-rows(기본 1000행)에서 자른다. 벌크 조회는 그보다 클 수
// 있으므로 마지막 페이지가 꽉 차 있지 않을 때까지 .range()로 끝까지 받는다
// (scripts/lib/concept-alias.mjs 의 loadAliasIndex 와 같은 관례).
const PAGE_SIZE = 1000;

async function fetchAllPages(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
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

  const collected = []; // { paper, subject, concepts, questions } 단위로 최대 maxChunks개 수집
  let truncatedBy = null; // 수집 도중 조회 오류가 나도 이미 수집한 청크는 살려서 출력

  const bucket = supabase.storage.from("exam-papers");

  // 문제지 하나의 미해설(pending) 목록을 청크로 잘라 collected에 담는다. maxChunks를
  // 채우면 true를 돌려 호출부가 순회를 멈춘다. RPC 경로와 벌크 폴백이 반드시 같은
  // 분할 코드를 지나게 하는 공통부다 — 경계 계산이 경로에 따라 달라지면 순/역방향
  // 수렴 설계가 깨진다.
  const collectPaper = async (paper, pending) => {
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
          image_urls: q.image_paths.map((p) => bucket.getPublicUrl(p).data.publicUrl),
        })),
      });
      if (collected.length >= maxChunks) return true;
    }
    return false;
  };

  // ── 1차: RPC 경로 ─────────────────────────────────────────────────────────
  // 우선순위→제외과목→문제지→미해설 문항의 순서 계산을 전부 DB 안에서 끝내고,
  // 미해설이 남은 앞쪽 문제지 maxChunks개의 pending 목록만 통째로 받는다(왕복 1번).
  // 청크는 문제지당 최소 1개 나오므로 문제지 maxChunks개면 항상 충분하다.
  // 마이그레이션이 아직 안 적용된 DB에서는 PGRST202(함수 없음)로 떨어지고, 그때는
  // 아래 벌크 폴백이 같은 결과를 만든다 — 어느 쪽이 돌았는지는 stderr로만 알린다.
  const { data: rpcData, error: rpcError } = await supabase.rpc("next_explanation_pending_papers", {
    p_reverse: reverse,
    p_max_papers: maxChunks,
  });

  if (!rpcError && rpcData && typeof rpcData === "object" && Array.isArray(rpcData.papers)) {
    if (rpcData.priorities_empty === true) {
      done("explanation_batch_priority가 비어있음");
      return;
    }
    for (const row of rpcData.papers) {
      // jsonb는 객체 키 순서를 보존하지 않으므로, 출력에 나가는 객체는 전부 여기서
      // 필드명을 짚어 다시 만든다 — 구버전과 출력 바이트까지 같아야 diff 검증이 된다.
      const pending = (row.questions ?? []).map((q) => ({
        question_id: q.question_id,
        question_number: q.question_number,
        image_paths: q.image_paths ?? [],
        // 대표 이미지(order_index 0)의 경로가 같으면 같은 세트다 — 크롭 스크립트가
        // 공통지문형 세트문제를 이렇게(같은 image_path 공유) 저장하기 때문.
        set_key: (q.image_paths ?? [])[0] ?? q.question_id,
      }));
      if (pending.length === 0) continue;
      const paper = {
        id: row.paper?.id,
        title: row.paper?.title,
        year: row.paper?.year,
        level: row.paper?.level ?? null,
        subject_id: row.subject_id ?? null,
      };
      if (await collectPaper(paper, pending)) break;
    }
  } else {
    if (rpcError) {
      console.error(
        `안내: RPC(next_explanation_pending_papers) 사용 불가 — 벌크 폴백으로 진행 (${rpcError.message})`,
      );
    } else {
      console.error(
        "안내: RPC(next_explanation_pending_papers) 응답 형식이 예상과 다름 — 벌크 폴백으로 진행",
      );
    }

    // ── 2차: 벌크 폴백 경로 ─────────────────────────────────────────────────
    // 구버전과 같은 순회를 하되, 왕복을 "문제지마다 2번"에서 "테이블마다 몇 번"으로
    // 줄인다: 우선순위/제외과목/문제지 전체를 먼저 받아 순회 순서(후보 목록)를 만들고,
    // 문항은 후보 문제지 150개 단위로 묶어 미해설만 받아온다.

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

    // 문제지는 그룹별로 따로 받지 않고 한 번에 다 받아 그룹으로 나눈다. 전역 정렬
    // (year, id)이 그룹 안 정렬과 같은 키라, 나눠 담아도 그룹 안 순서는 DB가 그룹별로
    // 정렬해준 것과 동일하다.
    let papers;
    try {
      papers = await fetchAllPages(() =>
        supabase
          .from("exam_papers")
          .select("id, title, year, level, subject_id, exam_type_id")
          .order("year", { ascending: !reverse })
          .order("id", { ascending: !reverse }),
      );
    } catch (e) {
      console.error(`문제지 조회 실패: ${e.message}`);
      process.exit(1);
    }

    // 경찰·계리직처럼 급수(level)가 없는 직렬은 priority 행의 level이 null이다.
    // (구버전은 이걸 .is()/.eq() 분기로 처리했다 — 여기서는 그룹 키 비교라 null도
    // 여느 값처럼 정확히 맞는다.)
    const groupKey = (examTypeId, level) => JSON.stringify([examTypeId, level ?? null]);
    const papersByGroup = new Map();
    for (const p of papers) {
      const key = groupKey(p.exam_type_id, p.level);
      let group = papersByGroup.get(key);
      if (!group) papersByGroup.set(key, (group = []));
      group.push(p);
    }

    const candidates = [];
    for (const { exam_type_id, level } of priorities) {
      for (const paper of papersByGroup.get(groupKey(exam_type_id, level)) ?? []) {
        if (excludedSubjectIds.has(paper.subject_id)) continue;
        candidates.push(paper);
      }
    }

    // 문항 조회. question_explanations 임베드가 비어 있는 행이 미해설이다.
    //   1) 서버측 anti-join(!left + is.null): 완료 문제지의 행은 아예 안 온다 —
    //      전송량이 "미해설 문항 수"에만 비례해서, 완료 문제지가 쌓여도 안 느려진다.
    //   2) PostgREST가 그 문법을 거부하면 임베드만 받아 클라이언트에서 거른다.
    // 어느 쪽이든 미해설 판정 필터는 아래에서 항상 한 번 더 돈다 — 서버 필터가 조용히
    // 무시되는 환경에서도 이미 해설된 문항이 다시 배정되는 일은 없어야 한다.
    const PAPERS_PER_BATCH = 150; // .in() URL 길이 한계 안 (save-explanations의 200개 관례보다 보수적)
    let serverAntiJoin = true;

    const fetchPendingRows = async (batchPaperIds, isFirstBatch) => {
      const makeQuery = () => {
        let q = supabase
          .from("questions")
          .select(
            serverAntiJoin
              ? "id, question_number, paper_id, question_images(image_path, order_index), question_explanations!left(question_id)"
              : "id, question_number, paper_id, question_images(image_path, order_index), question_explanations(question_id)",
          )
          .in("paper_id", batchPaperIds);
        if (serverAntiJoin) q = q.is("question_explanations", null);
        // (paper_id, question_number)는 unique라 전순서 — 페이지가 밀리거나 겹칠 수 없다.
        return q
          .order("paper_id", { ascending: true })
          .order("question_number", { ascending: true });
      };
      let rows;
      try {
        rows = await fetchAllPages(makeQuery);
      } catch (e) {
        // anti-join 문법 미지원이면 "첫 배치"에서 실패한다 — 그때만 plain 임베드로
        // 바꿔 한 번 재시도한다. 둘째 배치부터의 실패는 문법이 아니라 환경 문제라
        // 그대로 올려보내, 구버전과 같은 "수집분 보존" 오류 경로를 타게 한다.
        if (!serverAntiJoin || !isFirstBatch) throw e;
        serverAntiJoin = false;
        console.error(`안내: 서버측 미해설 필터 불가 — 클라이언트 필터로 전환 (${e.message})`);
        rows = await fetchAllPages(makeQuery);
      }
      return rows.filter((r) => (r.question_explanations ?? []).length === 0);
    };

    outer: for (let i = 0; i < candidates.length; i += PAPERS_PER_BATCH) {
      const batch = candidates.slice(i, i + PAPERS_PER_BATCH);
      let pendingRows;
      try {
        pendingRows = await fetchPendingRows(batch.map((p) => p.id), i === 0);
      } catch (e) {
        if (collected.length > 0) {
          truncatedBy = `문항 조회 실패 (papers ${batch[0].id}…): ${e.message}`;
          break outer;
        }
        console.error(`문항 조회 실패 (papers ${batch[0].id}…): ${e.message}`);
        process.exit(1);
      }

      // 다른 세션이 사이에 저장/업로드하면 페이지 경계가 밀려 같은 행이 두 번 올 수
      // 있다(빠진 행은 다음 호출이 자연히 다시 집는다 — 안전). 중복만 여기서 거른다.
      const rowsByPaper = new Map();
      const seenQuestionIds = new Set();
      for (const row of pendingRows) {
        if (seenQuestionIds.has(row.id)) continue;
        seenQuestionIds.add(row.id);
        let rows = rowsByPaper.get(row.paper_id);
        if (!rows) rowsByPaper.set(row.paper_id, (rows = []));
        rows.push(row);
      }

      for (const paper of batch) {
        const rows = rowsByPaper.get(paper.id);
        if (!rows || rows.length === 0) continue;

        // 대표 이미지(order_index 0)의 경로가 같으면 같은 세트로 취급한다 — 크롭
        // 스크립트가 공통지문형 세트문제를 이렇게(같은 image_path를 여러 문항이
        // 공유) 저장하기 때문.
        const pending = rows.map((q) => {
          const images = (q.question_images ?? []).sort((a, b) => a.order_index - b.order_index);
          return {
            question_id: q.id,
            question_number: q.question_number,
            image_paths: images.map((img) => img.image_path),
            set_key: images[0]?.image_path ?? q.id,
          };
        });

        if (await collectPaper(paper, pending)) break outer;
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
