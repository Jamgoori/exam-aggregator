// 사용법:
//   node --env-file=.env.local scripts/seed-mock-exam-history.mjs [이메일] [--reset] [--dry-run]
//     [--subjects=컴퓨터일반,정보보호론] [--papers=30] [--score=60-90]
//   기본 이메일 = lks2354@gmail.com
//
// 한 계정에 "최근 일주일 동안 국어·영어·컴퓨터일반·정보보호론을 각각 2026년부터
// 최신 회차순으로 20회차씩 풀었고, 매 회차 70~90점을 받았다"는 응시 이력을 넣는다.
// 과목·회차 수·점수 범위는 위 옵션으로 그때그때 바꾼다(진단 화면을 특정 과목 조합으로
// 확인할 때가 많아서, 값을 고치는 대신 인자로 받는다).
// AI 약점 진단(막대그래프·개념 카드·맞춤 극복법)과 오답노트를 실데이터에 가깝게
// 확인하려는 용도다. seed-dummy-diagnosis.mjs 가 "개념 문항만" 골라 3회 응시를
// 만드는 최소 시드라면, 이쪽은 문제지를 통째로 채점한 정식 회차를 쌓는다.
//
// 채점 규칙은 서버 액션(app/papers/actions.ts submitCbtAttempt)을 그대로 따른다:
//   - total_questions = paper_answers.answers 길이
//   - voided_questions(정답 없음 처리된 문항)는 무조건 정답
//   - 모든 문항에 답을 고른 것으로 본다(건너뜀 없음)
// 그래야 회차별 평균·전국 오답률 같은 공개 통계가 실제 채점과 같은 모양으로 쌓인다.
//
// 어떤 문항을 틀리게 할지는 무작위가 아니라 "개념별 약점"을 심어서 고른다. 개념
// (question_explanations.keyword_title)마다 계정·과목 고정 시드로 약점 가중치를 뽑고,
// 가중치가 높은 개념부터 틀리게 한다 — 같은 개념이 여러 회차에 걸쳐 반복해서 틀려야
// 진단의 개념 분포·극복법이 의미 있는 모양이 된다.
//
// service_role 로 실행(RLS 우회). --reset 은 이 계정의 응시/문항상태/복습/진단 이력만
// 지운다(멤버십·출석·회원정보는 건드리지 않는다).

import { createClient } from "@supabase/supabase-js";

const DEFAULT_EMAIL = "lks2354@gmail.com";

// 시드할 과목(과목명 그대로). 순서는 로그 출력 순서일 뿐. --subjects= 로 덮어쓴다.
const DEFAULT_SUBJECT_NAMES = ["국어", "영어", "컴퓨터일반", "정보보호론"];
// 과목당 회차 수와, 회차를 고를 때의 최신 연도 상한. 회차 수는 --papers= 로 덮어쓴다.
const DEFAULT_PAPERS_PER_SUBJECT = 20;
const MAX_YEAR = 2026;
// 최근 일주일 안에서 며칠에 걸쳐 풀지(SPREAD_DAYS), 마지막 회차를 며칠 전에 둘지
// (LAST_ATTEMPT_DAYS_AGO). 둘 다 진단 화면의 기본 기간에 맞춰 고른 값이다:
// 진단을 받은 날부터 화면의 기본 창은 "지난 진단 이후"(=1일)가 되는데, 그 창에 푼
// 문제가 없으면 집계가 사다리를 타고 7일로 넓힌다(diagnosis-live.ts WIDEN_LADDER).
// 그래서 최근 24시간에는 응시를 두지 않고(2일 전에 끝내고), 전체가 7일 창 안에
// 들어오게(2~7일 전) 잡는다 — 진단을 받은 직후에 들어가도 일주일치 그래프가 통째로
// 보인다. 오늘까지 풀게 하면 그날 회차 몇 건만 남아 그래프가 비어 보인다.
const SPREAD_DAYS = 6;
const LAST_ATTEMPT_DAYS_AGO = 2;
// 점수(정답률 %) 하한·상한. 회차별 목표 점수는 이 사이에서만 움직인다.
// --score=60-90 으로 덮어쓴다(아래 SCORE_CURVE 가 그 폭에 맞춰 늘어난다).
const DEFAULT_SCORE_MIN = 70;
const DEFAULT_SCORE_MAX = 90;

