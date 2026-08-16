// 사용법: node scripts/next-concept-chunk.mjs [--limit 60] [--subject 정보보호론] [--mine]
//
// 이미 만들어진 해설 중 concept_id 가 안 붙은 것을 과목 단위로 내려준다 (재분류 배치).
//
// 왜 필요한가: 해설 5만 개가 이미 있는데 전부 concept_id 가 null 이다. 정본 목록을
// 세워도 별칭 매칭으로는 안 붙는다 — 실측 커버리지가 국어 0.2% · 한국사 1.3% ·
// 영어 0.1% 였다. keyword_title 이 개념 이름이 아니라 문항마다 다른 문장이기 때문이다
// ("IPSec의 두 동작 모드 — 전송모드와 터널모드"). 사람이 읽으면 바로 아는 걸 문자열
// 비교로는 못 한다. 그래서 모델이 읽고 정본 목록에서 고르게 한다.
//
// 문항 이미지는 안 읽는다. keyword_title + question_text 만으로 결정되므로
// 해설 생성 배치보다 훨씬 싸고 빠르다.
//
// 출력(일반 모드):
//   { done: false, subject: {id, name}, remaining: 1065,
//     concepts: [{name, unit, kind}, ...],
//     items: [{question_id, keyword_title, question_text}, ...] }
//
// --mine: 정본 목록이 아직 없는 과목의 표기를 무작위 표본으로 뽑는다. 목록을 세우는
//   재료다. 이 모드는 분류를 하지 않는다.
//   출력: { done: false, mine: true, subject: {...}, total, sample: [...] }
//
// 정본 목록이 없는 과목은 일반 모드에서 건너뛴다. 붙일 데가 없는데 모델을 돌리면
// 전부 미매칭으로 나오고 토큰만 쓴다.
//
// EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD 로 로그인해서 실행한다. 해설봇은
// admins 에 등록돼 있어 question_explanations 를 읽고 쓸 수 있다. concepts/
// concept_aliases 는 읽기만 된다(쓰기 정책이 없다 — 사전은 service_role 로만 바꾼다).

