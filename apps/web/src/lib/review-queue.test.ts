import { test } from "node:test";
import assert from "node:assert/strict";
import { srsDayStart, srsDayIndex } from "@gongmoa/core";
import { FakeSupabase, asSupabase, type Row } from "@/lib/test-support/fake-supabase";
import {
  collectDueCandidates,
  collectDueQueueItems,
  getDueReviewSummary,
} from "@/lib/review-queue";

// 조회 계층 계약 테스트.
//
// packages/core 의 테스트는 "이 후보 목록이면 이 큐"를 고정한다. 여기서 지키는 건
// 그 앞 단계다 — 어떤 행이 후보가 되는가(정제 규칙)와, 배너·세션·예보가 같은 답을
// 내는가. 실제로 사고가 났던 자리들이라 순수 함수 테스트만으로는 부족하다.
//
// 실행: npm run test (apps/web). tsconfig.test.json 이 server-only 를 빈 모듈로
// 바꿔치기한다 — 진짜 server-only 는 import 되기만 해도 던지기 때문이다.

const USER = "user-1";
const NOW = new Date("2026-03-10T09:00:00+09:00");

function daysFromNow(n: number): string {
  return srsDayStart(srsDayIndex(NOW) + n).toISOString();
}

type StatusOverrides = {
  paper?: string;
  q?: number;
  dueAt?: string | null;
  wrongCount?: number;
  lapses?: number;
  suspendedAt?: string | null;
  lastAnsweredAt?: string;
};

function status(o: StatusOverrides = {}): Row {
  return {
    user_id: USER,
    paper_id: o.paper ?? "p-korean",
    question_number: o.q ?? 1,
    wrong_count: o.wrongCount ?? 1,
    last_answered_at: o.lastAnsweredAt ?? daysFromNow(-3),
    srs_due_at: o.dueAt === undefined ? daysFromNow(-1) : o.dueAt,
    srs_lapses: o.lapses ?? 0,
    srs_suspended_at: o.suspendedAt ?? null,
  };
}

// 문항 미디어. 이미지가 없으면 화면에 그릴 수 없어 후보에서 빠진다.
// id는 해설(개념)을 되짚는 열쇠라 함께 둔다.
function questionId(paper: string, q: number): string {
  return `${paper}:${q}`;
}

function question(paper: string, q: number, withImage = true): Row {
  return {
    id: questionId(paper, q),
    paper_id: paper,
    question_number: q,
    choice_count: 4,
    question_images: withImage ? [{ order_index: 0, image_path: `${paper}/${q}.webp` }] : [],
  };
}

// 해설 한 줄. keyword_title 이 개념 축의 원재료다.
function explanation(paper: string, q: number, keywordTitle: string | null): Row {
  return { question_id: questionId(paper, q), keyword_title: keywordTitle };
}

function paper(id: string, subjectId: string, year = 2020, round = 1): Row {
  return {
    id,
    subject_id: subjectId,
    exam_type_id: "gukga",
    year,
    round,
    level: "9",
    title: `${year} ${subjectId}`,
    subjects: { id: subjectId, name: subjectId },
  };
}

type Fixture = {
  statuses?: Row[];
  questions?: Row[];
  papers?: Row[];
  marks?: Row[];
  prefs?: Row | null;
  explanations?: Row[];
};

function db(f: Fixture = {}): FakeSupabase {
  return new FakeSupabase({
    user_question_status: f.statuses ?? [],
    questions: f.questions ?? [],
    exam_papers: f.papers ?? [paper("p-korean", "korean"), paper("p-history", "history")],
    wrong_note_marks: f.marks ?? [],
    question_explanations: f.explanations ?? [],
    review_preferences: f.prefs === null ? [] : [f.prefs ?? { user_id: USER, daily_limit: 20 }],
  });
}

// question_explanations 는 service_role 로만 읽으므로 조회 계층이 admin 클라이언트를
// 따로 만든다. 테스트에서는 같은 가짜를 admin 자리에도 끼운다.
function adminOf(fake: FakeSupabase) {
  return () => asSupabase(fake);
}

test("이미지가 없는 문항은 큐에도 배너에도 안 잡힌다", async () => {
  // 이미지가 없으면 문제를 그릴 수 없다. 여기가 어긋나면 "20문항"이라고 띄워 놓고
  // 세션에는 19개만 나온다.
  const fake = db({
    statuses: [status({ q: 1 }), status({ q: 2 })],
    questions: [question("p-korean", 1), question("p-korean", 2, false)],
  });

  const { candidates } = await collectDueCandidates(asSupabase(fake), USER, NOW);
  assert.deepEqual(
    candidates.map((c) => c.questionNumber),
    [1],
  );
});