// 과목별 점수 흐름(첫 회차 → 마지막 회차 목표 점수). 회차 순서는 "최신 회차부터"라
// 첫 회차가 2026년 문제지다. 진단의 과목별 추세(up/down/flat)가 과목마다 다르게
// 나오도록 일부러 다른 곡선을 준다. 값은 기본 폭(70~90) 기준이고, --score 로 폭을
// 바꾸면 같은 비율로 새 폭에 옮겨 담는다(rescaleCurve) — 그러지 않으면 폭만 넓히고
// 실제 점수는 예전 자리에 그대로 머물러 "60점짜리 회차가 왜 없지"가 된다.
const SCORE_CURVE = {
  국어: { from: 73, to: 88 },
  영어: { from: 86, to: 74 },
  컴퓨터일반: { from: 71, to: 89 },
  정보보호론: { from: 79, to: 81 },
};
// 과목별 학습 시간대(KST 기준 시작 시각). 같은 날 여러 회차를 풀면 뒤로 밀린다.
const SUBJECT_HOUR = { 국어: 9, 영어: 11, 컴퓨터일반: 14, 정보보호론: 20 };

// 문항당 평균 풀이 시간(초) 범위. duration_seconds 용.
const SECONDS_PER_QUESTION = [50, 75];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 문자열 → 32bit 시드. 같은 입력이면 언제 돌려도 같은 결과가 나오게 하려는 것
// (다시 돌렸을 때 점수·오답이 통째로 바뀌면 "왜 달라졌지"를 매번 확인해야 한다).
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 0~1 난수 하나. 시드 문자열만으로 결정된다.
function rand01(str) {
  let t = hashSeed(str) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

async function fetchAll(supabase, table, columns, apply) {
  const rows = [];
  let from = 0;
  const SIZE = 1000;
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + SIZE - 1);
    q = apply ? apply(q) : q;
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return rows;
}

