// 사용법: npm run retention-report            (전체 기간)
//         npm run retention-report -- --days 30   (최근 30일 채점만)
//         npm run retention-report -- --user <uuid>
//         npm run retention-report -- --simulate  (DB 없이, 가상 학습자로)
//
// 복습 스케줄 실측 리포트 (읽기 전용, 소유자 전용 — service role 키 필요).
//
// srs_reviews 는 채점마다 "그때 배정돼 있던 간격 / 실제 경과일 / 정오답"을 남긴다.
// 이 스크립트는 그걸 간격 구간별 유지율로 접어, 지금 상수(학습 단계 1·3일, ease
// 2.5, leech 8회)가 이 서비스의 문항·사용자에게 맞는 값인지 보여준다. 간격 반복은
// 실측으로 상수를 조정해야 쓸 만해지는 알고리즘이고, 그 근거가 이 표다.
//
// 읽는 법:
//  - 회상추정 = 정답률에서 4지선다 찍기(25%)를 걷어낸 값. 간격을 정할 때 봐야 하는
//    건 "정답이 나왔는가"가 아니라 "기억하고 있었는가"다.
//  - 권장 배수 = 목표 유지율(90%)에 맞추려면 그 구간 간격에 곱해야 하는 값.
//    지수 망각 곡선을 가정하고 되푼 값이라 방향과 크기를 보는 용도다.
//    0.3 밑으로 내려가면 "하루 간격도 길다 = 학습 단계를 시간 단위로 쪼개야 한다".
//  - 예정일 전 채점(회독·섞어풀기)은 표본에서 뺐다. 62일짜리를 5일 만에 만나 틀린
//    것은 스케줄의 실패가 아니라서, 섞으면 회독하는 사용자일수록 "간격이 길다"는
//    잘못된 결론이 나온다.
//
// 표본이 얇으면(구간당 30 미만) 판정하지 않는다. 며칠 더 쌓고 다시 돌릴 것.
//
// --simulate 는 DB를 보지 않고 가상 학습자(packages/core/simulate.ts)를 굴려 같은 표를
// 찍는다. 실데이터가 아직 없는 단계에서 표 읽는 법을 익히거나, 상수를 바꿨을 때
// 방향이 어느 쪽인지 보는 용도다. 여기 숫자로 상수를 정하면 안 된다 — 가상 학습자의
// 기억 모델은 가정이고, 실측을 대신하지 못한다.

import { createClient } from "@supabase/supabase-js";
import { PROFILES, simulate } from "@gongmoa/core/simulate";
import {
  formatRetentionTable,
  summarizeRetention,
  SRS_FIRST_INTERVAL_DAYS,
  SRS_SECOND_INTERVAL_DAYS,
  SRS_MAX_EASE,
  SRS_RELEARN_DELAY_HOURS,
  TARGET_RETENTION,
} from "@gongmoa/core";

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const simulated = process.argv.includes("--simulate");

if (simulated) {
  console.log(
    "\n가상 학습자 시뮬레이션 (DB 미조회). 실측이 아니므로 상수 결정의 근거로 쓰지 말 것.\n",
  );
  for (const profile of Object.values(PROFILES)) {
    const report = simulate(profile, { days: 120, seed: 7 });
    console.log(`── ${report.profile} · ${report.days}일`);
    console.log(formatRetentionTable(report.retention));
    console.log();
  }
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  console.error("DB 없이 표 모양만 보려면: npm run retention-report -- --simulate");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

const days = argOf("days") ? Number(argOf("days")) : null;
const userId = argOf("user");
if (days != null && !Number.isFinite(days)) {
  console.error("--days 는 숫자여야 한다");
  process.exit(1);
}

const PAGE = 1000;

async function fetchRows() {
  const rows = [];
  const since = days == null ? null : new Date(Date.now() - days * 86400000).toISOString();

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("srs_reviews")
      .select("user_id, reviewed_at, is_correct, source, prev_interval_days, prev_lapses, elapsed_days")
      .order("id")
      .range(from, from + PAGE - 1);
    if (since) query = query.gte("reviewed_at", since);
    if (userId) query = query.eq("user_id", userId);

    const { data, error } = await query;
    if (error) {
      // 마이그레이션 전이면 테이블이 없다 — 그 경우를 에러로 소리치지 않는다.
      console.error(`srs_reviews 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const raw = await fetchRows();

if (raw.length === 0) {
  console.log("srs_reviews 에 행이 없다. 채점이 쌓이면 다시 돌릴 것.");
  process.exit(0);
}

const users = new Set(raw.map((r) => r.user_id));
const first = raw.reduce((a, r) => (r.reviewed_at < a ? r.reviewed_at : a), raw[0].reviewed_at);
const last = raw.reduce((a, r) => (r.reviewed_at > a ? r.reviewed_at : a), raw[0].reviewed_at);

const summary = summarizeRetention(
  raw.map((r) => ({
    prevIntervalDays: r.prev_interval_days ?? 0,
    elapsedDays: r.elapsed_days,
    isCorrect: r.is_correct === true,
  })),
);

const range = days == null ? "전체 기간" : `최근 ${days}일`;
console.log(`\n복습 스케줄 실측 — ${range}${userId ? ` · 사용자 ${userId}` : ""}`);
console.log(
  `  채점 ${raw.length}건 · 사용자 ${users.size}명 · ${first.slice(0, 10)} ~ ${last.slice(0, 10)}`,
);
console.log(`  목표 유지율 ${(TARGET_RETENTION * 100).toFixed(0)}%\n`);
console.log(formatRetentionTable(summary));

// 채점이 어디서 들어오는지. 이 서비스는 복습 세션 밖(회독)에서 오는 채점이 많아
// 스케줄 설계의 전제가 된다 — 비율이 크게 바뀌면 조기 채점 완화 규칙도 다시 본다.
const bySource = new Map();
for (const r of raw) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
console.log(
  `\n  채점 출처: ${[...bySource].map(([s, n]) => `${s} ${n}건`).join(" · ")}`,
);

// 지금 상수와 나란히 보여준다. 권장 배수를 곱한 값이 "실측이 말하는 학습 단계"다.
const step1 = summary.buckets.find((b) => b.bucket === "1-2일");
const step2 = summary.buckets.find((b) => b.bucket === "3-7일");
console.log("\n  지금 상수와 대조");
console.log(
  `    학습 1단계 ${SRS_FIRST_INTERVAL_DAYS}일 → 실측 권장 ${suggest(step1, SRS_FIRST_INTERVAL_DAYS)}`,
);
console.log(
  `    학습 2단계 ${SRS_SECOND_INTERVAL_DAYS}일 → 실측 권장 ${suggest(step2, SRS_SECOND_INTERVAL_DAYS)}`,
);
console.log(`    재확인 ${SRS_RELEARN_DELAY_HOURS}시간 · ease 상한 ${SRS_MAX_EASE}`);
console.log(
  "\n  ※ 표본이 얇은 구간은 판정하지 않는다. 상수를 바꾸기 전에 구간당 100건 이상,\n" +
    "    가능하면 두 번 이상 같은 방향이 나오는지 확인할 것.\n",
);

function suggest(bucket, currentDays) {
  if (!bucket || bucket.suggestedFactor == null) return "표본 부족";
  const value = currentDays * bucket.suggestedFactor;
  if (value < 1) return `${(value * 24).toFixed(1)}시간 (×${bucket.suggestedFactor.toFixed(2)})`;
  return `${value.toFixed(1)}일 (×${bucket.suggestedFactor.toFixed(2)})`;
}
