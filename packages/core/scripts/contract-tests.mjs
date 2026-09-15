#!/usr/bin/env node
// 계약 테스트 — 같은 입력을 (a) 웹 어댑터 경로(이 프로세스에서 @gongmoa/core/server 의 규칙을
// service_role 클라이언트로 직접 호출)와 (b) Edge Function 경로(`supabase functions serve` 에
// HTTP 로 호출)에 넣고, 로컬 DB 에 남는 결과 행이 같은지 스냅샷으로 비교한다.
// 무엇을·왜 보는지는 apps/web/docs/agents/contract-tests.md, 실행 환경은
// .github/workflows/contract-tests.yml.
//
//   npm run test:contract -w @gongmoa/core        (= node --import tsx scripts/contract-tests.mjs)
//
// 읽는 환경변수(워크플로가 `supabase status -o env` 에서 옮겨 준다):
//   SUPABASE_URL               없으면 **건너뛴다**(exit 0) — 로컬 `npm test` 를 막지 않는다.
//   SUPABASE_ANON_KEY          Edge 게이트웨이(verify_jwt)·사용자 로그인용.
//   SUPABASE_SERVICE_ROLE_KEY  admin 클라이언트(픽스처·스냅샷·웹 어댑터 경로).
//   SUPABASE_DB_URL            (선택) 지금은 쓰지 않는다 — 픽스처·정리는 전부 PostgREST 로 한다.
//   EDGE_BASE_URL              기본 `${SUPABASE_URL}/functions/v1`.
//
// 결정성: 규칙은 `now`/`fuzz` 를 인자로 받는다. 웹 경로는 opts 로 직접 넣고, Edge 경로는
// 요청 헤더 x-gongmoa-test-clock / x-gongmoa-test-fuzz 로 넣는다. Edge 는 그 헤더를
// **GONGMOA_TEST_HOOKS=1 환경변수가 있을 때만** 읽는다(_shared/clients.ts#testOverrides) —
// 워크플로가 `functions serve --env-file` 에만 넣는다. 프로덕션에는 절대 넣지 말 것.
//
// 사용자 두 명(웹 경로용·Edge 경로용)을 만들고, 케이스마다 두 사용자에게 같은 입력을 넣은
// 뒤 그 사용자의 행을 떠서 비교한다. 픽스처(과목·직렬·문제지 2장·문항·이미지·정답·해설)는
// 고정 UUID(00000000-0000-4000-8000-00000000c0xx)로 멱등 적재하고 끝에 지운다.
//
// 프로덕션 Supabase 를 가리키고 돌리지 말 것 — 정리 단계가 픽스처 행과 테스트 계정을 지운다.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ── 환경 ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  console.log(
    "contract-tests: SUPABASE_URL 이 없어 건너뛴다(로컬 Supabase 가 필요하다 — " +
      ".github/workflows/contract-tests.yml 또는 docs/dev-workflow.md 의 터미널 2 참고).",
  );
  process.exit(0);
}
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EDGE_BASE_URL = (process.env.EDGE_BASE_URL ?? `${SUPABASE_URL}/functions/v1`).replace(
  /\/+$/,
  "",
);
for (const [name, v] of [
  ["SUPABASE_ANON_KEY", ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
]) {
  if (!v) {
    console.error(`contract-tests: SUPABASE_URL 은 있는데 ${name} 이 없다.`);
    process.exit(1);
  }
}
if (/supabase\.co\b/.test(SUPABASE_URL)) {
  console.error(
    `contract-tests: SUPABASE_URL(${SUPABASE_URL}) 이 호스팅 Supabase 로 보인다 — 로컬 ` +
      "`supabase start` 만 허용한다(픽스처·계정 정리가 실제 행을 지운다).",
  );
  process.exit(1);
}

// core 규칙은 환경 검사 뒤에 읽는다 — 건너뛰기 경로가 tsx 변환·모듈 그래프에 의존하지 않게.
const core = await import("../src/server.ts");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HTTP_TIMEOUT_MS = 30_000;

// ── 고정 입력(양쪽에 똑같이 넣는 값) ──────────────────────────────────────────

// 시각은 FREE_UNTIL(전면 무료 기간) **뒤**로 둔다. 출석은 그 기간에 닫혀 있어(isAttendanceOpen)
// attendance_days 가 아예 안 남는데, 그러면 "출석 문항 1회분" 단언을 할 수 없다. 규칙이 시각을
// 인자로 받으므로 실제 날짜와 무관하게 이 값으로 판정된다. FREE_UNTIL 이 이보다 뒤로 밀리면
// 단언은 isAttendanceOpen(CLOCK) 을 따라 "행 없음" 으로 자동 전환된다.
const CLOCK = new Date("2027-08-01T10:00:00+09:00");
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const at = (offsetMs) => new Date(CLOCK.getTime() + offsetMs);
const FUZZ = 0.5;

// 픽스처 UUID. seed.sql 의 카탈로그(…0101/…0301)와 겹치지 않는 별도 대역.
const FX = {
  subject: "00000000-0000-4000-8000-00000000c001",
  examType: "00000000-0000-4000-8000-00000000c002",
  paper: "00000000-0000-4000-8000-00000000c301", // 응시 대상
  sibling: "00000000-0000-4000-8000-00000000c302", // dedup 형제(같은 메타·같은 정답)
  question: (paperIdx, n) => `00000000-0000-4000-8000-00000000c4${paperIdx}${String(n).padStart(1, "0")}`,
  image: (paperIdx, n) => `00000000-0000-4000-8000-00000000c5${paperIdx}${String(n).padStart(1, "0")}`,
  explanation: (n) => `00000000-0000-4000-8000-00000000c60${n}`,
};
const QUESTION_COUNT = 5;
const ANSWERS = [1, 2, 3, 4, 5];
const VOIDED = [5];

// CBT 제출 답안: 3문항 답함(1·2·3번), 그중 3번이 오답(4≠3), 4번 미답(오답), 5번은 voided(무조건 정답).
const CBT_ANSWERS = [1, 2, 4, null, null];
const CBT_EXPECT = { score: 3, answered: 3, wrong: [3, 4] };

const TEST_PASSWORD = "contract-test-Passw0rd!";
const USERS = {
  web: { email: "contract-web@example.test", id: null, jwt: null },
  edge: { email: "contract-edge@example.test", id: null, jwt: null },
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function fail(message) {
  const e = new Error(message);
  e.contract = true;
  return e;
}

function must(result, what) {
  if (result.error) throw fail(`${what}: ${result.error.message ?? JSON.stringify(result.error)}`);
  return result.data;
}

function assert(cond, message) {
  if (!cond) throw fail(message);
}

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw fail(`${what}: 기대 ${b}, 실제 ${a}`);
}

// 응답 JSON 어디에도 특정 키가 없는지(정답·출처 유출 검사).
function findKeys(value, banned, path = "$", hits = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findKeys(v, banned, `${path}[${i}]`, hits));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (banned.includes(k)) hits.push(`${path}.${k}`);
      findKeys(v, banned, `${path}.${k}`, hits);
    }
  }
  return hits;
}