import { createClient } from "@supabase/supabase-js";
import { shapeConceptList } from "./lib/concept-alias.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 무인 루틴이 부르는 스크립트라 애매한 입력은 즉시 에러로 끝낸다. 조용히 다른
  // 모드로 굴러가면 엉뚱한 과목을 갈아엎는다.
  const knownFlags = new Set(["limit", "subject", "mine"]);
  for (const key of Object.keys(args)) {
    if (!knownFlags.has(key)) {
      console.error(`알 수 없는 플래그: --${key} (지원: --limit N, --subject 이름, --mine)`);
      process.exit(1);
    }
  }
  const mine = "mine" in args;
  if (mine && args["mine"] !== true) {
    console.error("--mine 은 값을 받지 않습니다.");
    process.exit(1);
  }
  const limit = Number(args["limit"] ?? (mine ? 200 : 60));
  if (!Number.isInteger(limit) || limit < 1 || limit > 400) {
    console.error("--limit 은 1~400 사이의 정수여야 합니다.");
    process.exit(1);
  }
  const subjectFilter = typeof args["subject"] === "string" ? args["subject"] : null;

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

  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name")
    .order("name");
  if (subjectsError) {
    console.error(`과목 조회 실패: ${subjectsError.message}`);
    process.exit(1);
  }
  let targets = subjects ?? [];
  if (subjectFilter) {
    targets = targets.filter((s) => s.name === subjectFilter);
    if (targets.length === 0) {
      console.error(`과목을 찾을 수 없습니다: ${subjectFilter}`);
      process.exit(1);
    }
  }

  // 과목별 정본 목록. 목록이 있는 과목만 분류 대상이고, 없는 과목만 --mine 대상이다.
  const conceptsBySubject = new Map();
  for (const s of targets) {
    const { data, error } = await supabase
      .from("concepts")
      .select("id, name, parent_id, kind, merged_into")
      .eq("subject_id", s.id);
    if (error) {
      console.error(`개념 목록 조회 실패 (${s.name}): ${error.message}`);
      process.exit(1);
    }
    conceptsBySubject.set(s.id, shapeConceptList(data));
  }

  // 아직 concept_id 가 없는 해설 수. 많이 남은 과목부터 처리한다.
  //
  // count:"exact" 로 세면 안 된다. 조인 전체를 끝까지 세느라 8초 statement timeout
  // 을 넘긴다 (2026-08-16 실측: 봇 8.2초로 초과, service_role 도 7.8초로 아슬아슬).
  // 코퍼스가 커지면서 넘은 선이라 앞으로 더 나빠지기만 한다. 이 숫자는 "어느 과목을
  // 먼저 볼까"를 정하는 데에만 쓰이므로 planner 추정치로 충분하다.
  //
  // 과목 하나가 타임아웃해도 세션을 죽이지 않는다 — 예전에는 exit(1) 이라, 잔여가
  // 0 이라 스캔이 끝까지 가는 과목(경찰학) 하나 때문에 배치 전체가 못 돌았다.
  const pending = [];
  const skipped = [];
  for (const s of targets) {
    const hasList = (conceptsBySubject.get(s.id) ?? []).length > 0;
    if (mine === hasList) continue; // mine 모드면 목록 없는 과목만, 아니면 있는 과목만

    // 과목을 직접 지정했으면 셀 이유가 없다. 대상이 하나뿐이라 우선순위가 없고,
    // 세는 쿼리가 그 자체로 이 스크립트가 죽던 자리다.
    if (subjectFilter && !mine) {
      pending.push({ ...s, remaining: null });
      continue;
    }

    const { count, error } = await supabase
      .from("question_explanations")
      .select("question_id, questions!inner(exam_papers!inner(subject_id))", {
        count: "planned",
        head: true,
      })
      .is("concept_id", null)
      .not("keyword_title", "is", null)
      .eq("questions.exam_papers.subject_id", s.id);
    if (error) {
      skipped.push({ subject: s.name, reason: error.message || error.code || "타임아웃" });
      continue;
    }
    if ((count ?? 0) > 0) pending.push({ ...s, remaining: count });
  }
  if (skipped.length > 0) {
    console.error(
      `잔여량을 못 센 과목 ${skipped.length}개 (이번 회차만 건너뜀): ` +
        skipped.map((s) => s.subject).join(", "),
    );
  }

  if (pending.length === 0) {
    console.log(
      JSON.stringify({
        done: true,
        reason: mine
          ? "정본 목록이 없는 과목 중 해설이 있는 과목이 없음"
          : "정본 목록이 있는 과목의 해설에 concept_id 가 모두 붙음",
      }),
    );
    return;
  }

  pending.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "ko"));
  const subject = pending[0];

  // question_text 를 함께 준다. 독해 문항은 keyword_title 이 지문 주제라
  // ("조선 후기 상업의 발달") 제목만으로는 기능형 개념을 못 고른다 — 발문을 봐야
  // "주제 파악"인지 "빈칸추론"인지 갈린다.
  const select =
    "question_id, keyword_title, question_text, questions!inner(exam_papers!inner(subject_id))";
  // ordered 는 --mine 에서만 켠다. 무작위 위치 블록을 뽑으려면 순서가 고정돼야
  // 하는데, 정렬을 걸면 조인 위에서 깊이 훑느라 느려진다 (2026-08-16 실측: 같은
  // 조회가 정렬 있으면 60건에 8초 초과, 없으면 0.3초). 일반 모드는 미분류 해설
  // 아무거나 60건이면 되고, 붙은 것은 다음 회차의 대상에서 빠지므로 순서가 필요 없다.
  const fetchRange = async (from, to, ordered = false) => {
    let query = supabase
      .from("question_explanations")
      .select(select)
      .is("concept_id", null)
      .not("keyword_title", "is", null)
      .eq("questions.exam_papers.subject_id", subject.id);
    if (ordered) query = query.order("question_id");
    const { data, error } = await query.range(from, to);
    if (error) {
      console.error(`해설 조회 실패 (${subject.name}): ${error.message}`);
      process.exit(1);
    }
    return data ?? [];
  };

  let rows;
  if (mine) {
    // 목록 초안용 표본은 앞에서부터 자르면 편향된다 — question_id 순서는 사실상
    // 업로드 순서라 같은 시험지·같은 단원이 몰린다. PostgREST 는 order by random()
    // 을 못 하므로, 무작위 위치의 블록 몇 개로 나눠 뽑는다.
    const blocks = 5;
    const per = Math.max(1, Math.ceil(limit / blocks));
    const span = Math.max(1, subject.remaining - per);
    const seen = new Set();
    rows = [];
    for (let b = 0; b < blocks && rows.length < limit; b++) {
      const from = Math.floor(Math.random() * span);
      for (const r of await fetchRange(from, from + per - 1, true)) {
        if (seen.has(r.question_id)) continue;
        seen.add(r.question_id);
        rows.push(r);
      }
    }
    rows = rows.slice(0, limit);
  } else {
    rows = await fetchRange(0, limit - 1);
  }

  const items = rows.map((r) => ({
    question_id: r.question_id,
    keyword_title: r.keyword_title,
    question_text: r.question_text,
  }));

  if (mine) {
    console.log(
      JSON.stringify(
        {
          done: false,
          mine: true,
          subject: { id: subject.id, name: subject.name },
          total: subject.remaining,
          sample: items.map((i) => ({
            keyword_title: i.keyword_title,
            question_text: i.question_text,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        done: false,
        subject: { id: subject.id, name: subject.name },
        remaining: subject.remaining,
        concepts: conceptsBySubject.get(subject.id),
        items,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
