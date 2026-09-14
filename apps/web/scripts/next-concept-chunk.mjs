// 사용법: node scripts/next-concept-chunk.mjs [--limit 60] [--subject 정보보호론]
//                                            [--exclude 국어,경찰학] [--mine]
//
// 이미 만들어진 해설 중 concept_id 가 안 붙은 것을 과목 단위로 내려준다 (재분류 배치).
//
// 과목은 전범위다. 플래그 없이 부르면 정본 목록이 있는 과목을 이름순으로 훑어 미분류
// 해설이 남은 첫 과목의 청크를 내려주고, 그 과목이 바닥나면 **같은 호출 안에서** 다음
// 과목으로 넘어간다. 루틴이 과목을 기억했다가 --subject 로 이어 붙일 필요가 없다.
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
//   { done: false, subject: {id, name}, remaining: null, tail: false,
//     concepts: [{name, unit, kind}, ...],
//     items: [{question_id, keyword_title, question_text}, ...] }
//
// tail: true 는 이 과목의 미분류 해설이 한 청크를 못 채웠다는 뜻이다 — 끝물이라 다음
// 호출은 다른 과목으로 넘어간다. remaining 은 일반 모드에서 항상 null 이다 (아래
// "잔여량을 세지 않는다" 참고).
//
// --subject: 그 과목부터 시작한다. **가둬 두는 것이 아니다** — 그 과목이 바닥나면
//   같은 호출 안에서 나머지 과목으로 넘어간다. 한 과목만 보려면 --only 를 함께 준다.
//   (루틴 프롬프트가 옛 방식대로 --subject 를 이어 붙이더라도 배치가 그 과목에서
//   멈추지 않게 하려는 것이다. 루틴은 이 플래그를 쓸 이유가 없다.)
// --only: --subject 와 함께 쓴다. 그 과목만 보고, 바닥나면 done: true 로 끝낸다.
//   사람이 한 과목만 손볼 때 쓴다.
// --exclude: 그 과목들을 대상에서 뺀다. 정본 목록에 붙을 데가 없어 매 회차 같은 문항이
//   되돌아오는 과목(과목이 잘못 붙은 잔여 등)을 소유자가 손볼 때까지 건너뛴다.
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
import {
  buildDictionarySubjectIds,
  dictionarySubjectId,
  shapeConceptList,
} from "./lib/concept-alias.mjs";

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
  const knownFlags = new Set(["limit", "subject", "only", "exclude", "mine"]);
  for (const key of Object.keys(args)) {
    if (!knownFlags.has(key)) {
      console.error(
        `알 수 없는 플래그: --${key} ` +
          "(지원: --limit N, --subject 이름, --only, --exclude 이름,이름, --mine)",
      );
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
  const only = "only" in args;
  if (only && args["only"] !== true) {
    console.error("--only 는 값을 받지 않습니다.");
    process.exit(1);
  }
  if (only && !subjectFilter) {
    console.error("--only 는 --subject 와 함께 씁니다.");
    process.exit(1);
  }
  const excluded = new Set(
    typeof args["exclude"] === "string"
      ? args["exclude"].split(",").map((n) => n.trim()).filter(Boolean)
      : [],
  );
  if ("exclude" in args && excluded.size === 0) {
    console.error("--exclude 는 과목 이름을 받습니다 (쉼표로 구분).");
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

  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name, slug")
    .order("name");
  if (subjectsError) {
    console.error(`과목 조회 실패: ${subjectsError.message}`);
    process.exit(1);
  }
  let targets = subjects ?? [];
  if (subjectFilter) {
    if (!targets.some((s) => s.name === subjectFilter)) {
      console.error(`과목을 찾을 수 없습니다: ${subjectFilter}`);
      process.exit(1);
    }
    // --only 가 아니면 가두지 않고 순서만 앞으로 당긴다. 지정한 과목이 바닥나면
    // 아래 훑기가 그대로 다음 과목으로 넘어간다.
    targets = only
      ? targets.filter((s) => s.name === subjectFilter)
      : [
          ...targets.filter((s) => s.name === subjectFilter),
          ...targets.filter((s) => s.name !== subjectFilter),
        ];
  }

  if (excluded.size > 0) {
    const known = new Set((subjects ?? []).map((s) => s.name));
    const unknown = [...excluded].filter((n) => !known.has(n));
    if (unknown.length > 0) {
      console.error(`--exclude 에 없는 과목: ${unknown.join(", ")}`);
      process.exit(1);
    }
    targets = targets.filter((s) => !excluded.has(s.name));
  }

  // 과목별 정본 목록. 목록이 있는 과목만 분류 대상이고, 없는 과목만 --mine 대상이다.
  //
  // 과목마다 따로 묻지 않고 한 번에 받아 메모리에서 가른다. 전 과목을 훑게 되면서
  // 과목당 왕복 하나가 그대로 청크당 지연이 됐다 (25과목이면 조회만 25번).
  const CONCEPT_PAGE = 1000;
  const conceptRows = [];
  for (let from = 0; ; from += CONCEPT_PAGE) {
    const { data, error } = await supabase
      .from("concepts")
      .select("id, name, parent_id, kind, merged_into, subject_id")
      .range(from, from + CONCEPT_PAGE - 1);
    if (error) {
      console.error(`개념 목록 조회 실패: ${error.message}`);
      process.exit(1);
    }
    conceptRows.push(...(data ?? []));
    if ((data?.length ?? 0) < CONCEPT_PAGE) break;
  }
  const conceptRowsBySubject = new Map();
  for (const r of conceptRows) {
    const list = conceptRowsBySubject.get(r.subject_id);
    if (list) list.push(r);
    else conceptRowsBySubject.set(r.subject_id, [r]);
  }
  // 사전을 빌려 쓰는 과목(한능검 → 한국사)은 빌려준 과목의 목록을 그대로 받는다.
  // 붙는 concept_id 도 빌려준 과목의 것이다 — 복제하지 않는 것이 요점이다
  // (docs/agents/concept-dictionary.md "사전을 빌려 쓰는 과목").
  const dictionaryOf = buildDictionarySubjectIds(subjects ?? []);
  const conceptsBySubject = new Map();
  for (const s of targets) {
    const dictId = dictionarySubjectId(s.id, dictionaryOf);
    conceptsBySubject.set(s.id, shapeConceptList(conceptRowsBySubject.get(dictId) ?? []));
  }

  // mine 모드면 목록 없는 과목만, 아니면 있는 과목만.
  const candidates = targets.filter(
    (s) => mine !== ((conceptsBySubject.get(s.id) ?? []).length > 0),
  );

  // 일반 모드는 잔여량을 세지 않는다.
  //
  // 예전에는 과목마다 count 를 날려 "많이 남은 과목부터" 정했는데, 그 한 판이 청크당
  // 2분이었다 (2026-08-18 실측). 게다가 planned 추정치가 크게 빗나가서 순서로도 못
  // 믿는다 (2026-08-17 실측: 국어 추정 2,204 vs 실제 미분류 10건). 아래에서 과목을
  // 이름순으로 훑으며 **실제로 청크가 차는지**로 고르므로 이 숫자가 필요 없다.
  //
  // --mine 은 다르다. 무작위 위치 블록을 뽑으려면 모집단 크기가 있어야 한다.
  const pending = [];
  if (mine) {
    // 과목 하나가 타임아웃해도 세션을 죽이지 않는다 — 예전에는 exit(1) 이라, 잔여가
    // 0 이라 스캔이 끝까지 가는 과목(경찰학) 하나 때문에 배치 전체가 못 돌았다.
    const skipped = [];
    for (const s of candidates) {
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
    pending.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "ko"));
  } else {
    for (const s of candidates) pending.push({ ...s, remaining: null });
  }

  if (pending.length === 0) {
    console.log(
      JSON.stringify({
        done: true,
        reason: mine
          ? "정본 목록이 없는 과목 중 해설이 있는 과목이 없음"
          : only
            ? `${subjectFilter} 에 정본 목록이 없다`
            : "정본 목록이 있는 과목이 없다",
      }),
    );
    return;
  }

  // question_text 를 함께 준다. 독해 문항은 keyword_title 이 지문 주제라
  // ("조선 후기 상업의 발달") 제목만으로는 기능형 개념을 못 고른다 — 발문을 봐야
  // "주제 파악"인지 "빈칸추론"인지 갈린다.
  const select =
    "question_id, keyword_title, question_text, questions!inner(exam_papers!inner(subject_id))";
  // ordered 는 --mine 에서만 켠다. 무작위 위치 블록을 뽑으려면 순서가 고정돼야
  // 하는데, 정렬을 걸면 조인 위에서 깊이 훑느라 느려진다 (2026-08-16 실측: 같은
  // 조회가 정렬 있으면 60건에 8초 초과, 없으면 0.3초). 일반 모드는 미분류 해설
  // 아무거나 60건이면 되고, 붙은 것은 다음 회차의 대상에서 빠지므로 순서가 필요 없다.
  const fetchRange = async (target, from, to, ordered = false) => {
    let query = supabase
      .from("question_explanations")
      .select(select)
      .is("concept_id", null)
      .not("keyword_title", "is", null)
      .eq("questions.exam_papers.subject_id", target.id);
    if (ordered) query = query.order("question_id");
    const { data, error } = await query.range(from, to);
    if (error) {
      console.error(`해설 조회 실패 (${target.name}): ${error.message}`);
      return null;
    }
    return data ?? [];
  };

  let subject = pending[0];
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
      for (const r of (await fetchRange(subject, from, from + per - 1, true)) ?? []) {
        if (seen.has(r.question_id)) continue;
        seen.add(r.question_id);
        rows.push(r);
      }
    }
    rows = rows.slice(0, limit);
  } else {
    // 어느 과목을 볼지는 추정치가 아니라 **실제로 한 청크가 차는지**로 정한다.
    //
    // planned 추정치는 크게 빗나간다 (2026-08-17 실측: 국어 추정 2,204 vs 실제
    // 미분류 10건). 그 10건은 exam_papers.subject_id 가 국어로 잘못 붙은 문항이라
    // 정본 목록에 붙을 데가 없고, 추정치만 믿으면 배치가 영원히 그 과목만 집어
    // 아무 일도 못 한다 — 루틴에서 실제로 그렇게 갇혔다.
    //
    // 후보를 몇 개로 자르지 않고 **전 과목을 이름순으로** 훑는다. 한 청크를 채우는
    // 과목이 나오면 거기서 멈추므로(보통 첫 과목, 조회 한 번 0.3초) 훑는 비용은 끝물
    // 에서만 든다 — 그리고 그때가 바로 다음 과목으로 넘어가야 하는 때다. 한 과목이
    // 바닥나면 같은 호출 안에서 다음 과목이 나오니, 루틴은 과목을 기억할 필요도
    // --subject 를 옮겨 붙일 필요도 없다.
    //
    // 아무도 못 채우면 그중 제일 많이 나온 과목을 쓴다(끝물이라 그런 것이니 그대로
    // 처리하면 된다).
    let probeErrors = 0;
    let pinnedEmpty = false;
    let best = null;
    for (const candidate of pending) {
      const got = await fetchRange(candidate, 0, limit - 1);
      if (got === null) {
        probeErrors++;
        continue;
      }
      if (got.length === 0) {
        if (candidate.name === subjectFilter) pinnedEmpty = true;
        continue;
      }
      if (!best || got.length > best.rows.length) best = { subject: candidate, rows: got };
      if (got.length >= limit) break;
    }
    if (!best) {
      // 조회가 하나라도 실패했으면 done 이라고 말하지 않는다. 일시적 실패를 완료로
      // 읽으면 루틴이 남은 과목을 그대로 두고 끝난다.
      if (probeErrors > 0) {
        console.error(`과목 ${probeErrors}개의 조회가 실패해 완료 여부를 알 수 없다. 재시도할 것.`);
        process.exit(1);
      }
      console.log(
        JSON.stringify({
          done: true,
          reason: only
            ? `${subjectFilter} 의 해설에 concept_id 가 모두 붙음`
            : "정본 목록이 있는 과목의 해설에 concept_id 가 모두 붙음",
        }),
      );
      return;
    }
    if (pinnedEmpty && best.subject.name !== subjectFilter) {
      console.error(`${subjectFilter} 에는 미분류 해설이 없다. 다음 과목으로 넘어간다: ${best.subject.name}`);
    }
    subject = best.subject;
    rows = best.rows;
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
        // 이 과목의 끝물이라는 뜻. 다음 호출은 다른 과목으로 넘어간다.
        tail: items.length < limit,
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