test("삭제 마크한 문항은 큐에서 빠진다", async () => {
  const fake = db({
    statuses: [status({ q: 1 }), status({ q: 2 })],
    questions: [question("p-korean", 1), question("p-korean", 2)],
    marks: [
      { user_id: USER, paper_id: "p-korean", question_number: 2, deleted: true, pinned: false },
    ],
  });

  const { candidates } = await collectDueCandidates(asSupabase(fake), USER, NOW);
  assert.deepEqual(
    candidates.map((c) => c.questionNumber),
    [1],
  );
});

test("보류한 과목은 큐에서도 예보에서도 빠진다", async () => {
  // 스케줄(srs_due_at) 자체는 건드리지 않는다 — 보류는 "잠깐 안 보는 것"이다.
  const fake = db({
    statuses: [status({ paper: "p-korean", q: 1 }), status({ paper: "p-history", q: 1 })],
    questions: [question("p-korean", 1), question("p-history", 1)],
    prefs: { user_id: USER, daily_limit: 20, paused_subject_ids: ["history"] },
  });

  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);
  assert.equal(summary.todayCount, 1);
  assert.equal(summary.forecast[0].count, 1);
  assert.ok(!summary.subjects.some((s) => s.subjectId === "history"));

  // 보류해도 행은 그대로 남아 있어야 한다.
  const row = fake.tables.user_question_status.find((r) => r.paper_id === "p-history");
  assert.ok(row?.srs_due_at);
});

test("leech로 접어둔 문항은 큐에서 빠지고 접힘 수로 센다", async () => {
  // 조용히 사라지면 사용자는 데이터가 날아간 걸로 읽는다. 큐에서 빼되 숫자로는 남긴다.
  const fake = db({
    statuses: [
      status({ q: 1 }),
      status({ q: 2, suspendedAt: daysFromNow(-2), lapses: 8 }),
    ],
    questions: [question("p-korean", 1), question("p-korean", 2)],
  });

  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);
  assert.equal(summary.todayCount, 1);
  assert.equal(summary.suspendedTotal, 1);
});

test("배너 숫자와 세션 문항 수가 같다", async () => {
  // 이 둘은 같은 계산을 각각 호출한다. 어긋나면 "오늘 20문항"이라고 띄워 놓고 다른
  // 개수가 나온다 — 사용자가 가장 먼저 눈치채는 버그다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  for (let q = 1; q <= 30; q++) {
    statuses.push(status({ paper: "p-korean", q, dueAt: daysFromNow(-2) }));
    questions.push(question("p-korean", q));
  }
  for (let q = 1; q <= 15; q++) {
    statuses.push(status({ paper: "p-history", q, dueAt: null, wrongCount: 2 }));
    questions.push(question("p-history", q));
  }

  const fake = db({ statuses, questions });
  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, () => asSupabase(fake));

  assert.equal(items.length, summary.todayCount);
  assert.equal(summary.forecast[0].count, summary.todayCount);
});

test("배너를 보기만 하면 스케줄이 안 심긴다(승격 쓰기는 세션 시작에서만)", async () => {
  const fake = db({
    statuses: [status({ q: 1, dueAt: null, wrongCount: 3 })],
    questions: [question("p-korean", 1)],
  });

  await getDueReviewSummary(asSupabase(fake), USER, NOW);
  assert.equal(fake.writes.length, 0, "배너 조회는 아무것도 쓰면 안 된다");
  assert.equal(fake.tables.user_question_status[0].srs_due_at, null);

  await collectDueQueueItems(asSupabase(fake), USER, NOW, () => asSupabase(fake));
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes[0].table, "user_question_status");
  // 승격은 오늘자 due를 심는다. 간격·ease는 손대지 않는다(승격 시점부터 정상 출발).
  assert.ok(fake.tables.user_question_status[0].srs_due_at);
  assert.equal(fake.writes[0].values.srs_interval_days, undefined);
});

test("승격은 이미 스케줄이 있는 행을 덮어쓰지 않는다", async () => {
  // 그 사이 다른 경로(회독 채점)로 스케줄이 생겼을 수 있다.
  const already = daysFromNow(5);
  const fake = db({
    statuses: [
      status({ q: 1, dueAt: null, wrongCount: 3 }),
      status({ q: 2, dueAt: already, wrongCount: 3 }),
    ],
    questions: [question("p-korean", 1), question("p-korean", 2)],
  });

  await collectDueQueueItems(asSupabase(fake), USER, NOW, () => asSupabase(fake));

  const untouched = fake.tables.user_question_status.find((r) => r.question_number === 2);
  assert.equal(untouched?.srs_due_at, already);
});