async function findUserId(supabase, email) {
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`사용자 조회 실패: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < perPage) return null;
    page++;
  }
}

// 응시에서 파생되는 것만 지운다. 멤버십·출석·회원정보는 그대로 둔다.
// cbt_attempt_answers 는 cbt_attempts 의 on delete cascade 로 함께 지워진다.
async function resetUser(supabase, userId) {
  const targets = [
    "cbt_attempts",
    "cbt_attempt_starts",
    "user_question_status",
    "srs_reviews",
    "review_sessions",
    "wrong_note_marks",
    "ai_diagnoses",
  ];
  for (const table of targets) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    // 아직 마이그레이션이 안 된 환경이면 테이블이 없을 수 있다 — 초기화를 막지 않는다.
    if (error) console.warn(`  ${table} 삭제 건너뜀: ${error.message}`);
    else console.log(`  ${table} 삭제`);
  }
}

// KST 기준 시각을 ISO(UTC) 문자열로. dayFromToday=0 이면 오늘.
function kstIso(daysAgo, hour, minute) {
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const y = nowKst.getUTCFullYear();
  const m = nowKst.getUTCMonth();
  const d = nowKst.getUTCDate();
  const kstMs = Date.UTC(y, m, d - daysAgo, hour, minute, 0);
  return new Date(kstMs - KST_OFFSET_MS).toISOString();
}

// 목표 정답률(%)을 실제 문항 수로 옮긴다. 반올림 때문에 점수 범위 밖으로 나가지 않게
// 정답 수를 한 칸씩 당긴다(문항 수가 적은 문제지일수록 한 문항의 무게가 크다).
function correctCountFor(total, targetPct, scoreMin, scoreMax) {
  let correct = Math.round((total * targetPct) / 100);
  const pct = (c) => (c / total) * 100;
  while (correct > 0 && pct(correct) > scoreMax) correct--;
  while (correct < total && pct(correct) < scoreMin) correct++;
  return Math.max(0, Math.min(total, correct));
}

// 기본 폭(70~90) 기준으로 적어 둔 곡선을 실제 점수 폭으로 옮긴다. 기본 폭 안에서의
// 상대 위치(0~1)를 그대로 유지하므로 과목별 추세(오름/내림/평평)는 보존된다.
function rescaleCurve({ from, to }, scoreMin, scoreMax) {
  const span = DEFAULT_SCORE_MAX - DEFAULT_SCORE_MIN;
  const at = (v) => scoreMin + ((v - DEFAULT_SCORE_MIN) / span) * (scoreMax - scoreMin);
  return { from: at(from), to: at(to) };
}

// "60-90" → { min, max }. 형식이 틀리면 곧바로 세운다(잘못된 값으로 80회차를 넣고
// 나서 알아채면 다시 --reset 부터 해야 한다).
function parseScoreRange(raw) {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(raw.trim());
  if (!m) throw new Error(`--score 형식은 "60-90" 입니다: ${raw}`);
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (min >= max || max > 100) throw new Error(`--score 범위가 이상해요: ${raw}`);
  return { min, max };
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--")) || DEFAULT_EMAIL;
  const doReset = args.includes("--reset");
  const dryRun = args.includes("--dry-run");
  const opt = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };

  const subjectNames = (opt("subjects") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const SUBJECT_NAMES = subjectNames.length > 0 ? subjectNames : DEFAULT_SUBJECT_NAMES;
  const papersOpt = Number(opt("papers"));
  const PAPERS_PER_SUBJECT =
    Number.isInteger(papersOpt) && papersOpt > 0 ? papersOpt : DEFAULT_PAPERS_PER_SUBJECT;
  const scoreOpt = opt("score");
  const { min: SCORE_MIN, max: SCORE_MAX } = scoreOpt
    ? parseScoreRange(scoreOpt)
    : { min: DEFAULT_SCORE_MIN, max: DEFAULT_SCORE_MAX };
  console.log(
    `설정: 과목 ${SUBJECT_NAMES.join("·")} / 과목당 ${PAPERS_PER_SUBJECT}회차 / 점수 ${SCORE_MIN}~${SCORE_MAX}`,
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const userId = await findUserId(supabase, email);
  if (!userId) {
    console.error(`계정을 찾지 못했어요: ${email} (먼저 해당 이메일로 가입되어 있어야 합니다)`);
    process.exit(1);
  }
  console.log(`대상 계정: ${email} → ${userId}`);

  const { count: existing } = await supabase
    .from("cbt_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((existing ?? 0) > 0 && !doReset && !dryRun) {
    console.error(`이미 응시 기록이 ${existing}건 있어요. 초기화하고 다시 넣으려면 --reset 을 붙이세요.`);
    process.exit(1);
  }

  // 1) 과목.
  const { data: subjectRows, error: subjErr } = await supabase
    .from("subjects")
    .select("id, name, slug")
    .in("name", SUBJECT_NAMES);
  if (subjErr) throw new Error(`과목 조회 실패: ${subjErr.message}`);
  const subjects = SUBJECT_NAMES.map((name) => subjectRows.find((s) => s.name === name)).filter(Boolean);
  const missing = SUBJECT_NAMES.filter((n) => !subjects.some((s) => s.name === n));
  if (missing.length) {
    console.error(`과목을 찾지 못했어요: ${missing.join(", ")}`);
    process.exit(1);
  }

  // 2) 과목별 문제지: MAX_YEAR 이하에서 최신순 20개(정답표가 있는 것만).
  const plan = [];
  for (const subject of subjects) {
    const papers = await fetchAll(
      supabase,
      "exam_papers",
      "id, title, year, round, level, track, choice_count",
      (q) => q.eq("subject_id", subject.id).lte("year", MAX_YEAR).order("year", { ascending: false }),
    );
    const answersRows = [];
    for (const ids of chunk(papers.map((p) => p.id), 100)) {
      answersRows.push(
        ...(await fetchAll(supabase, "paper_answers", "paper_id, answers, voided_questions", (q) =>
          q.in("paper_id", ids),
        )),
      );
    }
    const answersByPaper = new Map(
      answersRows
        .filter((a) => Array.isArray(a.answers) && a.answers.length > 0)
        .map((a) => [a.paper_id, a]),
    );

    // 최신 회차순: 연도 내림차순 → 같은 해면 round 내림차순 → 제목순(안정 정렬).
    const usable = papers
      .filter((p) => answersByPaper.has(p.id))
      .sort(
        (a, b) => b.year - a.year || (b.round ?? 1) - (a.round ?? 1) || a.title.localeCompare(b.title),
      )
      .slice(0, PAPERS_PER_SUBJECT);

    if (usable.length < PAPERS_PER_SUBJECT) {
      console.warn(
        `  ⚠️ ${subject.name}: 정답표 있는 문제지가 ${usable.length}개뿐이라 그만큼만 넣습니다.`,
      );
    }
    plan.push({ subject, papers: usable, answersByPaper });
  }

  // 3) 문항 개념(keyword_title). 오답을 개념 쪽으로 몰아주기 위한 재료.
  const allPaperIds = plan.flatMap((p) => p.papers.map((x) => x.id));
  const questionRows = [];
  for (const ids of chunk(allPaperIds, 100)) {
    questionRows.push(
      ...(await fetchAll(supabase, "questions", "id, paper_id, question_number", (q) =>
        q.in("paper_id", ids),
      )),
    );
  }
  const keywordByQuestionId = new Map();
  for (const ids of chunk(questionRows.map((q) => q.id), 200)) {
    const rows = await fetchAll(supabase, "question_explanations", "question_id, keyword_title", (q) =>
      q.in("question_id", ids).not("keyword_title", "is", null),
    );
    for (const r of rows) {
      if (r.keyword_title && r.keyword_title.trim())
        keywordByQuestionId.set(r.question_id, r.keyword_title.trim());
    }
  }
  const conceptByKey = new Map(); // `${paperId}#${qnum}` → keyword_title
  for (const q of questionRows) {
    const kw = keywordByQuestionId.get(q.id);
    if (kw) conceptByKey.set(`${q.paper_id}#${q.question_number}`, kw);
  }

  // 4) 회차별 응시 생성.
  const attemptsToInsert = []; // { row, answers }
  const statusAgg = new Map(); // `${paperId}#${qnum}` → { wrong_count, last_is_correct, last_at }
  const summary = [];

  for (const { subject, papers, answersByPaper } of plan) {
    const curve = rescaleCurve(SCORE_CURVE[subject.name] ?? { from: 75, to: 85 }, SCORE_MIN, SCORE_MAX);
    const perDay = Math.ceil(papers.length / SPREAD_DAYS);
    // 하루치가 끝나는 시각이 자정을 넘지 않게 시작 시각을 당긴다. 회차 수를 늘리면
    // 하루에 푸는 양이 늘어 예전 시작 시각(예: 정보보호론 20시)으로는 다음 날 새벽까지
    // 밀렸다 — 그러면 "며칠에 걸쳐 풀었다"는 날짜 분포가 하루씩 어긋난다.
    const spanHours = Math.ceil(((perDay - 1) * 95 + 20) / 60);
    const baseHour = Math.max(7, Math.min(SUBJECT_HOUR[subject.name] ?? 10, 23 - spanHours));
    const scores = [];

    papers.forEach((paper, i) => {
      const key = answersByPaper.get(paper.id);
      const correctAnswers = key.answers;
      const voided = new Set(key.voided_questions ?? []);
      const total = correctAnswers.length;
      const choiceCount = paper.choice_count ?? 4;

      // 목표 점수: 곡선 + 회차 지터. 항상 점수 범위 안.
      const t = papers.length > 1 ? i / (papers.length - 1) : 0;
      const jitter = (rand01(`${userId}|${paper.id}|score`) - 0.5) * 8;
      const targetPct = Math.max(
        SCORE_MIN,
        Math.min(SCORE_MAX, curve.from + (curve.to - curve.from) * t + jitter),
      );
      const correctTarget = correctCountFor(total, targetPct, SCORE_MIN, SCORE_MAX);
      const wrongTarget = total - correctTarget;

      // 어떤 문항을 틀릴지: 개념 약점 가중치 내림차순. voided 문항은 무조건 정답이라 제외.
      const ranked = [];
      for (let n = 1; n <= total; n++) {
        if (voided.has(n)) continue;
        const concept = conceptByKey.get(`${paper.id}#${n}`) ?? null;
        // 개념이 잡힌 문항을 먼저 틀리게 한다(진단의 개념 분포가 여기서만 나온다).
        // 같은 개념은 과목 안에서 항상 같은 가중치를 받아 회차를 넘나들며 반복해 틀린다.
        const weight = concept
          ? 0.4 + 0.6 * rand01(`${userId}|${subject.slug}|concept|${concept}`)
          : 0.35 * rand01(`${userId}|${paper.id}|q${n}`);
        // 문항 지터: 약한 개념이라고 매번 다 틀리진 않게 살짝 흔든다.
        const noise = 0.12 * rand01(`${userId}|${paper.id}|noise|${n}`);
        ranked.push({ n, score: weight + noise });
      }
      ranked.sort((a, b) => b.score - a.score || a.n - b.n);
      const wrongSet = new Set(ranked.slice(0, wrongTarget).map((r) => r.n));

      // 채점(submitCbtAttempt 와 동일한 규칙).
      const answerRows = [];
      let score = 0;
      for (let idx = 0; idx < total; idx++) {
        const n = idx + 1;
        const correct = correctAnswers[idx];
        const isWrong = wrongSet.has(n);
        let selected;
        if (isWrong) {
          // 정답이 아닌 선지 하나를 고정적으로 고른다.
          const offset = 1 + Math.floor(rand01(`${userId}|${paper.id}|pick|${n}`) * (choiceCount - 1));
          selected = ((Number(correct) - 1 + offset) % choiceCount) + 1;
        } else {
          selected = Number.isFinite(Number(correct)) ? Number(correct) : 1;
        }
        const isCorrect = voided.has(n) || selected === correct;
        if (isCorrect) score++;
        answerRows.push({ question_number: n, selected_choice: selected, is_correct: isCorrect });
      }

      // 응시 시각: 최신 회차부터 순서대로, SPREAD_DAYS 에 걸쳐.
      const dayOffset = Math.min(SPREAD_DAYS - 1, Math.floor(i / perDay));
      const slot = i % perDay;
      const minutesInDay = slot * 95 + Math.floor(rand01(`${userId}|${paper.id}|min`) * 20);
      const createdAt = kstIso(
        SPREAD_DAYS - 1 - dayOffset + LAST_ATTEMPT_DAYS_AGO,
        baseHour + Math.floor(minutesInDay / 60),
        minutesInDay % 60,
      );

      const [lo, hi] = SECONDS_PER_QUESTION;
      const duration = Math.round(total * (lo + (hi - lo) * rand01(`${userId}|${paper.id}|dur`)));

      attemptsToInsert.push({
        row: {
          user_id: userId,
          paper_id: paper.id,
          score,
          total_questions: total,
          duration_seconds: duration,
          created_at: createdAt,
        },
        answers: answerRows,
        title: paper.title,
      });

      for (const a of answerRows) {
        const k = `${paper.id}#${a.question_number}`;
        const s = statusAgg.get(k) ?? { wrong_count: 0, last_is_correct: true, last_at: createdAt };
        if (!a.is_correct) s.wrong_count += 1;
        s.last_is_correct = a.is_correct;
        s.last_at = createdAt;
        statusAgg.set(k, s);
      }

      scores.push(Math.round((score / total) * 100));
    });

    summary.push({ subject: subject.name, count: papers.length, scores });
  }

  console.log("\n계획:");
  for (const s of summary) {
    console.log(`  ${s.subject}: ${s.count}회차, 점수 ${Math.min(...s.scores)}~${Math.max(...s.scores)} (${s.scores.join(", ")})`);
  }
  const wrongTotal = [...statusAgg.values()].filter((s) => s.wrong_count > 0).length;
  const wrongWithConcept = [...statusAgg.entries()].filter(
    ([k, s]) => s.wrong_count > 0 && conceptByKey.has(k),
  ).length;
  console.log(`  틀린 문항: ${wrongTotal}개 (개념 잡힌 문항 ${wrongWithConcept}개)`);

  if (dryRun) {
    console.log("\n--dry-run 이라 쓰지 않고 끝냅니다.");
    return;
  }

  if (doReset) {
    console.log("\n기존 이력 초기화:");
    await resetUser(supabase, userId);
  }

  console.log("\n입력 중...");
  for (const item of attemptsToInsert) {
    const { data: attempt, error } = await supabase
      .from("cbt_attempts")
      .insert(item.row)
      .select("id")
      .single();
    if (error || !attempt) throw new Error(`cbt_attempts insert 실패(${item.title}): ${error?.message}`);
    const rows = item.answers.map((a) => ({ attempt_id: attempt.id, ...a }));
    for (const part of chunk(rows, 500)) {
      const { error: ansErr } = await supabase.from("cbt_attempt_answers").insert(part);
      if (ansErr) throw new Error(`cbt_attempt_answers insert 실패(${item.title}): ${ansErr.message}`);
    }
  }

  const statusRows = [];
  for (const [key, s] of statusAgg) {
    const idx = key.lastIndexOf("#");
    statusRows.push({
      user_id: userId,
      paper_id: key.slice(0, idx),
      question_number: Number(key.slice(idx + 1)),
      wrong_count: s.wrong_count,
      last_is_correct: s.last_is_correct,
      last_answered_at: s.last_at,
      source: "cbt",
      updated_at: new Date().toISOString(),
    });
  }
  for (const part of chunk(statusRows, 500)) {
    const { error: uErr } = await supabase
      .from("user_question_status")
      .upsert(part, { onConflict: "user_id,paper_id,question_number" });
    if (uErr) throw new Error(`user_question_status upsert 실패: ${uErr.message}`);
  }

  console.log("\n완료:");
  console.log(`  응시(cbt_attempts): ${attemptsToInsert.length}건`);
  console.log(`  문항상태(user_question_status): ${statusRows.length}건`);
  console.log(`  틀린 문항: ${wrongTotal}개 (개념 잡힌 문항 ${wrongWithConcept}개)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