// ── Edge 호출 ────────────────────────────────────────────────────────────────

// 게이트웨이(verify_jwt)는 JWT 가 있어야 통과시키므로 비로그인 호출도 anon key 를 Bearer 로
// 보낸다(supabase-js functions.invoke 가 세션이 없을 때 하는 것과 같다).
async function edge(fn, body, { jwt = null, now = null, fuzz = null } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt ?? ANON_KEY}`,
  };
  if (now) headers["x-gongmoa-test-clock"] = now.toISOString();
  if (fuzz !== null) headers["x-gongmoa-test-fuzz"] = String(fuzz);

  let res;
  try {
    res = await fetch(`${EDGE_BASE_URL}/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw fail(`Edge ${fn}: 요청 실패(${e?.name ?? ""} ${e?.message ?? e}) — functions serve 가 떠 있나?`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw fail(`Edge ${fn}: JSON 이 아닌 응답(${res.status}): ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

// ── 사용자 ───────────────────────────────────────────────────────────────────

async function deleteTestUsersIfAny() {
  const emails = new Set(Object.values(USERS).map((u) => u.email));
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw fail(`auth.admin.listUsers: ${error.message}`);
    for (const u of data.users) {
      if (emails.has(u.email)) {
        const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
        if (delErr) throw fail(`auth.admin.deleteUser(${u.email}): ${delErr.message}`);
      }
    }
    if (data.users.length < 200) break;
    page++;
  }
}

async function createTestUsers() {
  await deleteTestUsersIfAny();
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const user of Object.values(USERS)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw fail(`auth.admin.createUser(${user.email}): ${error.message}`);
    user.id = data.user.id;
    const signIn = await anon.auth.signInWithPassword({ email: user.email, password: TEST_PASSWORD });
    if (signIn.error) {
      throw fail(
        `signInWithPassword(${user.email}): ${signIn.error.message} — config.toml [auth.email] enable_signup 확인`,
      );
    }
    user.jwt = signIn.data.session.access_token;
  }
}

// 케이스 사이에 사용자 행을 비운다(픽스처·계정은 그대로).
const USER_TABLES = [
  "cbt_attempt_starts",
  "cbt_attempts", // cbt_attempt_answers 는 cascade
  "user_question_status",
  "srs_reviews",
  "review_sessions", // review_session_items 는 cascade
  "attendance_days",
  "attendance_grants",
  "explanation_daily_views",
  "explanation_access_log",
  "wrong_note_marks",
];
async function resetUsers() {
  for (const user of Object.values(USERS)) {
    for (const table of USER_TABLES) {
      must(await admin.from(table).delete().eq("user_id", user.id), `reset ${table}`);
    }
  }
}

// ── 픽스처 ───────────────────────────────────────────────────────────────────

async function ensureFixtures() {
  const ignoreDup = { onConflict: "id", ignoreDuplicates: true };
  must(
    await admin
      .from("subjects")
      .upsert({ id: FX.subject, slug: "contract-subject", name: "계약테스트", display_order: 999 }, ignoreDup),
    "fixture subjects",
  );
  must(
    await admin
      .from("exam_types")
      .upsert({ id: FX.examType, name: "계약테스트직", display_order: 999 }, ignoreDup),
    "fixture exam_types",
  );
  // 두 장은 dedup 키(과목·직렬·연도·회차·급수)가 같고 정답도 같다 → 같은 시험지로 접힌다.
  const paperBase = {
    subject_id: FX.subject,
    exam_type_id: FX.examType,
    year: 2027,
    round: 1,
    level: "9급",
    question_count: QUESTION_COUNT,
    choice_count: 5,
  };
  must(
    await admin.from("exam_papers").upsert(
      [
        {
          ...paperBase,
          id: FX.paper,
          title: "2027 계약테스트직 9급 계약테스트",
          track: null,
          file_path: "fixtures/contract-paper.pdf",
          file_name: "contract-paper.pdf",
        },
        {
          ...paperBase,
          id: FX.sibling,
          title: "2027 계약테스트직 9급 계약테스트 (형제)",
          track: "형제직류",
          file_path: "fixtures/contract-sibling.pdf",
          file_name: "contract-sibling.pdf",
        },
      ],
      ignoreDup,
    ),
    "fixture exam_papers",
  );
  const questions = [];
  const images = [];
  for (const [paperIdx, paperId] of [
    [1, FX.paper],
    [2, FX.sibling],
  ]) {
    for (let n = 1; n <= QUESTION_COUNT; n++) {
      questions.push({ id: FX.question(paperIdx, n), paper_id: paperId, question_number: n, choice_count: 5 });
      images.push({
        id: FX.image(paperIdx, n),
        question_id: FX.question(paperIdx, n),
        order_index: 0,
        image_path: `fixtures/contract/${paperIdx}/${n}.png`,
      });
    }
  }
  must(await admin.from("questions").upsert(questions, ignoreDup), "fixture questions");
  must(await admin.from("question_images").upsert(images, ignoreDup), "fixture question_images");
  must(
    await admin.from("paper_answers").upsert(
      [FX.paper, FX.sibling].map((paper_id) => ({ paper_id, answers: ANSWERS, voided_questions: VOIDED })),
      { onConflict: "paper_id" },
    ),
    "fixture paper_answers",
  );
  // 해설은 응시 문제지 5문항 전부 — 비로그인 미리보기(ANON_PREVIEW_CARDS)가 잘라내는 걸 보려면
  // 미리보기 수보다 많아야 한다.
  must(
    await admin.from("question_explanations").upsert(
      Array.from({ length: QUESTION_COUNT }, (_, i) => ({
        id: FX.explanation(i + 1),
        question_id: FX.question(1, i + 1),
        keyword_title: `계약테스트 ${i + 1}번`,
        keyword_explanation: "계약 테스트용 해설 본문.",
        correct_choice_number: ANSWERS[i],
        verified: true,
      })),
      ignoreDup,
    ),
    "fixture question_explanations",
  );
}

async function removeFixtures() {
  // exam_papers 를 지우면 questions/images/answers/explanations/status/sessions 가 cascade.
  await admin.from("exam_papers").delete().in("id", [FX.paper, FX.sibling]);
  await admin.from("exam_types").delete().eq("id", FX.examType);
  await admin.from("subjects").delete().eq("id", FX.subject);
}

// ── 스냅샷 ───────────────────────────────────────────────────────────────────

// 비교에서 제외하는 열(서버 생성 id·사용자 id·DB now() 기본값 시각). 주입한 시각으로 계산되는 열
// (last_answered_at·srs_due_at·reviewed_at·submitted_at·started_at·attend_date)은 그대로 비교한다.
// flags 는 "값이 있는지"만 비교하는 열(DB now() 인데 null/비null 자체가 의미인 경우).
const SNAPSHOT = {
  cbt_attempt_starts: { ignore: ["user_id"], sortBy: ["paper_id"] },
  cbt_attempts: { ignore: ["id", "user_id", "created_at"], sortBy: ["paper_id", "score"] },
  cbt_attempt_answers: { ignore: ["id", "attempt_id"], sortBy: ["question_number"] },
  user_question_status: { ignore: ["user_id"], sortBy: ["paper_id", "question_number"] },
  srs_reviews: { ignore: ["id", "user_id"], sortBy: ["paper_id", "question_number"] },
  review_sessions: { ignore: ["id", "user_id", "created_at", "request_id"], sortBy: ["scope"] },
  // position 은 뽑기 순서가 무작위라 제외하고 (문제지, 문항) 로 정렬해 비교한다.
  review_session_items: { ignore: ["id", "session_id", "position"], sortBy: ["paper_id", "question_number"] },
  attendance_days: { ignore: ["user_id", "updated_at"], flags: ["qualified_at"], sortBy: ["attend_date"] },
  memberships: { ignore: ["user_id", "updated_at"], flags: ["started_at", "expires_at"], sortBy: ["tier"] },
};

async function snapshot(userId) {
  const out = {};
  for (const table of Object.keys(SNAPSHOT)) {
    if (table === "cbt_attempt_answers" || table === "review_session_items") continue;
    out[table] = must(await admin.from(table).select("*").eq("user_id", userId), `snapshot ${table}`);
  }
  const attemptIds = out.cbt_attempts.map((r) => r.id);
  out.cbt_attempt_answers =
    attemptIds.length === 0
      ? []
      : must(
          await admin.from("cbt_attempt_answers").select("*").in("attempt_id", attemptIds),
          "snapshot cbt_attempt_answers",
        );
  const sessionIds = out.review_sessions.map((r) => r.id);
  out.review_session_items =
    sessionIds.length === 0
      ? []
      : must(
          await admin.from("review_session_items").select("*").in("session_id", sessionIds),
          "snapshot review_session_items",
        );
  return out;
}

function normalizeRows(rows, { ignore = [], flags = [], sortBy = [] } = {}) {
  const cleaned = rows.map((row) => {
    const r = {};
    for (const key of Object.keys(row).sort()) {
      if (ignore.includes(key)) continue;
      r[key] = flags.includes(key) ? (row[key] == null ? null : "<set>") : row[key];
    }
    return r;
  });
  cleaned.sort((a, b) => {
    for (const k of sortBy) {
      const x = String(a[k] ?? "");
      const y = String(b[k] ?? "");
      if (x !== y) return x < y ? -1 : 1;
    }
    return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
  });
  return cleaned;
}

// 줄 단위 LCS diff(스냅샷은 수백 줄 이내라 O(n·m) 으로 충분).
function unifiedDiff(aText, bText, context = 3) {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i]]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push(["-", a[i++]]);
    } else {
      ops.push(["+", b[j++]]);
    }
  }
  while (i < n) ops.push(["-", a[i++]]);
  while (j < m) ops.push(["+", b[j++]]);

  const keep = new Array(ops.length).fill(false);
  ops.forEach(([op], k) => {
    if (op === " ") return;
    for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c++) keep[c] = true;
  });
  const lines = ["--- web", "+++ edge"];
  let inHunk = false;
  ops.forEach(([op, text], k) => {
    if (!keep[k]) {
      if (inHunk) lines.push("@@");
      inHunk = false;
      return;
    }
    inHunk = true;
    lines.push(`${op}${text}`);
  });
  return lines.join("\n");
}

// 두 스냅샷(또는 두 행 배열)을 정규화해 비교한다. 다르면 diff 를 담은 오류를 던진다.
function compareRows(webRows, edgeRows, opts = {}) {
  const a = JSON.stringify(normalizeRows(webRows, opts), null, 2);
  const b = JSON.stringify(normalizeRows(edgeRows, opts), null, 2);
  if (a === b) return;
  throw fail(`${opts.label ?? "rows"} 스냅샷이 다르다:\n${unifiedDiff(a, b)}`);
}

function compareSnapshots(webSnap, edgeSnap, { only = null } = {}) {
  for (const [table, cfg] of Object.entries(SNAPSHOT)) {
    if (only && !only.includes(table)) continue;
    compareRows(webSnap[table], edgeSnap[table], { ...cfg, label: table });
  }
}

// ── 케이스 러너 ──────────────────────────────────────────────────────────────

const results = [];
async function runCase(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - startedAt}ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`FAIL  ${name} (${Date.now() - startedAt}ms)`);
    console.log(indent(e?.contract ? e.message : (e?.stack ?? String(e))));
  }
}
function indent(text) {
  return String(text)
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}

// 웹 어댑터 경로(규칙 직접 호출)와 Edge 경로를 나란히 두는 헬퍼들.
const web = {
  cbtStart: (now) => core.startCbtAttempt(admin, USERS.web.id, FX.paper, now),
  cbtSubmit: (answers, now) =>
    core.submitCbtAttempt(admin, USERS.web.id, FX.paper, answers, {
      now,
      questionStatus: { fuzz: () => FUZZ },
    }),
  reviewCreateAll: (requestId) =>
    core.createAllReviewSessionForUser(admin, admin, USERS.web.id, { requestId, limit: 20 }),
  reviewSubmit: (sessionId, answers, now) =>
    core.submitReviewSessionForUser(admin, admin, USERS.web.id, sessionId, answers, {
      now,
      questionStatus: { fuzz: () => FUZZ },
    }),
  membership: () => core.getMembership(admin, USERS.web.id),
};
const edgeUser = {
  cbtStart: (now) => edge("cbt-start", { paperId: FX.paper }, { jwt: USERS.edge.jwt, now }),
  cbtSubmit: (answers, now) =>
    edge("cbt-submit", { paperId: FX.paper, answers }, { jwt: USERS.edge.jwt, now, fuzz: FUZZ }),
  reviewCreateAll: (requestId) => edge("review-create", { requestId }, { jwt: USERS.edge.jwt }),
  reviewSubmit: (sessionId, answers, now) =>
    edge("review-submit", { sessionId, answers }, { jwt: USERS.edge.jwt, now, fuzz: FUZZ }),
  membership: () => edge("membership-get", {}, { jwt: USERS.edge.jwt }),
};

// Edge 가 테스트 훅을 실제로 읽는지 먼저 확인한다 — 안 읽으면 모든 시각 단언이 엉뚱한 이유로
// 깨지므로, 그 경우엔 원인을 하나로 못박아 준다.
async function probeTestHooks() {
  const res = await edgeUser.cbtStart(CLOCK);
  if (res.status !== 200 || res.body?.startedAt !== CLOCK.toISOString()) {
    throw fail(
      `Edge 가 x-gongmoa-test-clock 을 반영하지 않았다(status ${res.status}, startedAt ${res.body?.startedAt}). ` +
        "functions serve 의 --env-file 에 GONGMOA_TEST_HOOKS=1 이 있는지, cbt-start 가 testOverrides 를 쓰는지 확인.",
    );
  }
  must(await admin.from("cbt_attempt_starts").delete().eq("user_id", USERS.edge.id), "probe cleanup");
}

// ── 케이스 ───────────────────────────────────────────────────────────────────

// (g) #10 체험 1회 — getMembership(웹) / membership-get(Edge) 두 번 → started_at 은 처음 한 번만 채워진다.
// 체험은 trial_consumptions 원장에 이메일 해시를 남겨 다시 켤 수 없으므로 CBT(채점이 체험을 켠다)보다
// **먼저** 돈다.
async function caseTrialOnce() {
  const before = await snapshot(USERS.web.id);
  assert(before.memberships.length === 1, "가입 트리거(trg_create_membership)가 memberships 행을 만들지 않았다");
  assert(before.memberships[0].started_at === null, "테스트 계정의 체험이 이미 켜져 있다");

  await web.membership();
  const webFirst = await snapshot(USERS.web.id);
  await web.membership();
  const webSecond = await snapshot(USERS.web.id);

  const e1 = await edgeUser.membership();
  assert(e1.status === 200, `membership-get 1회차 ${e1.status}: ${JSON.stringify(e1.body)}`);
  const edgeFirst = await snapshot(USERS.edge.id);
  const e2 = await edgeUser.membership();
  assert(e2.status === 200, `membership-get 2회차 ${e2.status}`);
  const edgeSecond = await snapshot(USERS.edge.id);

  for (const [label, snap] of [
    ["web", webFirst],
    ["edge", edgeFirst],
  ]) {
    assert(snap.memberships[0]?.started_at, `${label}: 첫 호출 뒤 memberships.started_at 이 비어 있다`);
  }
  // 두 번째 호출이 아무것도 바꾸지 않았는지 — updated_at 까지 포함해 원시 행으로 본다.
  assertEqual(webSecond.memberships, webFirst.memberships, "web: 두 번째 getMembership 이 memberships 를 바꿨다");
  assertEqual(edgeSecond.memberships, edgeFirst.memberships, "edge: 두 번째 membership-get 이 memberships 를 바꿨다");
  compareSnapshots(webFirst, edgeFirst, { only: ["memberships"] });
  assertEqual(e1.body.isPremium, core.isPremiumMembership(await web.membership()), "isPremium 판정이 웹과 다르다");
}

// (f) #8(일부) 해설 비로그인 — 미리보기 ANON_PREVIEW_CARDS 문항만, 한도·일일 몫 로그는 남지 않는다.
// 웹의 비로그인 해설 페이지는 규칙(resolveExplanationAccess)을 부르지 않으므로 이 케이스는 Edge 응답을
// core 상수로 검사하는 것이고, 양쪽 행 비교는 없다.
async function caseExplanationsAnonymous() {
  const res = await edge("explanations-get", { paperId: FX.paper });
  assert(res.status === 200, `explanations-get ${res.status}: ${JSON.stringify(res.body)}`);
  const b = res.body;
  assertEqual(b.loggedIn, false, "loggedIn");
  assertEqual(b.hasFullAccess, false, "hasFullAccess");
  assertEqual(b.lockReason, null, "lockReason(비로그인은 한도 판정 대상이 아니다)");
  assertEqual(b.totalCount, QUESTION_COUNT, "totalCount");
  assertEqual(b.questions.length, core.ANON_PREVIEW_CARDS, "미리보기 문항 수");
  assertEqual(b.hiddenCount, QUESTION_COUNT - core.ANON_PREVIEW_CARDS, "hiddenCount");
  for (const table of ["explanation_access_log", "explanation_daily_views"]) {
    const rows = must(await admin.from(table).select("*").eq("paper_id", FX.paper), table);
    assert(rows.length === 0, `${table} 에 비로그인 조회 행이 남았다(${rows.length})`);
  }
}

// (a) #1 CBT 시작 → 제출(voided 포함). 응답 본문과 결과 행을 모두 비교한다.
async function caseCbtSubmit() {
  await resetUsers();
  const T_START = CLOCK;
  const T_SUBMIT = at(120 * SECOND);

  const ws = await web.cbtStart(T_START);
  assert(!core.isCbtRuleError(ws), `web cbt start: ${ws.error}`);
  const wr = await web.cbtSubmit(CBT_ANSWERS, T_SUBMIT);
  assert(!core.isCbtRuleError(wr), `web cbt submit: ${wr.error}`);

  const es = await edgeUser.cbtStart(T_START);
  assert(es.status === 200, `edge cbt-start ${es.status}: ${JSON.stringify(es.body)}`);
  const er = await edgeUser.cbtSubmit(CBT_ANSWERS, T_SUBMIT);
  assert(er.status === 200, `edge cbt-submit ${er.status}: ${JSON.stringify(er.body)}`);

  // 응답 계약(추가 필드 제외한 채점 결과)이 같은가.
  const pick = (r) => ({
    score: r.score,
    totalQuestions: r.totalQuestions,
    durationSeconds: r.durationSeconds,
    voidedQuestions: r.voidedQuestions,
    questionResults: r.questionResults,
  });
  assertEqual(pick(er.body), pick(wr), "cbt-submit 응답 채점 결과");
  assertEqual(wr.score, CBT_EXPECT.score, "score");
  assertEqual(wr.durationSeconds, 120, "durationSeconds");

  const webSnap = await snapshot(USERS.web.id);
  const edgeSnap = await snapshot(USERS.edge.id);
  for (const [label, snap] of [
    ["web", webSnap],
    ["edge", edgeSnap],
  ]) {
    assertEqual(snap.cbt_attempts.length, 1, `${label}: cbt_attempts 행 수`);
    assertEqual(snap.cbt_attempt_answers.length, QUESTION_COUNT, `${label}: cbt_attempt_answers 행 수`);
    assertEqual(snap.cbt_attempt_starts.length, 0, `${label}: 시작 행이 회수되지 않았다`);
    const status = new Map(snap.user_question_status.map((r) => [r.question_number, r]));
    assertEqual(status.size, QUESTION_COUNT, `${label}: user_question_status 행 수`);
    for (let n = 1; n <= QUESTION_COUNT; n++) {
      const row = status.get(n);
      const wrong = CBT_EXPECT.wrong.includes(n);
      assertEqual(row.wrong_count, wrong ? 1 : 0, `${label}: ${n}번 wrong_count`);
      assertEqual(row.last_is_correct, !wrong, `${label}: ${n}번 last_is_correct`);
      assertEqual(row.source, "cbt", `${label}: ${n}번 source`);
      assertEqual(row.srs_due_at, null, `${label}: ${n}번 srs_due_at(새 오답은 대기 풀)`);
      assertEqual(new Date(row.last_answered_at).toISOString(), T_SUBMIT.toISOString(), `${label}: ${n}번 last_answered_at`);
    }
    assertEqual(snap.srs_reviews.length, 0, `${label}: 대기 풀 채점은 srs_reviews 에 남지 않는다`);
    if (core.isAttendanceOpen(T_SUBMIT)) {
      assertEqual(snap.attendance_days.length, 1, `${label}: attendance_days 행 수`);
      assertEqual(snap.attendance_days[0].question_count, CBT_EXPECT.answered, `${label}: attendance question_count(답한 문항만)`);
      assertEqual(snap.attendance_days[0].attend_date, core.kstDateKey(T_SUBMIT), `${label}: attend_date`);
    } else {
      assertEqual(snap.attendance_days.length, 0, `${label}: 출석이 닫힌 시각엔 attendance_days 가 없어야 한다`);
    }
  }
  compareSnapshots(webSnap, edgeSnap);
}

// (b) #2 90초 미만 제출 — 양쪽 같은 문구로 거절, 시작 행은 그대로.
async function caseCbtTooEarly() {
  await resetUsers();
  const T_SUBMIT = at(30 * SECOND);
  const ws = await web.cbtStart(CLOCK);
  assert(!core.isCbtRuleError(ws), `web cbt start: ${ws.error}`);
  const wr = await web.cbtSubmit(CBT_ANSWERS, T_SUBMIT);
  assert(core.isCbtRuleError(wr), "web: 90초 미만 제출이 통과했다");

  const es = await edgeUser.cbtStart(CLOCK);
  assert(es.status === 200, `edge cbt-start ${es.status}`);
  const er = await edgeUser.cbtSubmit(CBT_ANSWERS, T_SUBMIT);
  assert(er.status === 400, `edge: 90초 미만 제출이 ${er.status} 로 끝났다: ${JSON.stringify(er.body)}`);

  assertEqual(er.body.error, wr.error, "거절 문구");
  assert(wr.error.includes("초 후에 다시 시도"), `거절 문구가 예상과 다르다: ${wr.error}`);

  const webSnap = await snapshot(USERS.web.id);
  const edgeSnap = await snapshot(USERS.edge.id);
  for (const [label, snap] of [
    ["web", webSnap],
    ["edge", edgeSnap],
  ]) {
    assertEqual(snap.cbt_attempts.length, 0, `${label}: 거절됐는데 cbt_attempts 가 생겼다`);
    assertEqual(snap.cbt_attempt_starts.length, 1, `${label}: 시작 행이 복구되지 않았다`);
    assertEqual(new Date(snap.cbt_attempt_starts[0].started_at).toISOString(), CLOCK.toISOString(), `${label}: 복구된 started_at`);
  }
  compareSnapshots(webSnap, edgeSnap);
}

// (c) #4 동시 제출 2건 — 정확히 한쪽만 채점. cbt_attempts 1행, wrong_count +1, 출석 1회분.
async function caseCbtDoubleSubmit() {
  await resetUsers();
  const T_SUBMIT = at(120 * SECOND);

  const ws = await web.cbtStart(CLOCK);
  assert(!core.isCbtRuleError(ws), `web cbt start: ${ws.error}`);
  const [w1, w2] = await Promise.all([web.cbtSubmit(CBT_ANSWERS, T_SUBMIT), web.cbtSubmit(CBT_ANSWERS, T_SUBMIT)]);
  const webOk = [w1, w2].filter((r) => !core.isCbtRuleError(r));
  const webErr = [w1, w2].filter((r) => core.isCbtRuleError(r));
  assertEqual(webOk.length, 1, `web: 동시 제출 성공 수(${JSON.stringify([w1, w2].map((r) => r.error ?? "ok"))})`);
  assertEqual(webErr[0].error, "새로고침 후 다시 시작해주세요.", "web: 두 번째 제출 거절 문구");

  const es = await edgeUser.cbtStart(CLOCK);
  assert(es.status === 200, `edge cbt-start ${es.status}`);
  const [e1, e2] = await Promise.all([edgeUser.cbtSubmit(CBT_ANSWERS, T_SUBMIT), edgeUser.cbtSubmit(CBT_ANSWERS, T_SUBMIT)]);
  const edgeOk = [e1, e2].filter((r) => r.status === 200);
  const edgeErr = [e1, e2].filter((r) => r.status !== 200);
  assertEqual(edgeOk.length, 1, `edge: 동시 제출 성공 수(${JSON.stringify([e1, e2].map((r) => r.body?.error ?? r.status))})`);
  assertEqual(edgeErr[0].status, 400, "edge: 두 번째 제출 상태");
  assertEqual(edgeErr[0].body.error, webErr[0].error, "두 번째 제출 거절 문구");

  const webSnap = await snapshot(USERS.web.id);
  const edgeSnap = await snapshot(USERS.edge.id);
  for (const [label, snap] of [
    ["web", webSnap],
    ["edge", edgeSnap],
  ]) {
    assertEqual(snap.cbt_attempts.length, 1, `${label}: cbt_attempts 행 수`);
    const q3 = snap.user_question_status.find((r) => r.question_number === 3);
    assertEqual(q3?.wrong_count, 1, `${label}: wrong_count 가 한 번만 올라야 한다`);
    if (core.isAttendanceOpen(T_SUBMIT)) {
      assertEqual(snap.attendance_days[0]?.question_count, CBT_EXPECT.answered, `${label}: 출석 문항이 1회분이어야 한다`);
    }
  }
  compareSnapshots(webSnap, edgeSnap);
}

// (d) #13·#15 review-create(scope all, requestId) 두 번 → 세션 1개, 응답에 paperId/correctChoice 없음.
// (a) 가 남긴 오답(3·4번)이 후보다.
const REQUEST_ID = randomUUID();
const created = { web: null, edge: null };
async function caseReviewCreateIdempotent() {
  for (const user of Object.values(USERS)) {
    const wrong = must(
      await admin.from("user_question_status").select("question_number").eq("user_id", user.id).gt("wrong_count", 0),
      "precondition",
    );
    assert(wrong.length === CBT_EXPECT.wrong.length, `${user.email}: (a) 케이스가 남긴 오답 상태가 없다 — 앞 케이스 실패`);
  }

  const w1 = await web.reviewCreateAll(REQUEST_ID);
  assert(w1.sessionId, `web review create: ${w1.error}`);
  const w2 = await web.reviewCreateAll(REQUEST_ID);
  assertEqual(w2.sessionId, w1.sessionId, "web: 같은 requestId 가 다른 세션을 만들었다");
  created.web = w1.sessionId;

  const e1 = await edgeUser.reviewCreateAll(REQUEST_ID);
  assert(e1.status === 200, `edge review-create ${e1.status}: ${JSON.stringify(e1.body)}`);
  const e2 = await edgeUser.reviewCreateAll(REQUEST_ID);
  assert(e2.status === 200, `edge review-create 2회차 ${e2.status}`);
  assertEqual(e2.body.sessionId, e1.body.sessionId, "edge: 같은 requestId 가 다른 세션을 만들었다");
  created.edge = e1.body.sessionId;

  const leaks = findKeys(e1.body, ["paperId", "correctChoice", "paperTitle", "questionNumber"]);
  assert(leaks.length === 0, `review-create 응답에 정답·출처가 실렸다: ${leaks.join(", ")}`);
  assertEqual(e1.body.total, CBT_EXPECT.wrong.length, "review-create total");

  const webSnap = await snapshot(USERS.web.id);
  const edgeSnap = await snapshot(USERS.edge.id);
  for (const [label, snap] of [
    ["web", webSnap],
    ["edge", edgeSnap],
  ]) {
    assertEqual(snap.review_sessions.length, 1, `${label}: review_sessions 행 수`);
    assertEqual(snap.review_session_items.length, CBT_EXPECT.wrong.length, `${label}: review_session_items 행 수`);
    assertEqual(snap.review_sessions[0].submitted_at, null, `${label}: 생성 직후 submitted_at`);
  }
  compareSnapshots(webSnap, edgeSnap, { only: ["review_sessions", "review_session_items"] });
}

// (e) #5·#6 review-submit 두 번 — 두 번째는 "이미 채점된 세션이에요.", 상태·srs_reviews 는 1회분, source=review.
// 스케줄이 있는 문항만 srs_reviews 에 남으므로, 승격(review-queue)을 흉내 내 양쪽 사용자에게 같은 스케줄을 심는다.
async function caseReviewSubmitOnce() {
  assert(created.web && created.edge, "(d) 케이스가 세션을 만들지 못했다");
  const T_SUBMIT = at(2 * DAY);
  const promoted = {
    srs_due_at: at(1 * DAY).toISOString(),
    srs_interval_days: 1,
    srs_ease: 2.5,
    srs_reps: 0,
    srs_lapses: 0,
  };
  for (const user of Object.values(USERS)) {
    must(await admin.from("user_question_status").update(promoted).eq("user_id", user.id).gt("wrong_count", 0), "promote");
  }

  // 답안은 position 순 배열이라 세션 문항을 읽어 (문항 번호 → 답) 으로 만든다: 3번은 정답, 4번은 오답.
  const answerFor = (n) => (n === 3 ? ANSWERS[2] : 1);
  async function answersFor(sessionId) {
    const items = must(
      await admin.from("review_session_items").select("position, question_number").eq("session_id", sessionId).order("position"),
      "items",
    );
    const answers = [];
    for (const it of items) answers[it.position] = answerFor(it.question_number);
    return answers;
  }

  const w1 = await web.reviewSubmit(created.web, await answersFor(created.web), T_SUBMIT);
  assert(w1.view && !w1.error, `web review submit: ${w1.error}`);
  const w2 = await web.reviewSubmit(created.web, await answersFor(created.web), T_SUBMIT);
  assertEqual(w2.error, "이미 채점된 세션이에요.", "web: 두 번째 채점 거절 문구");

  const e1 = await edgeUser.reviewSubmit(created.edge, await answersFor(created.edge), T_SUBMIT);
  assert(e1.status === 200, `edge review-submit ${e1.status}: ${JSON.stringify(e1.body)}`);
  const e2 = await edgeUser.reviewSubmit(created.edge, await answersFor(created.edge), T_SUBMIT);
  assertEqual(e2.status, 400, "edge: 두 번째 채점 상태");
  assertEqual(e2.body.error, w2.error, "두 번째 채점 거절 문구");
  assertEqual(e1.body.score, w1.view.score, "채점 점수");

  const webSnap = await snapshot(USERS.web.id);
  const edgeSnap = await snapshot(USERS.edge.id);
  for (const [label, snap] of [
    ["web", webSnap],
    ["edge", edgeSnap],
  ]) {
    assertEqual(snap.review_sessions[0].score, 1, `${label}: score`);
    assertEqual(new Date(snap.review_sessions[0].submitted_at).toISOString(), T_SUBMIT.toISOString(), `${label}: submitted_at`);
    assertEqual(snap.srs_reviews.length, CBT_EXPECT.wrong.length, `${label}: srs_reviews 행 수(채점 1회분)`);
    for (const r of snap.srs_reviews) assertEqual(r.source, "review", `${label}: srs_reviews.source`);
    const status = new Map(snap.user_question_status.map((r) => [r.question_number, r]));
    assertEqual(status.get(3).wrong_count, 1, `${label}: 3번 wrong_count(맞혔으니 그대로)`);
    assertEqual(status.get(3).last_is_correct, true, `${label}: 3번 last_is_correct`);
    assertEqual(status.get(4).wrong_count, 2, `${label}: 4번 wrong_count(한 번만 증가)`);
    for (const n of CBT_EXPECT.wrong) {
      assertEqual(status.get(n).source, "review", `${label}: ${n}번 source`);
      assert(status.get(n).srs_due_at && status.get(n).srs_due_at !== promoted.srs_due_at, `${label}: ${n}번 srs_due_at 이 갱신되지 않았다`);
    }
    if (core.isAttendanceOpen(T_SUBMIT)) {
      const day = snap.attendance_days.find((r) => r.attend_date === core.kstDateKey(T_SUBMIT));
      assertEqual(day?.question_count, CBT_EXPECT.wrong.length, `${label}: 복습 출석 문항이 1회분이어야 한다`);
    }
  }
  compareSnapshots(webSnap, edgeSnap);
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

let setupFailed = false;
try {
  console.log(`contract-tests: ${SUPABASE_URL} / edge ${EDGE_BASE_URL}`);
  await ensureFixtures();
  await createTestUsers();
  await probeTestHooks();
} catch (e) {
  setupFailed = true;
  console.error(`contract-tests: 준비 단계 실패 — ${e?.contract ? e.message : (e?.stack ?? e)}`);
}

if (!setupFailed) {
  await runCase("#10 체험 1회 (membership-get)", caseTrialOnce);
  await runCase("#8 해설 비로그인 미리보기 (explanations-get)", caseExplanationsAnonymous);
  await runCase("#1 CBT 제출 — voided 포함", caseCbtSubmit);
  await runCase("#13·#15 review-create 멱등·정답 미노출", caseReviewCreateIdempotent);
  await runCase("#5·#6 복습 제출 1회·source=review", caseReviewSubmitOnce);
  await runCase("#2 CBT 제출 — 90초 미만", caseCbtTooEarly);
  await runCase("#4 CBT 동시 제출 2건", caseCbtDoubleSubmit);
}

try {
  await resetUsers().catch(() => {});
  await deleteTestUsersIfAny();
  await removeFixtures();
} catch (e) {
  console.error(`contract-tests: 정리 실패(무시) — ${e?.message ?? e}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\ncontract-tests: ${results.length - failed}/${results.length} 통과${setupFailed ? " (준비 단계 실패)" : ""}`);
process.exit(failed > 0 || setupFailed ? 1 : 0);