test("아직 due가 안 된 문항은 오늘 큐에 없지만 예보에는 남는다", async () => {
  const fake = db({
    statuses: [status({ q: 1, dueAt: daysFromNow(2) })],
    questions: [question("p-korean", 1)],
  });

  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);
  assert.equal(summary.todayCount, 0);
  assert.equal(summary.forecast[2].count, 1);
  // 오늘 큐가 비면 "다음 복습이 며칠 뒤인지"를 알려줘야 한다(0인 날을 그냥 비워두면
  // 기능이 멈춘 걸로 오해한다).
  assert.equal(summary.nextDueOffset, 2);
});

test("오늘 안에 다시 볼 문항(재확인)은 따로 센다", async () => {
  // 세션을 막 끝낸 사용자에게 "오늘 복습할 문항 없어요"가 뜨고 세 시간 뒤 숫자가
  // 다시 생기면 기능이 제멋대로 구는 것처럼 보인다.
  const inThreeHours = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const fake = db({
    statuses: [status({ q: 1, dueAt: inThreeHours })],
    questions: [question("p-korean", 1)],
  });

  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);
  assert.equal(summary.todayCount, 0);
  assert.equal(summary.relearnCount, 1);
});

test("대기 풀은 하루 신규 몫까지만 승격되고 나머지는 숫자로 남는다", async () => {
  // 1회독 중인 사용자에게 오답이 증발한 것처럼 보이면 안 된다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  for (let q = 1; q <= 40; q++) {
    statuses.push(status({ paper: "p-korean", q, dueAt: null, wrongCount: 1 }));
    questions.push(question("p-korean", q));
  }

  const fake = db({ statuses, questions });
  const summary = await getDueReviewSummary(asSupabase(fake), USER, NOW);

  assert.equal(summary.newCount, 10);
  assert.equal(summary.todayCount, 10);
  assert.equal(summary.pendingTotal, 30);
});

test("어제 틀린 문항이 오래된 대기 더미에 묻히지 않는다", async () => {
  // 대기 풀이 전부 wrong_count 1 동점이면 실질 정렬이 "오래된 것부터"가 된다.
  // 신규 몫의 일부를 최근분에 떼어 두지 않으면 어제 오답은 몇 달을 기다린다.
  //
  // 오래된 더미를 같은 과목의 여러 시험지에 흩어 둔다 — 과목 최소 몫이나 문제지
  // 상한이 대신 구해주면 최근분 규칙을 검증한 게 아니게 된다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  const papers: Row[] = [];
  for (let p = 0; p < 20; p++) {
    papers.push(paper(`p-old${p}`, "korean", 2000 + p));
    for (let q = 1; q <= 10; q++) {
      statuses.push(
        status({
          paper: `p-old${p}`,
          q,
          dueAt: null,
          wrongCount: 1,
          lastAnsweredAt: daysFromNow(-120),
        }),
      );
      questions.push(question(`p-old${p}`, q));
    }
  }
  papers.push(paper("p-recent", "korean", 2026));
  for (let q = 1; q <= 5; q++) {
    statuses.push(
      status({
        paper: "p-recent",
        q,
        dueAt: null,
        wrongCount: 1,
        lastAnsweredAt: daysFromNow(-1),
      }),
    );
    questions.push(question("p-recent", q));
  }

  const fake = db({ statuses, questions, papers });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, () => asSupabase(fake));

  assert.ok(
    items.some((it) => it.paperId === "p-recent"),
    "어제 틀린 문항이 오늘 큐에 하나는 들어와야 한다",
  );
});

test("한 문제지가 오늘 큐를 도배하지 않는다", async () => {
  // 회독 직후에는 그 시험지 문항이 한꺼번에 due가 된다. 다른 후보가 있는데도
  // 20자리를 통째로 먹으면 사용자는 "복습이 고장 났다"고 읽는다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  for (let q = 1; q <= 20; q++) {
    statuses.push(status({ paper: "p-korean", q, dueAt: daysFromNow(-5) }));
    questions.push(question("p-korean", q));
  }
  for (let q = 1; q <= 20; q++) {
    statuses.push(status({ paper: "p-history", q, dueAt: daysFromNow(-1) }));
    questions.push(question("p-history", q));
  }

  const fake = db({ statuses, questions });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, () => asSupabase(fake));

  const korean = items.filter((it) => it.paperId === "p-korean").length;
  assert.ok(korean <= 15, `한 문제지가 ${korean}/20 자리를 먹었다`);
  assert.ok(items.some((it) => it.paperId === "p-history"));
});

