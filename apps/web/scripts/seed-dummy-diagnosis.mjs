// 사용법:
//   node --env-file=.env.local scripts/seed-dummy-diagnosis.mjs [email] [--reset]
//   기본 email = lks2354@gmail.com
//
// 지정한 계정에 AI 약전진단/오답노트를 바로 써볼 수 있는 더미 데이터를 넣는다.
// 실제 기출 문제지(정답·해설 개념 keyword_title이 있는 것)를 골라, 그 계정이 CBT를
// 여러 회차 응시하고 일부를 틀린 것처럼 cbt_attempts/cbt_attempt_answers/
// user_question_status를 채운다. 그러면:
//   - 진단 페이지 막대그래프(과목별 틀린 개념)와 개념 카드가 라이브로 뜨고,
//   - 같은 개념 기출 5문제 풀기가 동작하고,
//   - 진단 자격(오답 15개 또는 응시 3회)을 넘겨 "진단받기"(맞춤 극복법)도 활성화된다.
// 극복법 생성 자체는 앱에서 ANTHROPIC_DIAGNOSIS_API_KEY가 있어야 채워진다(없으면 그래프/풀기만).
//
// service_role로 실행(RLS 우회). 되돌리려면 --reset 후 재실행(이 계정의 응시/상태만 삭제).

import { createClient } from "@supabase/supabase-js";

const DEFAULT_EMAIL = "lks2354@gmail.com";
const ROUNDS = 3; // 회차별 추세를 만들기 위한 응시 횟수
const TARGET_PAPERS = 4; // 시드할 문제지 수(과목 다양성 확보)
// 회차별로 틀리는 개념문항 비율(오래된 회차일수록 많이 틀림 → up 추세).
const WRONG_FRAC_BY_ROUND = [0.7, 0.45, 0.25];

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
  // auth.admin.listUsers 페이지네이션으로 이메일 매칭.
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

async function resetUser(supabase, userId) {
  // cbt_attempt_answers는 cbt_attempts on delete cascade로 함께 지워진다.
  await supabase.from("cbt_attempts").delete().eq("user_id", userId);
  await supabase.from("user_question_status").delete().eq("user_id", userId);
  console.log("기존 응시/문항상태 삭제 완료(리셋).");
}

// 정답 배열에서 문항의 정답 번호(1-base). 범위 밖이면 null.
function correctOf(answers, qnum, choiceCount) {
  const v = answers?.[qnum - 1];
  if (typeof v !== "number" || v < 1 || v > choiceCount) return null;
  return v;
}