// ── 개념 축 ──────────────────────────────────────────────────────────────────

test("같은 개념이 오늘 큐를 도배하지 않는다", async () => {
  // 개념 하나를 모르면 여러 해 기출에서 각각 틀린다. 서로 다른 시험지라 문제지
  // 상한에는 걸리지 않는다 — 개념 축이 없으면 오늘 큐가 "대칭키"로 덮인다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  const papers: Row[] = [];
  const explanations: Row[] = [];

  for (let p = 0; p < 12; p++) {
    papers.push(paper(`y${p}`, "security", 2010 + p));
    // 오래 밀린 대칭키 문항(우선순위가 높다)
    statuses.push(status({ paper: `y${p}`, q: 1, dueAt: daysFromNow(-5) }));
    questions.push(question(`y${p}`, 1));
    explanations.push(explanation(`y${p}`, 1, "대칭키 암호화 방식"));
    // 자리를 메울 다른 개념들
    for (let q = 2; q <= 4; q++) {
      statuses.push(status({ paper: `y${p}`, q, dueAt: daysFromNow(-1) }));
      questions.push(question(`y${p}`, q));
      explanations.push(explanation(`y${p}`, q, `기타개념${p}${q}`));
    }
  }

  const fake = db({ statuses, questions, papers, explanations });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, adminOf(fake));

  assert.equal(items.length, 20);
  const symmetric = items.filter((it) => it.questionNumber === 1).length;
  assert.ok(symmetric <= 5, `대칭키 문항이 ${symmetric}개 들어왔다`);
});

test("해설이 없는 문항은 개념 상한에서 빠진다", async () => {
  // 개념을 모른다는 이유로 서로 묶이면 해설 없는 문항끼리 상한에 걸려 큐가 비어버린다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  for (let q = 1; q <= 30; q++) {
    statuses.push(status({ paper: "p-korean", q, dueAt: daysFromNow(-1) }));
    questions.push(question("p-korean", q));
  }

  const fake = db({ statuses, questions, explanations: [] });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, adminOf(fake));
  assert.equal(items.length, 20);
});

test("해설 조회가 실패해도 큐는 정상으로 나온다", async () => {
  // 개념은 큐를 더 고르게 만드는 부가 정보다. 이것 때문에 복습이 막히면 안 된다.
  const statuses: Row[] = [];
  const questions: Row[] = [];
  for (let q = 1; q <= 25; q++) {
    statuses.push(status({ paper: "p-korean", q, dueAt: daysFromNow(-1) }));
    questions.push(question("p-korean", q));
  }

  const fake = db({ statuses, questions });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, () => {
    throw new Error("service role 없음");
  });
  assert.equal(items.length, 20);
});

test("표기가 흔들린 개념도 한 묶음으로 본다", async () => {
  // "대칭키 암호" / "대칭키 암호화 방식" / "대칭키 알고리즘"은 사용자에게 같은
  // 개념이다. 이게 갈리면 상한이 아예 안 걸린다.
  const titles = ["대칭키 암호", "대칭키 암호화 방식", "대칭키 알고리즘", "대칭키 암호 개념"];
  const statuses: Row[] = [];
  const questions: Row[] = [];
  const papers: Row[] = [];
  const explanations: Row[] = [];

  titles.forEach((title, i) => {
    papers.push(paper(`t${i}`, "security", 2010 + i));
    statuses.push(status({ paper: `t${i}`, q: 1, dueAt: daysFromNow(-5) }));
    questions.push(question(`t${i}`, 1));
    explanations.push(explanation(`t${i}`, 1, title));
  });
  // 자리를 메울 다른 개념
  for (let q = 1; q <= 20; q++) {
    papers.push(paper(`o${q}`, "security", 2100 + q));
    statuses.push(status({ paper: `o${q}`, q: 1, dueAt: daysFromNow(-1) }));
    questions.push(question(`o${q}`, 1));
    explanations.push(explanation(`o${q}`, 1, `다른개념${q}`));
  }

  const fake = db({ statuses, questions, papers, explanations });
  const items = await collectDueQueueItems(asSupabase(fake), USER, NOW, adminOf(fake));
  const symmetric = items.filter((it) => it.paperId.startsWith("t")).length;
  assert.ok(symmetric <= 3, `표기만 다른 같은 개념이 ${symmetric}개 들어왔다`);
});