function wrongChoice(correct, choiceCount) {
  for (let c = 1; c <= choiceCount; c++) if (c !== correct) return c;
  return correct; // choiceCount=1 같은 비정상 케이스 방어
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--")) || DEFAULT_EMAIL;
  const doReset = args.includes("--reset");

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
  if ((existing ?? 0) > 0 && !doReset) {
    console.error(
      `이미 응시 기록이 ${existing}건 있어요. 더미로 덮어쓰려면 --reset 을 붙여 다시 실행하세요.`,
    );
    process.exit(1);
  }
  if (doReset) await resetUser(supabase, userId);

  // 1) keyword_title이 있는 해설 → 문항. 개념 분포가 뜨려면 이 문항들이 오답에 포함돼야 한다.
  const expl = await fetchAll(supabase, "question_explanations", "question_id, keyword_title", (q) =>
    q.not("keyword_title", "is", null),
  );
  const keywordByQid = new Map();
  for (const e of expl) {
    if (e.keyword_title && e.keyword_title.trim())
      keywordByQid.set(e.question_id, e.keyword_title.trim());
  }
  const keywordQids = [...keywordByQid.keys()];
  if (keywordQids.length === 0) {
    console.error("keyword_title이 있는 해설이 없어 개념 분포 더미를 만들 수 없어요(해설 배치 먼저 필요).");
    process.exit(1);
  }

  // 2) 그 문항들의 (paper_id, question_number).
  const questions = [];
  for (const ids of chunk(keywordQids, 200)) {
    const rows = await fetchAll(supabase, "questions", "id, paper_id, question_number", (q) =>
      q.in("id", ids),
    );
    questions.push(...rows);
  }
  const byPaper = new Map(); // paper_id → [{qnum, qid}]
  for (const r of questions) {
    const arr = byPaper.get(r.paper_id) ?? [];
    arr.push({ qnum: r.question_number, qid: r.id });
    byPaper.set(r.paper_id, arr);
  }

  // 3) 후보 문제지 메타(정답·과목·선지수).
  const candidatePaperIds = [...byPaper.keys()];
  const paperMeta = new Map();
  for (const ids of chunk(candidatePaperIds, 100)) {
    const papers = await fetchAll(
      supabase,
      "exam_papers",
      "id, choice_count, subject_id, subjects(name, slug)",
      (q) => q.in("id", ids),
    );
    const ans = await fetchAll(supabase, "paper_answers", "paper_id, answers, voided_questions", (q) =>
      q.in("paper_id", ids),
    );
    const ansByPaper = new Map(ans.map((a) => [a.paper_id, a]));
    for (const p of papers) {
      const a = ansByPaper.get(p.id);
      if (!a || !Array.isArray(a.answers) || a.answers.length === 0) continue;
      paperMeta.set(p.id, {
        subjectSlug: p.subjects?.slug ?? null,
        subjectName: p.subjects?.name ?? null,
        choiceCount: p.choice_count ?? 4,
        answers: a.answers,
        voided: new Set(a.voided_questions ?? []),
      });
    }
  }

  // 4) 문제지 선택: 과목 다양성 우선 + keyworded 문항 수 내림차순.
  const usable = candidatePaperIds
    .filter((pid) => paperMeta.has(pid))
    .map((pid) => {
      const meta = paperMeta.get(pid);
      const qs = byPaper
        .get(pid)
        .filter(
          (q) => !meta.voided.has(q.qnum) && correctOf(meta.answers, q.qnum, meta.choiceCount) != null,
        );
      return { pid, meta, keyworded: qs };
    })
    .filter((p) => p.keyworded.length >= 3)
    .sort((a, b) => b.keyworded.length - a.keyworded.length);

  if (usable.length === 0) {
    console.error("정답+keyword_title을 갖춘 후보 문제지가 없어요.");
    process.exit(1);
  }

  const chosen = [];
  const seenSubjects = new Set();
  for (const p of usable) {
    if (chosen.length >= TARGET_PAPERS) break;
    if (p.meta.subjectSlug && seenSubjects.has(p.meta.subjectSlug)) continue;
    chosen.push(p);
    if (p.meta.subjectSlug) seenSubjects.add(p.meta.subjectSlug);
  }
  for (const p of usable) {
    if (chosen.length >= TARGET_PAPERS) break;
    if (chosen.includes(p)) continue;
    chosen.push(p);
  }

  console.log(
    `시드할 문제지 ${chosen.length}개:`,
    chosen.map((c) => `${c.meta.subjectName ?? "?"}(${c.keyworded.length}개념문항)`).join(", "),
  );

  // 5) 회차별 응시/문항응답/문항상태 생성.
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const statusAgg = new Map(); // `${paperId}#${qnum}` → { wrong_count, last_is_correct, last_at }
  let totalAttempts = 0;
  const wrongDistinct = new Set();

  for (const p of chosen) {
    const { pid, meta, keyworded } = p;
    const pool = keyworded;
    const total = pool.length;

    for (let r = 0; r < ROUNDS; r++) {
      const createdAt = new Date(now - (ROUNDS - r) * 7 * dayMs).toISOString();
      const wrongN = Math.max(1, Math.round(total * WRONG_FRAC_BY_ROUND[r]));
      const answersRows = [];
      let correctCount = 0;
      pool.forEach((q, idx) => {
        const correct = correctOf(meta.answers, q.qnum, meta.choiceCount);
        const isWrong = idx < wrongN;
        const selected = isWrong ? wrongChoice(correct, meta.choiceCount) : correct;
        const isCorrect = !isWrong;
        if (isCorrect) correctCount++;
        answersRows.push({ question_number: q.qnum, selected_choice: selected, is_correct: isCorrect });
        const key = `${pid}#${q.qnum}`;
        const s = statusAgg.get(key) ?? { wrong_count: 0, last_is_correct: true, last_at: createdAt };
        if (isWrong) {
          s.wrong_count += 1;
          wrongDistinct.add(key);
        }
        s.last_is_correct = isCorrect;
        s.last_at = createdAt;
        statusAgg.set(key, s);
      });

      const { data: attempt, error: aErr } = await supabase
        .from("cbt_attempts")
        .insert({
          user_id: userId,
          paper_id: pid,
          score: correctCount,
          total_questions: total,
          duration_seconds: 600 + r * 60,
          created_at: createdAt,
        })
        .select("id")
        .single();
      if (aErr || !attempt) throw new Error(`cbt_attempts insert 실패: ${aErr?.message}`);
      totalAttempts++;

      const rows = answersRows.map((a) => ({ attempt_id: attempt.id, ...a }));
      for (const part of chunk(rows, 500)) {
        const { error: ansErr } = await supabase.from("cbt_attempt_answers").insert(part);
        if (ansErr) throw new Error(`cbt_attempt_answers insert 실패: ${ansErr.message}`);
      }
    }
  }

  // 6) user_question_status upsert.
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

  console.log("완료:");
  console.log(`  응시(cbt_attempts): ${totalAttempts}건`);
  console.log(`  문항상태(user_question_status): ${statusRows.length}건`);
  console.log(`  틀린 개념문항(누적): ${wrongDistinct.size}개`);
  console.log("이제 해당 계정으로 로그인해 마이페이지 > AI 약점 진단에서 확인하세요.");
  console.log("맞춤 극복법까지 채우려면 오답노트의 '진단 받기'를 누르세요(ANTHROPIC_DIAGNOSIS_API_KEY 필요).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
