// 생성물 — 손으로 고치지 말 것; npm run bundle-edge -w @gongmoa/core
// 원본: packages/core/src/server.ts (esbuild 번들, format=esm, platform=neutral, target=es2022)
// Edge Function 은 이 파일만 import 한다. 규칙을 바꾸려면 packages/core/src 를 고치고 다시 생성.

// src/srs.ts
var SRS_INITIAL = {
  intervalDays: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0
};
var SRS_MIN_EASE = 1.3;
var SRS_MAX_EASE = 2.5;
var SRS_EASE_PENALTY = 0.2;
var SRS_EASE_BONUS = 0.05;
var SRS_MAX_INTERVAL_DAYS = 180;
var SRS_FIRST_INTERVAL_DAYS = 1;
var SRS_SECOND_INTERVAL_DAYS = 3;
var SRS_RELEARN_DELAY_HOURS = 3;
var SRS_LEECH_THRESHOLD = 8;
var SRS_LEECH_REPEAT = SRS_LEECH_THRESHOLD / 2;
var SRS_EARLY_LAPSE_RATIO = 0.5;
var SRS_EARLY_LAPSE_FACTOR = 0.5;
var SRS_FUZZ_MIN_DAYS = 4;
var SRS_FUZZ_RATIO = 0.1;
function isLeechTrigger(lapses) {
  if (lapses < SRS_LEECH_THRESHOLD) return false;
  return (lapses - SRS_LEECH_THRESHOLD) % SRS_LEECH_REPEAT === 0;
}
var KST_OFFSET_MS = 9 * 60 * 60 * 1e3;
var DAY_CUTOFF_MS = 4 * 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
function srsDayIndex(at) {
  return Math.floor((at.getTime() + KST_OFFSET_MS - DAY_CUTOFF_MS) / DAY_MS);
}
function srsDayStart(dayIndex) {
  return new Date(dayIndex * DAY_MS + DAY_CUTOFF_MS - KST_OFFSET_MS);
}
function srsDueAt(now, intervalDays) {
  return srsDayStart(srsDayIndex(now) + intervalDays);
}
function clampEase(ease) {
  return Math.min(SRS_MAX_EASE, Math.max(SRS_MIN_EASE, ease));
}
function isFirstEntry(prev) {
  return prev.reps === 0 && prev.lapses === 0 && prev.intervalDays === 0;
}
function isSameSrsDay(a, b) {
  return srsDayIndex(a) === srsDayIndex(b);
}
function srsRelearnDueAt(now) {
  return new Date(now.getTime() + SRS_RELEARN_DELAY_HOURS * 60 * 60 * 1e3);
}
function srsGuessed(prev, now) {
  return { state: prev, dueAt: srsRelearnDueAt(now) };
}
function dueProgress(prev, now, dueAt) {
  if (!dueAt || prev.intervalDays <= 0) return 1;
  const remaining = srsDayIndex(dueAt) - srsDayIndex(now);
  if (remaining <= 0) return 1;
  return Math.max(0, (prev.intervalDays - remaining) / prev.intervalDays);
}
function retainedProgress(prev, now, lastGradedAt) {
  if (!lastGradedAt || prev.intervalDays <= 0) return 1;
  const elapsed = srsDayIndex(now) - srsDayIndex(lastGradedAt);
  return Math.max(0, Math.min(1, elapsed / prev.intervalDays));
}
function boundByElapsed(prev, grown, now, lastGradedAt) {
  if (!lastGradedAt || prev.intervalDays <= 0) return grown;
  const elapsed = srsDayIndex(now) - srsDayIndex(lastGradedAt);
  if (elapsed <= 0) return grown;
  const evidence = Math.round(elapsed * prev.ease);
  return Math.max(prev.intervalDays, Math.min(grown, evidence));
}
function fuzzInterval(days, rand) {
  if (!rand || days < SRS_FUZZ_MIN_DAYS) return days;
  const span = Math.max(1, Math.round(days * SRS_FUZZ_RATIO));
  const delta = Math.round((rand() * 2 - 1) * span);
  return Math.min(
    SRS_MAX_INTERVAL_DAYS,
    Math.max(SRS_FUZZ_MIN_DAYS, days + delta)
  );
}
function nextSrs(prev, isCorrect, now, lastGradedAt, opts = {}) {
  if (isCorrect && lastGradedAt && prev.reps >= 1 && prev.intervalDays >= 1 && isSameSrsDay(lastGradedAt, now)) {
    return { state: prev, dueAt: srsDueAt(lastGradedAt, prev.intervalDays) };
  }
  if (!isCorrect) {
    const first = isFirstEntry(prev);
    if (!first && prev.intervalDays >= 2 && dueProgress(prev, now, opts.dueAt) < SRS_EARLY_LAPSE_RATIO) {
      return {
        state: {
          intervalDays: Math.max(
            SRS_FIRST_INTERVAL_DAYS,
            Math.round(prev.intervalDays * SRS_EARLY_LAPSE_FACTOR)
          ),
          ease: clampEase(prev.ease - SRS_EASE_PENALTY / 2),
          // reps를 지우지 않는다. 지우면 다음 정답이 1일로 되돌아가 반감이 무의미해진다.
          reps: prev.reps,
          lapses: prev.lapses
        },
        // 그래도 오늘 안에 한 번 더 만난다 — 못 맞힌 건 사실이다. 그 재확인에서
        // 또 틀리면 그때는 예정일이 지난 뒤라 정상 lapse로 처리된다.
        dueAt: srsRelearnDueAt(now)
      };
    }
    const lapses = first ? 0 : prev.lapses + 1;
    return {
      state: {
        intervalDays: SRS_FIRST_INTERVAL_DAYS,
        ease: first ? prev.ease : clampEase(prev.ease - SRS_EASE_PENALTY),
        reps: 0,
        lapses
      },
      // 내일이 아니라 몇 시간 뒤. 오늘 안에 한 번 더 만나야 잊히기 전에 붙잡는다.
      // 간격(intervalDays)은 1일로 두므로, 재확인을 통과하면 거기서부터 1 → 3으로
      // 정상 출발한다.
      dueAt: srsRelearnDueAt(now),
      leech: isLeechTrigger(lapses)
    };
  }
  const progress = Math.min(
    dueProgress(prev, now, opts.dueAt),
    retainedProgress(prev, now, lastGradedAt)
  );
  const growth = 1 + (prev.ease - 1) * progress;
  const reps = prev.reps + 1;
  const grown = Math.min(
    SRS_MAX_INTERVAL_DAYS,
    Math.max(1, Math.round(prev.intervalDays * growth))
  );
  const intervalDays = reps === 1 ? SRS_FIRST_INTERVAL_DAYS : reps === 2 ? SRS_SECOND_INTERVAL_DAYS : (
    // 흔들기(fuzz)는 상한을 씌운 뒤에 건다 — 순서가 반대면 fuzz가 상한을 넘긴다.
    fuzzInterval(boundByElapsed(prev, grown, now, lastGradedAt), opts.fuzz)
  );
  return {
    state: {
      intervalDays,
      ease: clampEase(prev.ease + SRS_EASE_BONUS),
      reps,
      lapses: prev.lapses
    },
    dueAt: srsDueAt(now, intervalDays)
  };
}
function srsStateFromRow(row) {
  return {
    intervalDays: row.srs_interval_days ?? SRS_INITIAL.intervalDays,
    ease: row.srs_ease ?? SRS_INITIAL.ease,
    reps: row.srs_reps ?? SRS_INITIAL.reps,
    lapses: row.srs_lapses ?? SRS_INITIAL.lapses
  };
}

// src/format.ts
function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatCount(n) {
  return n.toLocaleString("ko-KR");
}
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}분 ${seconds}초`;
}
var KST_TIME_ZONE = "Asia/Seoul";
function kstDayKey(value) {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: KST_TIME_ZONE });
}
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// src/membership.ts
var TRIAL_DAYS = 60;
var FREE_UNTIL = "2027-07-01T00:00:00+09:00";
var FREE_UNTIL_LABEL = "2027년 6월 30일";
function isFreeForAll(now = /* @__PURE__ */ new Date()) {
  return now.getTime() < new Date(FREE_UNTIL).getTime();
}
function trialExpiresAt(now = /* @__PURE__ */ new Date()) {
  const byDays = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1e3);
  const promoEnd = new Date(FREE_UNTIL);
  return promoEnd.getTime() > byDays.getTime() ? promoEnd : byDays;
}
var FREE_EXPLANATION_DAILY_PAPERS = 3;
var FREE_MEMBERSHIP = {
  tier: "free",
  source: "trial",
  startedAt: null,
  expiresAt: null
};
function isPremiumMembership(membership, now = /* @__PURE__ */ new Date()) {
  if (isFreeForAll(now)) return true;
  return hasOwnPremiumPeriod(membership, now);
}
function hasOwnPremiumPeriod(membership, now = /* @__PURE__ */ new Date()) {
  if (!membership || membership.tier !== "premium") return false;
  if (membership.expiresAt === null) return true;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}
function isAdFreeMembership(membership, now = /* @__PURE__ */ new Date()) {
  if (!membership) return false;
  if (membership.source !== "paid" && membership.source !== "attendance") {
    return false;
  }
  return hasOwnPremiumPeriod(membership, now);
}
function expiryDaysLeft(membership, now, source) {
  if (isFreeForAll(now)) return null;
  if (!membership) return null;
  if (source && membership.source !== source) return null;
  if (!membership.expiresAt) return null;
  const ms = new Date(membership.expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1e3));
}
function trialDaysLeft(membership, now = /* @__PURE__ */ new Date()) {
  return expiryDaysLeft(membership, now, "trial");
}
function attendanceDaysLeft(membership, now = /* @__PURE__ */ new Date()) {
  return expiryDaysLeft(membership, now, "attendance");
}
function membershipDaysLeft(membership, now = /* @__PURE__ */ new Date()) {
  if (!membership || membership.tier !== "premium") return null;
  return expiryDaysLeft(membership, now);
}
function isTrialUnstarted(membership) {
  return membership?.source === "trial" && membership.startedAt === null;
}
function membershipFromRow(row) {
  if (!row) return FREE_MEMBERSHIP;
  return {
    tier: row.tier === "premium" ? "premium" : "free",
    source: row.source === "paid" || row.source === "attendance" ? row.source : "trial",
    startedAt: row.started_at ?? null,
    expiresAt: row.expires_at ?? null
  };
}

// src/rules/membership-server.ts
var MEMBERSHIP_COLUMNS = "tier, source, started_at, expires_at";
async function startTrialIfEligible(admin, userId, now = /* @__PURE__ */ new Date()) {
  const expires = trialExpiresAt(now);
  const { data } = await admin.rpc("start_trial_if_eligible", {
    p_user_id: userId,
    p_expires_at: expires.toISOString()
  });
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}
async function getMembership(client, userId, getAdmin = () => client) {
  const { data } = await client.from("memberships").select(MEMBERSHIP_COLUMNS).eq("user_id", userId).maybeSingle();
  const membership = membershipFromRow(data ?? null);
  if (!isTrialUnstarted(membership)) return membership;
  if (!data) return membership;
  const started = await startTrialIfEligible(getAdmin(), userId);
  return started ? membershipFromRow(started) : membership;
}
async function isAdminEmail(admin, email) {
  if (!email) return false;
  const { data } = await admin.from("admins").select("email").eq("email", email).maybeSingle();
  return !!data;
}
async function isPremiumUserFor(admin, user, now = /* @__PURE__ */ new Date()) {
  if (isFreeForAll(now)) return true;
  if (await isAdminEmail(admin, user.email)) return true;
  return isPremiumMembership(await getMembership(admin, user.userId), now);
}
function kstToday(now = /* @__PURE__ */ new Date()) {
  return kstDayKey(now);
}
async function consumeFreeExplanationQuota(admin, userId, paperId, now = /* @__PURE__ */ new Date()) {
  const viewDate = kstToday(now);
  const { data, error } = await admin.from("explanation_daily_views").select("paper_id").eq("user_id", userId).eq("view_date", viewDate);
  if (error) return { allowed: true, remainingToday: null };
  const seen = data ?? [];
  const remainingAfter = (used) => Math.max(0, FREE_EXPLANATION_DAILY_PAPERS - used);
  if (seen.some((r) => r.paper_id === paperId)) {
    return { allowed: true, remainingToday: remainingAfter(seen.length) };
  }
  if (seen.length >= FREE_EXPLANATION_DAILY_PAPERS) {
    return { allowed: false, remainingToday: 0 };
  }
  await admin.from("explanation_daily_views").upsert(
    { user_id: userId, view_date: viewDate, paper_id: paperId },
    { onConflict: "user_id,view_date,paper_id" }
  );
  return { allowed: true, remainingToday: remainingAfter(seen.length + 1) };
}

// src/rules/question-status.ts
async function recordQuestionResults(admin, userId, paperId, results, source = "cbt", opts = {}) {
  if (results.length === 0) return;
  const { data: existing } = await admin.from("user_question_status").select(
    "question_number, wrong_count, last_answered_at, srs_due_at, srs_interval_days, srs_ease, srs_reps, srs_lapses, srs_suspended_at"
  ).eq("user_id", userId).eq("paper_id", paperId);
  const prior = new Map(
    (existing ?? []).map((r) => [r.question_number, r])
  );
  const at = opts.now ?? /* @__PURE__ */ new Date();
  const now = at.toISOString();
  const fuzz = opts.fuzz ?? Math.random;
  const reviewLog = [];
  const rows = results.map((r) => {
    const before = prior.get(r.question_number);
    const wrongCount = (before?.wrong_count ?? 0) + (r.is_correct ? 0 : 1);
    const srs = before?.srs_due_at != null ? nextSrs(
      srsStateFromRow(before),
      r.is_correct,
      at,
      before.last_answered_at ? new Date(before.last_answered_at) : null,
      { dueAt: new Date(before.srs_due_at), fuzz }
    ) : null;
    if (srs && before) {
      const prevState = srsStateFromRow(before);
      reviewLog.push({
        user_id: userId,
        paper_id: paperId,
        question_number: r.question_number,
        reviewed_at: now,
        is_correct: r.is_correct,
        source,
        prev_interval_days: prevState.intervalDays,
        prev_ease: prevState.ease,
        prev_reps: prevState.reps,
        prev_lapses: prevState.lapses,
        elapsed_days: before.last_answered_at ? srsDayIndex(at) - srsDayIndex(new Date(before.last_answered_at)) : null,
        next_interval_days: srs.state.intervalDays
      });
    }
    const suspendedAt = srs?.leech ? now : before?.srs_suspended_at ?? null;
    const schedule = srs ? {
      srs_interval_days: srs.state.intervalDays,
      srs_ease: srs.state.ease,
      srs_reps: srs.state.reps,
      srs_lapses: srs.state.lapses,
      srs_due_at: srs.dueAt.toISOString(),
      srs_suspended_at: suspendedAt
    } : {
      srs_interval_days: before?.srs_interval_days ?? SRS_INITIAL.intervalDays,
      srs_ease: before?.srs_ease ?? SRS_INITIAL.ease,
      srs_reps: before?.srs_reps ?? SRS_INITIAL.reps,
      srs_lapses: before?.srs_lapses ?? SRS_INITIAL.lapses,
      srs_due_at: null,
      srs_suspended_at: suspendedAt
    };
    return {
      user_id: userId,
      paper_id: paperId,
      question_number: r.question_number,
      wrong_count: wrongCount,
      last_is_correct: r.is_correct,
      last_answered_at: now,
      source,
      updated_at: now,
      ...schedule
    };
  });
  await admin.from("user_question_status").upsert(rows, { onConflict: "user_id,paper_id,question_number" });
  if (reviewLog.length > 0) {
    try {
      await admin.from("srs_reviews").insert(reviewLog);
    } catch {
    }
  }
  if (source === "cbt") {
    try {
      await (opts.startTrial ?? startTrialIfEligible)(admin, userId);
    } catch {
    }
  }
}

// src/attendance.ts
function isAttendanceOpen(now = /* @__PURE__ */ new Date()) {
  return !isFreeForAll(now);
}
var ATTENDANCE_MIN_QUESTIONS = 10;
var ATTENDANCE_MIN_SECONDS_PER_QUESTION = 2;
function attendanceQuestionCount(input) {
  const answered = Math.floor(input.answeredCount);
  if (!Number.isFinite(answered) || answered <= 0) return 0;
  if (!Number.isFinite(input.elapsedSeconds)) return 0;
  const required = answered * ATTENDANCE_MIN_SECONDS_PER_QUESTION;
  return input.elapsedSeconds >= required ? answered : 0;
}
var ATTENDANCE_MILESTONES = [
  { days: 5, grantDays: 1 },
  { days: 10, grantDays: 1 },
  { days: 15, grantDays: 1 },
  { days: 20, grantDays: 1 },
  { days: 25, grantDays: 2 }
];
var ATTENDANCE_MONTHLY_MAX_DAYS = ATTENDANCE_MILESTONES.reduce(
  (sum, m) => sum + m.grantDays,
  0
);
function attendanceMilestonesReached(attendedDays) {
  return ATTENDANCE_MILESTONES.filter((m) => attendedDays >= m.days);
}
function attendanceEarnedDays(attendedDays) {
  return attendanceMilestonesReached(attendedDays).reduce(
    (sum, m) => sum + m.grantDays,
    0
  );
}
function nextAttendanceMilestone(attendedDays) {
  return ATTENDANCE_MILESTONES.find((m) => attendedDays < m.days) ?? null;
}
function attendanceProgress(attendedDays) {
  const earnedDays = attendanceEarnedDays(attendedDays);
  const next = nextAttendanceMilestone(attendedDays);
  return {
    attendedDays,
    earnedDays,
    remainingDays: ATTENDANCE_MONTHLY_MAX_DAYS - earnedDays,
    next,
    daysToNext: next ? next.days - attendedDays : null
  };
}
function attendanceMilestoneDates(attendedDates) {
  const sorted = [...new Set(attendedDates)].sort();
  const byDate = /* @__PURE__ */ new Map();
  for (const milestone of ATTENDANCE_MILESTONES) {
    const date = sorted[milestone.days - 1];
    if (date) byDate.set(date, milestone);
  }
  return byDate;
}
function kstDateKey(now = /* @__PURE__ */ new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
function kstMonthKey(now = /* @__PURE__ */ new Date()) {
  return `${kstDateKey(now).slice(0, 7)}-01`;
}
function daysInMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// src/rules/attendance-record.ts
async function recordAttendance(admin, userId, questionCount, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  if (!isAttendanceOpen(now)) return;
  if (!Number.isFinite(questionCount) || questionCount <= 0) return;
  const date = kstDateKey(now);
  const month = kstMonthKey(now);
  const { data, error } = await admin.rpc("record_attendance_day", {
    p_user_id: userId,
    p_date: date,
    p_questions: Math.floor(questionCount),
    p_min_questions: ATTENDANCE_MIN_QUESTIONS
  });
  if (error) return;
  const attendedDays = typeof data === "number" ? data : 0;
  for (const milestone of attendanceMilestonesReached(attendedDays)) {
    await admin.rpc("grant_attendance_membership", {
      p_user_id: userId,
      p_month: month,
      p_milestone: milestone.days,
      p_days: milestone.grantDays
    });
  }
}

// src/rules/explanation-access.ts
var EXPLANATION_VIEW_HOURLY_LIMIT = 40;
var EXPLANATION_DOWNLOAD_HOURLY_LIMIT = 80;
var ANON_PREVIEW_CARDS = 2;
var FULL = { full: true, reason: null, remainingToday: null };
async function withinHourlyLimit(admin, userId, paperId, action, now) {
  const limit = action === "view" ? EXPLANATION_VIEW_HOURLY_LIMIT : EXPLANATION_DOWNLOAD_HOURLY_LIMIT;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1e3).toISOString();
  const { count } = await admin.from("explanation_access_log").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("action", action).gte("created_at", oneHourAgo);
  if ((count ?? 0) >= limit) return false;
  await admin.from("explanation_access_log").insert({ user_id: userId, paper_id: paperId, action });
  return true;
}
async function resolveExplanationAccess(admin, input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  if (!await withinHourlyLimit(admin, input.userId, input.paperId, input.action, now)) {
    return { full: false, reason: "rate-limit", remainingToday: null };
  }
  if (input.premium) return FULL;
  const quota = await consumeFreeExplanationQuota(admin, input.userId, input.paperId, now);
  return quota.allowed ? { full: true, reason: null, remainingToday: quota.remainingToday } : { full: false, reason: "free-quota", remainingToday: 0 };
}

// src/rules/explanations.ts
function parseChoiceNumber(raw, fallback) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const circled = "①②③④⑤⑥⑦⑧".indexOf(raw.trim().charAt(0));
    if (circled >= 0) return circled + 1;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
function normalizeChoiceExplanations(raw) {
  if (!raw) return [];
  const textOf = (v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v;
      const t = o.explanation ?? o.text ?? o.content ?? o.reason;
      if (typeof t === "string") return t;
    }
    return "";
  };
  const strOrNull = (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  let entries = [];
  if (Array.isArray(raw)) {
    entries = raw.map((item, i) => {
      const o = item && typeof item === "object" ? item : {};
      return {
        choice: parseChoiceNumber(o.choice ?? o.number ?? o.choice_number, i + 1),
        text: textOf(item),
        currentStatus: strOrNull(o.current_status),
        originalNote: strOrNull(o.original_note)
      };
    });
  } else if (typeof raw === "object") {
    entries = Object.entries(raw).map(([key, v], i) => ({
      choice: parseChoiceNumber(key, i + 1),
      text: textOf(v),
      currentStatus: null,
      originalNote: null
    }));
  }
  return entries.filter((e) => e.text.trim().length > 0).sort((a, b) => a.choice - b.choice);
}
var EXPLANATION_CONTENT_COLUMNS = "keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date";
function toExplanationContent(row) {
  const content = {
    keywordTitle: row.keyword_title?.trim() || null,
    keywordExplanation: row.keyword_explanation?.trim() || null,
    choiceExplanations: normalizeChoiceExplanations(row.choice_explanations),
    correctChoiceSummary: row.correct_choice_summary?.trim() || null,
    lawAmendmentNote: row.law_amendment_note?.trim() || null,
    currentAnswerStatus: row.current_answer_status?.trim() || null,
    currentAnswerNote: row.current_answer_note?.trim() || null,
    lawBasisDate: row.law_basis_date?.trim() || null
  };
  const empty = !content.keywordTitle && !content.keywordExplanation && content.choiceExplanations.length === 0 && !content.correctChoiceSummary && !content.lawAmendmentNote && !content.currentAnswerNote;
  return empty ? null : content;
}

// src/subject-label.ts
var SUBJECT_NAME_BY_EXAM_TYPE = {
  군무원: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국가직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "지방직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국회직 8급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  경찰: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "경력경쟁 9급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "소방 (간부후보)": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "소방 (소방위 승진)": { 행정법총론: "행정법" }
};
function namesFor(examTypeName, level, track) {
  return (track ? SUBJECT_NAME_BY_EXAM_TYPE[`${examTypeName} (${track})`] : void 0) ?? (level ? SUBJECT_NAME_BY_EXAM_TYPE[`${examTypeName} ${level}`] : void 0) ?? SUBJECT_NAME_BY_EXAM_TYPE[examTypeName];
}
var ALIASES_BY_STORED_NAME = (() => {
  const collected = {};
  for (const names of Object.values(SUBJECT_NAME_BY_EXAM_TYPE)) {
    for (const [stored, printed] of Object.entries(names)) {
      if (printed === stored) continue;
      (collected[stored] ??= /* @__PURE__ */ new Set()).add(printed);
    }
  }
  return Object.fromEntries(
    Object.entries(collected).map(([stored, set]) => [stored, [...set]])
  );
})();
function getSubjectDisplayName(subjectName, examTypeName, level, track) {
  if (!examTypeName) return subjectName;
  return namesFor(examTypeName, level, track)?.[subjectName] ?? subjectName;
}
function applyExamTypeSubjectName(title) {
  const [, examTypeName, third] = title.trim().split(/\s+/);
  const level = /^\d+급$/.test(third ?? "") ? third : null;
  const track = title.match(/\(([^)]+)\)/)?.[1] ?? null;
  const names = examTypeName ? namesFor(examTypeName, level, track) : void 0;
  if (!names) return title;
  for (const [stored, printed] of Object.entries(names)) {
    if (title.endsWith(stored)) {
      return `${title.slice(0, title.length - stored.length)}${printed}`;
    }
  }
  return title;
}

// src/paper-title.ts
function stripTrackFromTitle(title, track) {
  if (!track) return title;
  return title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim();
}
function unwrapParentheses(title) {
  return title.replace(/[(（]([^()（）]*)[)）]/g, "$1").replace(/\s{2,}/g, " ").trim();
}
function getPaperDisplayTitle(title, track) {
  const named = applyExamTypeSubjectName(title);
  const base = named.includes(" 법원직 ") ? stripTrackFromTitle(named, track) : named;
  return unwrapParentheses(base);
}

// src/dedup-papers.ts
function paperDedupKey(p) {
  return [p.subject_id, p.exam_type_id, p.year, p.round, p.level ?? ""].join(" ");
}
function collidingPaperIds(papers) {
  const byKey = /* @__PURE__ */ new Map();
  for (const p of papers) {
    const key = paperDedupKey(p);
    const arr = byKey.get(key);
    if (arr) arr.push(p.id);
    else byKey.set(key, [p.id]);
  }
  const ids = [];
  for (const arr of byKey.values()) {
    if (arr.length > 1) ids.push(...arr);
  }
  return ids;
}
function clusterSamePaper(members, signals) {
  if (members.length === 1) return [members];
  const distinctSignatures = new Set(
    members.map((m) => signals?.get(m.id)?.answerSignature).filter((sig) => sig != null)
  );
  if (distinctSignatures.size <= 1) return [members];
  const buckets = /* @__PURE__ */ new Map();
  for (const m of members) {
    const sig = signals?.get(m.id)?.answerSignature;
    const key = sig != null ? `a:${sig}` : `solo:${m.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(m);
    else buckets.set(key, [m]);
  }
  return [...buckets.values()];
}
function isBetterRepresentative(candidate, current, signals) {
  const sc = signals?.get(candidate.id);
  const su = signals?.get(current.id);
  const qc = sc?.questionCount ?? 0;
  const qu = su?.questionCount ?? 0;
  if (qc !== qu) return qc > qu;
  const ac = sc?.answerSignature != null ? 1 : 0;
  const au = su?.answerSignature != null ? 1 : 0;
  if (ac !== au) return ac > au;
  if (candidate.created_at && current.created_at && candidate.created_at !== current.created_at) {
    return candidate.created_at < current.created_at;
  }
  return candidate.id < current.id;
}
function representativePaperIds(papers, signals) {
  const metaGroups = /* @__PURE__ */ new Map();
  for (const p of papers) {
    const key = paperDedupKey(p);
    const arr = metaGroups.get(key);
    if (arr) arr.push(p);
    else metaGroups.set(key, [p]);
  }
  const repByPaperId = /* @__PURE__ */ new Map();
  const finalGroupSizeByRepId = /* @__PURE__ */ new Map();
  for (const members of metaGroups.values()) {
    for (const subgroup of clusterSamePaper(members, signals)) {
      let best = subgroup[0];
      for (let i = 1; i < subgroup.length; i++) {
        if (isBetterRepresentative(subgroup[i], best, signals)) best = subgroup[i];
      }
      for (const m of subgroup) repByPaperId.set(m.id, best.id);
      finalGroupSizeByRepId.set(best.id, subgroup.length);
    }
  }
  return { repByPaperId, finalGroupSizeByRepId };
}
function collapseDuplicatePapers(papers, signals) {
  const { repByPaperId, finalGroupSizeByRepId } = representativePaperIds(papers, signals);
  const result = [];
  for (const p of papers) {
    if (repByPaperId.get(p.id) !== p.id) continue;
    const wasCollapsed = (finalGroupSizeByRepId.get(p.id) ?? 1) > 1;
    if (wasCollapsed && p.track) {
      result.push({ ...p, title: stripTrackFromTitle(p.title, p.track) });
    } else {
      result.push(p);
    }
  }
  return result;
}

// src/data/dedup-signals.ts
async function fetchPaperIdentitySignals(client, paperIds, answers = null) {
  const signals = /* @__PURE__ */ new Map();
  if (paperIds.length === 0) return signals;
  for (const id of paperIds) {
    signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  }
  const questionRowsPromise = client.from("questions").select("paper_id").in("paper_id", paperIds);
  const answerRowsPromise = (async () => {
    if (!answers) return null;
    try {
      return await answers.from("paper_answers").select("paper_id, answers, voided_questions").in("paper_id", paperIds);
    } catch {
      return null;
    }
  })();
  const { data: questionRows } = await questionRowsPromise;
  for (const row of questionRows ?? []) {
    const s = signals.get(row.paper_id);
    if (s) s.questionCount += 1;
  }
  const answerResult = await answerRowsPromise;
  if (answerResult && !answerResult.error) {
    for (const row of answerResult.data ?? []) {
      const r = row;
      const s = signals.get(r.paper_id);
      if (!s) continue;
      const answersArr = r.answers ?? [];
      s.answerSignature = JSON.stringify([answersArr, r.voided_questions ?? []]);
      s.answerLength = answersArr.length;
    }
  }
  return signals;
}

// src/data/query-utils.ts
var QUERY_CONCURRENCY = 8;
async function inParallel(items, run, limit = QUERY_CONCURRENCY) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (let i = cursor++; i < items.length; i = cursor++) {
      out[i] = await run(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}
var PAGE_BATCH_SIZE = 1e3;
var PAGE_CONCURRENCY = 4;
async function fetchAllPages(fetchRange, label) {
  const all = [];
  let start = 0;
  while (true) {
    const wave = await Promise.all(
      Array.from({ length: PAGE_CONCURRENCY }, (_, i) => {
        const from = start + i * PAGE_BATCH_SIZE;
        return fetchRange(from, from + PAGE_BATCH_SIZE - 1);
      })
    );
    for (const { data, error } of wave) {
      if (error) throw new Error(`${label} 조회 실패: ${error.message}`);
      const page = data ?? [];
      all.push(...page);
      if (page.length < PAGE_BATCH_SIZE) return all;
    }
    start += PAGE_CONCURRENCY * PAGE_BATCH_SIZE;
  }
}

// src/data/question-media.ts
var QUESTION_MEDIA_SELECT = "id, paper_id, question_number, choice_count, question_images(order_index, image_path)";
var BATCH_SIZE = 1e3;
async function fetchQuestionMedia(client, paperIds, wanted) {
  const byPaper = /* @__PURE__ */ new Map();
  function consume(rows) {
    for (const row of rows) {
      const images = [...row.question_images ?? []].sort((a, b) => a.order_index - b.order_index).map(
        (img) => client.storage.from("exam-papers").getPublicUrl(img.image_path).data.publicUrl
      );
      const paperMap = byPaper.get(row.paper_id) ?? /* @__PURE__ */ new Map();
      paperMap.set(row.question_number, {
        choiceCount: row.choice_count,
        images,
        questionId: row.id
      });
      byPaper.set(row.paper_id, paperMap);
    }
  }
  if (wanted) {
    await inParallel(paperIds, async (paperId) => {
      const numbers = [...wanted.get(paperId) ?? []];
      if (numbers.length === 0) return;
      const { data } = await client.from("questions").select(QUESTION_MEDIA_SELECT).eq("paper_id", paperId).in("question_number", numbers);
      consume(data ?? []);
    });
    return byPaper;
  }
  await inParallel(chunk(paperIds, 10), async (ids) => {
    let from = 0;
    while (true) {
      const { data } = await client.from("questions").select(QUESTION_MEDIA_SELECT).in("paper_id", ids).order("paper_id").order("question_number").range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      consume(data);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  });
  return byPaper;
}

// src/data/wrong-notes.ts
var REVIEW_COOLDOWN_HOURS = 24;
async function fetchWrongNoteMarks(client, userId, paperIds) {
  const deleted = /* @__PURE__ */ new Set();
  const pinned = /* @__PURE__ */ new Set();
  if (paperIds && paperIds.length === 0) return { deleted, pinned };
  const idChunks = paperIds ? chunk(paperIds, 200) : [null];
  const failed = await inParallel(idChunks, async (ids) => {
    let query = client.from("wrong_note_marks").select("paper_id, question_number, pinned, deleted").eq("user_id", userId);
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    if (error) return true;
    for (const r of data ?? []) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (r.deleted) deleted.add(key);
      if (r.pinned) pinned.add(key);
    }
    return false;
  });
  if (failed.some(Boolean)) return { deleted: /* @__PURE__ */ new Set(), pinned: /* @__PURE__ */ new Set() };
  return { deleted, pinned };
}
async function fetchCorrectAnswers(admin, paperIds) {
  const byPaper = /* @__PURE__ */ new Map();
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await admin.from("paper_answers").select("paper_id, answers").in("paper_id", ids);
    for (const row of data ?? []) {
      byPaper.set(row.paper_id, row.answers ?? []);
    }
  });
  return byPaper;
}
async function fetchMemos(client, userId, paperIds) {
  const out = /* @__PURE__ */ new Map();
  if (paperIds.length === 0) return out;
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await client.from("question_memos").select("paper_id, question_number, memo").eq("user_id", userId).in("paper_id", ids);
    for (const r of data ?? []) {
      const memo = r.memo?.trim();
      if (memo) out.set(`${r.paper_id}#${r.question_number}`, memo);
    }
  });
  return out;
}
var EXPLANATION_SELECT = "question_id, keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date";
var QUESTION_ID_CHUNK = 200;
var BATCH_SIZE2 = 1e3;
async function fetchQuestionKeys(admin, paperIds, wanted) {
  const byId = /* @__PURE__ */ new Map();
  function consume(rows) {
    for (const row of rows) {
      byId.set(row.id, { paperId: row.paper_id, questionNumber: row.question_number });
    }
  }
  if (wanted) {
    await inParallel(paperIds, async (paperId) => {
      const numbers = [...wanted.get(paperId) ?? []];
      if (numbers.length === 0) return;
      const { data, error } = await admin.from("questions").select("id, paper_id, question_number").eq("paper_id", paperId).in("question_number", numbers);
      if (error) throw error;
      consume(data ?? []);
    });
    return byId;
  }
  await inParallel(chunk(paperIds, 10), async (ids) => {
    let from = 0;
    while (true) {
      const { data, error } = await admin.from("questions").select("id, paper_id, question_number").in("paper_id", ids).order("paper_id").order("question_number").range(from, from + BATCH_SIZE2 - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      consume(data);
      if (data.length < BATCH_SIZE2) break;
      from += BATCH_SIZE2;
    }
  });
  return byId;
}
async function fetchExplanations(admin, paperIds, wanted, required = false) {
  const byPaper = /* @__PURE__ */ new Map();
  try {
    const keys = await fetchQuestionKeys(admin, paperIds, wanted);
    const questionIds = [...keys.keys()];
    if (questionIds.length === 0) return byPaper;
    await inParallel(chunk(questionIds, QUESTION_ID_CHUNK), async (ids) => {
      const { data, error } = await admin.from("question_explanations").select(EXPLANATION_SELECT).in("question_id", ids);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = keys.get(row.question_id);
        if (!key) continue;
        const content = toExplanationContent(row);
        if (!content) continue;
        const paperMap = byPaper.get(key.paperId) ?? /* @__PURE__ */ new Map();
        paperMap.set(key.questionNumber, content);
        byPaper.set(key.paperId, paperMap);
      }
    });
  } catch (e) {
    console.error("fetchExplanations 실패", { paperIds, error: e });
    if (required) throw e;
    return /* @__PURE__ */ new Map();
  }
  return byPaper;
}
async function fetchExplainedNumbers(admin, paperIds, wanted) {
  const byPaper = /* @__PURE__ */ new Map();
  try {
    const keys = await fetchQuestionKeys(admin, paperIds, wanted);
    const questionIds = [...keys.keys()];
    if (questionIds.length === 0) return byPaper;
    await inParallel(chunk(questionIds, QUESTION_ID_CHUNK), async (ids) => {
      const { data, error } = await admin.from("question_explanations").select("question_id").in("question_id", ids);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = keys.get(row.question_id);
        if (!key) continue;
        const set = byPaper.get(key.paperId) ?? /* @__PURE__ */ new Set();
        set.add(key.questionNumber);
        byPaper.set(key.paperId, set);
      }
    });
  } catch (e) {
    console.error("fetchExplainedNumbers 실패", { paperIds, error: e });
    return /* @__PURE__ */ new Map();
  }
  return byPaper;
}

// src/rules/explanations-wrong-note.ts
var WRONG_NOTE_QUESTION_LIMIT = 100;
var DEDUP_SELECT = "id, subject_id, exam_type_id, year, round, level, track, title, created_at";
async function fetchSiblingPaperIds(admin, paperId) {
  const { data: baseRow } = await admin.from("exam_papers").select(DEDUP_SELECT).eq("id", paperId).maybeSingle();
  const base = baseRow;
  if (!base) return [paperId];
  let query = admin.from("exam_papers").select(DEDUP_SELECT).eq("subject_id", base.subject_id).eq("exam_type_id", base.exam_type_id).eq("year", base.year).eq("round", base.round);
  query = base.level == null ? query.is("level", null) : query.eq("level", base.level);
  const { data: candidateRows } = await query;
  const candidates = (candidateRows ?? []).filter(
    (p) => paperDedupKey(p) === paperDedupKey(base)
  );
  const others = candidates.filter((p) => p.id !== paperId).map((p) => p.id);
  if (others.length === 0) return [paperId];
  const signals = await fetchPaperIdentitySignals(admin, [paperId, ...others], admin);
  const baseSig = signals.get(paperId)?.answerSignature ?? null;
  if (baseSig == null) return [paperId];
  return [
    paperId,
    ...others.filter((id) => (signals.get(id)?.answerSignature ?? null) === baseSig)
  ];
}
async function fetchAnsweredQuestionNumbers(admin, userId, input) {
  const answered = /* @__PURE__ */ new Set();
  const numbers = [...new Set(input.questionNumbers)];
  if (numbers.length === 0) return answered;
  const paperIds = await fetchSiblingPaperIds(admin, input.paperId);
  const { data: statusRows } = await admin.from("user_question_status").select("question_number").eq("user_id", userId).in("paper_id", paperIds).in("question_number", numbers);
  for (const r of statusRows ?? []) {
    answered.add(r.question_number);
  }
  if (answered.size === numbers.length) return answered;
  const { data: attemptRows } = await admin.from("cbt_attempts").select("id").eq("user_id", userId).in("paper_id", paperIds);
  const attemptIds = (attemptRows ?? []).map((r) => r.id);
  for (const ids of chunk(attemptIds, 100)) {
    const { data } = await admin.from("cbt_attempt_answers").select("question_number").in("attempt_id", ids).in("question_number", numbers);
    for (const r of data ?? []) {
      answered.add(r.question_number);
    }
  }
  return answered;
}
async function resolveWrongNoteExplanations(admin, input) {
  const requested = [
    ...new Set(
      input.questionNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 300)
    )
  ].slice(0, WRONG_NOTE_QUESTION_LIMIT);
  const empty = {
    questions: [],
    lockedQuestionNumbers: [],
    locked: !input.premium,
    totalCount: 0
  };
  if (requested.length === 0) return empty;
  const answered = await fetchAnsweredQuestionNumbers(admin, input.userId, {
    paperId: input.paperId,
    questionNumbers: requested
  });
  const numbers = requested.filter((n) => answered.has(n)).sort((a, b) => a - b);
  if (numbers.length === 0) return empty;
  const wanted = /* @__PURE__ */ new Map([[input.paperId, new Set(numbers)]]);
  if (!input.premium) {
    const explained = await fetchExplainedNumbers(admin, [input.paperId], wanted);
    const lockedQuestionNumbers = numbers.filter(
      (n) => explained.get(input.paperId)?.has(n) ?? false
    );
    return {
      questions: [],
      lockedQuestionNumbers,
      locked: true,
      totalCount: lockedQuestionNumbers.length
    };
  }
  const [mediaByPaper, answersByPaper, explanationsByPaper] = await Promise.all([
    fetchQuestionMedia(admin, [input.paperId], wanted),
    fetchCorrectAnswers(admin, [input.paperId]),
    fetchExplanations(admin, [input.paperId], wanted)
  ]);
  const media = mediaByPaper.get(input.paperId) ?? /* @__PURE__ */ new Map();
  const correctAnswers = answersByPaper.get(input.paperId) ?? [];
  const explanations = explanationsByPaper.get(input.paperId) ?? /* @__PURE__ */ new Map();
  const questions = [];
  for (const questionNumber of numbers) {
    const explanation = explanations.get(questionNumber);
    if (!explanation) continue;
    const m = media.get(questionNumber);
    questions.push({
      questionNumber,
      correctChoice: correctAnswers[questionNumber - 1] ?? null,
      choiceCount: m?.choiceCount ?? 4,
      images: m?.images ?? [],
      explanation
    });
  }
  return {
    questions,
    lockedQuestionNumbers: [],
    locked: false,
    totalCount: questions.length
  };
}

// src/cbt-attempt.ts
var MIN_ATTEMPT_SECONDS = 90;
function sanitizeSelectedChoice(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

// src/rules/cbt-attempt.ts
function isCbtRuleError(r) {
  return "error" in r;
}
async function startCbtAttempt(admin, userId, paperId, now = /* @__PURE__ */ new Date()) {
  const startedAt = now.toISOString();
  const { error } = await admin.from("cbt_attempt_starts").upsert(
    { user_id: userId, paper_id: paperId, started_at: startedAt },
    { onConflict: "user_id,paper_id" }
  );
  if (error) return { error: "시작 기록에 실패했어요.", status: 500 };
  return { startedAt };
}
async function submitCbtAttempt(admin, userId, paperId, submitted, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const { data: paperAnswers } = await admin.from("paper_answers").select("answers, voided_questions").eq("paper_id", paperId).maybeSingle();
  if (!paperAnswers) return { error: "이 문제지는 CBT를 지원하지 않아요.", status: 400 };
  const correctAnswers = paperAnswers.answers ?? [];
  const voided = new Set(
    paperAnswers.voided_questions ?? []
  );
  const totalQuestions = correctAnswers.length;
  if (totalQuestions === 0) return { error: "이 문제지는 CBT를 지원하지 않아요.", status: 400 };
  const { data: claimed, error: claimError } = await admin.from("cbt_attempt_starts").delete().eq("user_id", userId).eq("paper_id", paperId).select("started_at");
  if (claimError) return { error: "채점에 실패했어요.", status: 500 };
  const startRecord = (claimed ?? [])[0];
  if (!startRecord) {
    return { error: "새로고침 후 다시 시작해주세요.", status: 400 };
  }
  const restoreStart = async () => {
    try {
      await admin.from("cbt_attempt_starts").upsert(
        { user_id: userId, paper_id: paperId, started_at: startRecord.started_at },
        { onConflict: "user_id,paper_id" }
      );
    } catch {
    }
  };
  const elapsedSeconds = (now.getTime() - new Date(startRecord.started_at).getTime()) / 1e3;
  if (elapsedSeconds < MIN_ATTEMPT_SECONDS) {
    await restoreStart();
    const waitSeconds = Math.ceil(MIN_ATTEMPT_SECONDS - elapsedSeconds);
    return {
      error: `최소 ${formatDuration(MIN_ATTEMPT_SECONDS)}은 풀어야 채점할 수 있어요. ${waitSeconds}초 후에 다시 시도해주세요.`,
      status: 400
    };
  }
  const durationSeconds = Math.round(elapsedSeconds);
  let score = 0;
  const questionResults = [];
  for (let i = 0; i < totalQuestions; i++) {
    const questionNumber = i + 1;
    const selected = sanitizeSelectedChoice(submitted[i]);
    const isCorrect = voided.has(questionNumber) || selected === correctAnswers[i];
    if (isCorrect) score++;
    questionResults.push({
      question_number: questionNumber,
      selected_choice: selected,
      is_correct: isCorrect
    });
  }
  const { data: attempt, error: attemptError } = await admin.from("cbt_attempts").insert({
    user_id: userId,
    paper_id: paperId,
    score,
    total_questions: totalQuestions,
    duration_seconds: durationSeconds
  }).select("id").single();
  if (attemptError || !attempt) {
    await restoreStart();
    return { error: "채점에 실패했어요.", status: 500 };
  }
  const attemptId = attempt.id;
  const { error: answersError } = await admin.from("cbt_attempt_answers").insert(
    questionResults.map((q) => ({ attempt_id: attemptId, ...q }))
  );
  if (answersError) {
    await admin.from("cbt_attempts").delete().eq("id", attemptId);
    await restoreStart();
    return { error: "채점에 실패했어요.", status: 500 };
  }
  try {
    await recordQuestionResults(admin, userId, paperId, questionResults, "cbt", {
      now,
      ...opts.questionStatus
    });
  } catch {
  }
  try {
    await recordAttendance(
      admin,
      userId,
      attendanceQuestionCount({
        answeredCount: questionResults.filter((q) => q.selected_choice !== null).length,
        elapsedSeconds: durationSeconds
      }),
      { now }
    );
  } catch {
  }
  let diagnosisProgress;
  if (!opts.skipDiagnosisProgress) {
    try {
      const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
        admin.from("cbt_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
        admin.from("user_question_status").select("paper_id", { count: "exact", head: true }).eq("user_id", userId).gt("wrong_count", 0)
      ]);
      diagnosisProgress = { attemptCount: attemptCount ?? 0, wrongCount: wrongCount ?? 0 };
    } catch {
    }
  }
  return {
    attemptId,
    score,
    totalQuestions,
    durationSeconds,
    voidedQuestions: [...voided],
    questionResults,
    diagnosisProgress
  };
}

// src/rules/status-targets.ts
var DEDUP_SELECT2 = "id, subject_id, exam_type_id, year, round, level, track, title, created_at";
function statusTargetKey(paperId, questionNumber) {
  return `${paperId}#${questionNumber}`;
}
async function resolveStatusTargets(client, userId, items, opts = {}) {
  const out = /* @__PURE__ */ new Map();
  const paperIds = [...new Set(items.map((i) => i.paperId))];
  if (paperIds.length === 0) return out;
  const { data: baseRows } = await client.from("exam_papers").select(DEDUP_SELECT2).in("id", paperIds);
  const base = baseRows ?? [];
  if (base.length === 0) return out;
  let siblingQuery = client.from("exam_papers").select(DEDUP_SELECT2).in("subject_id", [...new Set(base.map((p) => p.subject_id))]).in("exam_type_id", [...new Set(base.map((p) => p.exam_type_id))]).in("year", [...new Set(base.map((p) => p.year))]).in("round", [...new Set(base.map((p) => p.round))]);
  const levels = base.map((p) => p.level);
  if (levels.every((l) => l != null)) {
    siblingQuery = siblingQuery.in("level", [...new Set(levels)]);
  }
  const { data: siblingRows } = await siblingQuery;
  const baseKeys = new Set(base.map(paperDedupKey));
  const byId = /* @__PURE__ */ new Map();
  for (const p of base) byId.set(p.id, p);
  for (const p of siblingRows ?? []) {
    if (baseKeys.has(paperDedupKey(p))) byId.set(p.id, p);
  }
  const group = [...byId.values()];
  const colliding = collidingPaperIds(group);
  if (colliding.length === 0) return out;
  const signals = await fetchPaperIdentitySignals(
    client,
    colliding,
    opts.answersClient ?? null
  );
  const { repByPaperId } = representativePaperIds(group, signals);
  const siblingsByRep = /* @__PURE__ */ new Map();
  for (const p of group) {
    const rep = repByPaperId.get(p.id) ?? p.id;
    const list2 = siblingsByRep.get(rep) ?? [];
    list2.push(p.id);
    siblingsByRep.set(rep, list2);
  }
  const candidateIds = /* @__PURE__ */ new Set();
  for (const item of items) {
    const rep = repByPaperId.get(item.paperId) ?? item.paperId;
    for (const id of siblingsByRep.get(rep) ?? []) candidateIds.add(id);
  }
  if (candidateIds.size === 0) return out;
  const questionNumbers = [...new Set(items.map((i) => i.questionNumber))];
  const owned = /* @__PURE__ */ new Set();
  for (const ids of chunk([...candidateIds], 100)) {
    const { data } = await client.from("user_question_status").select("paper_id, question_number").eq("user_id", userId).in("paper_id", ids).in("question_number", questionNumbers);
    for (const r of data ?? []) {
      owned.add(statusTargetKey(r.paper_id, r.question_number));
    }
  }
  for (const item of items) {
    const rep = repByPaperId.get(item.paperId) ?? item.paperId;
    const targets = (siblingsByRep.get(rep) ?? [item.paperId]).filter(
      (id) => owned.has(statusTargetKey(id, item.questionNumber))
    );
    if (targets.length === 0) continue;
    out.set(statusTargetKey(item.paperId, item.questionNumber), targets);
  }
  return out;
}

// src/review-queue.ts
var DUE_QUEUE_LIMIT = 20;
var NEW_QUEUE_LIMIT = 10;
var DAILY_LIMIT_OPTIONS = [10, 20, 40, 60];
function normalizeDailyLimit(value) {
  const n = Number(value);
  return DAILY_LIMIT_OPTIONS.includes(n) ? n : DUE_QUEUE_LIMIT;
}
function newItemsForLimit(total) {
  return Math.max(1, Math.round(total * NEW_QUEUE_LIMIT / DUE_QUEUE_LIMIT));
}
var DUE_FORECAST_DAYS = 7;
var OVERDUE_SCORE_CAP_DAYS = 14;
var LAPSE_SCORE_WEIGHT = 3;
function duePriorityScore(c, now) {
  const overdueDays = Math.max(0, srsDayIndex(now) - srsDayIndex(new Date(c.dueAt)));
  return Math.min(overdueDays, OVERDUE_SCORE_CAP_DAYS) + c.lapses * LAPSE_SCORE_WEIGHT;
}
function byPriority(a, b, now) {
  const diff = duePriorityScore(b, now) - duePriorityScore(a, now);
  if (diff !== 0) return diff;
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.paperId === b.paperId ? a.questionNumber - b.questionNumber : a.paperId < b.paperId ? -1 : 1;
}
var SUBJECT_MIN_SLOTS = 2;
function subjectFloorForLimit(total) {
  return Math.max(1, Math.round(total * SUBJECT_MIN_SLOTS / DUE_QUEUE_LIMIT));
}
var PAPER_MAX_SHARE = 0.25;
function paperCapForLimit(total) {
  return Math.max(2, Math.round(total * PAPER_MAX_SHARE));
}
var CONCEPT_MAX_SHARE = 0.15;
function conceptCapForLimit(total) {
  return Math.max(2, Math.round(total * CONCEPT_MAX_SHARE));
}
function takeWithSubjectFloor(sorted, cap, minPerSubject, caps = []) {
  if (cap <= 0 || sorted.length === 0) return [];
  if (sorted.length <= cap) return sorted;
  const groups = /* @__PURE__ */ new Map();
  for (const it of sorted) {
    const key = it.subjectId ?? "";
    const list2 = groups.get(key) ?? [];
    list2.push(it);
    groups.set(key, list2);
  }
  const picked = [];
  const chosen = /* @__PURE__ */ new Set();
  const counters = caps.map(() => /* @__PURE__ */ new Map());
  const take = (it) => {
    picked.push(it);
    chosen.add(it);
    caps.forEach((c, i) => {
      const key = c.keyOf(it);
      if (key == null) return;
      counters[i].set(key, (counters[i].get(key) ?? 0) + 1);
    });
  };
  const withinCaps = (it) => caps.every((c, i) => {
    const key = c.keyOf(it);
    return key == null || (counters[i].get(key) ?? 0) < c.max;
  });
  if (groups.size > 1) {
    const floor = Math.max(1, Math.min(minPerSubject, Math.floor(cap / groups.size)));
    for (let i = 0; i < floor && picked.length < cap; i++) {
      for (const list2 of groups.values()) {
        if (picked.length >= cap) break;
        const next = list2[i];
        if (!next) continue;
        take(next);
      }
    }
  }
  for (const it of sorted) {
    if (picked.length >= cap) break;
    if (chosen.has(it) || !withinCaps(it)) continue;
    take(it);
  }
  for (const it of sorted) {
    if (picked.length >= cap) break;
    if (!chosen.has(it)) take(it);
  }
  return picked;
}
var ADJACENT_PENALTY = { concept: 4, paper: 2, subject: 1 };
function adjacentPenalty(a, b) {
  let score = 0;
  if (a.conceptKey != null && a.conceptKey === b.conceptKey) score += ADJACENT_PENALTY.concept;
  if (a.paperId === b.paperId) score += ADJACENT_PENALTY.paper;
  if ((a.subjectId ?? "") === (b.subjectId ?? "")) score += ADJACENT_PENALTY.subject;
  return score;
}
function interleaveBySubject(items) {
  if (items.length <= 2) return items;
  const remaining = [...items];
  const out = [remaining.shift()];
  while (remaining.length > 0) {
    const prev = out[out.length - 1];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const score = adjacentPenalty(prev, remaining[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
        if (score === 0) break;
      }
    }
    out.push(remaining.splice(bestIndex, 1)[0]);
  }
  return out;
}
function byPendingPriority(a, b) {
  if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
  if (a.lastAnsweredAt !== b.lastAnsweredAt) return a.lastAnsweredAt < b.lastAnsweredAt ? -1 : 1;
  return a.paperId === b.paperId ? a.questionNumber - b.questionNumber : a.paperId < b.paperId ? -1 : 1;
}
function byRecentWrong(a, b) {
  if (a.lastAnsweredAt !== b.lastAnsweredAt) return a.lastAnsweredAt < b.lastAnsweredAt ? 1 : -1;
  if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
  return a.paperId === b.paperId ? a.questionNumber - b.questionNumber : a.paperId < b.paperId ? -1 : 1;
}
var NEW_RECENT_RATIO = 0.3;
function recentItemsForNew(newQuota) {
  return Math.max(0, Math.floor(Math.max(0, newQuota) * NEW_RECENT_RATIO));
}
function pickPending(pending, room) {
  const recentRoom = Math.min(room, recentItemsForNew(room));
  const recent = recentRoom > 0 ? [...pending].sort(byRecentWrong).slice(0, recentRoom) : [];
  const chosen = new Set(recent);
  const ordered = [
    ...recent,
    ...[...pending].sort(byPendingPriority).filter((p) => !chosen.has(p))
  ];
  return takeWithSubjectFloor(ordered, room, room, [
    { keyOf: (p) => p.paperId, max: paperCapForLimit(room) },
    { keyOf: (p) => p.conceptKey ?? null, max: conceptCapForLimit(room) }
  ]);
}
function buildDueQueue(candidates, pending = [], now = /* @__PURE__ */ new Date(), limits = {}) {
  const total = Math.max(1, limits.total ?? DUE_QUEUE_LIMIT);
  const newLimit = Math.max(0, limits.newItems ?? NEW_QUEUE_LIMIT);
  const nowIso = now.toISOString();
  const due = candidates.filter((c) => c.dueAt <= nowIso);
  const picked = takeWithSubjectFloor(
    [...due].sort((a, b) => byPriority(a, b, now)),
    total,
    subjectFloorForLimit(total),
    [
      { keyOf: (c) => c.paperId, max: paperCapForLimit(total) },
      { keyOf: (c) => c.conceptKey ?? null, max: conceptCapForLimit(total) }
    ]
  );
  const room = Math.min(newLimit, total - picked.length);
  if (room > 0 && pending.length > 0) {
    for (const p of pickPending(pending, room)) {
      picked.push({
        paperId: p.paperId,
        questionNumber: p.questionNumber,
        subjectId: p.subjectId,
        conceptKey: p.conceptKey ?? null,
        // 승격 즉시 오늘 due. 세션에서 채점되면 거기서부터 간격이 붙는다.
        dueAt: nowIso,
        lapses: 0,
        isNew: true
      });
    }
  }
  if (picked.length === 0) return [];
  return interleaveBySubject(picked);
}
function forecastDueByDay(candidates, now = /* @__PURE__ */ new Date(), input = {}) {
  const days = input.days ?? DUE_FORECAST_DAYS;
  const total = Math.max(1, input.total ?? DUE_QUEUE_LIMIT);
  const newLimit = Math.max(0, input.newItems ?? NEW_QUEUE_LIMIT);
  let pendingLeft = Math.max(0, input.pendingCount ?? 0);
  const today = srsDayIndex(now);
  const arriving = new Array(days).fill(0);
  for (const c of candidates) {
    const offset = Math.max(0, srsDayIndex(new Date(c.dueAt)) - today);
    if (offset < days) arriving[offset]++;
  }
  let carry = 0;
  return arriving.map((incoming, offset) => {
    const pool = carry + incoming;
    const dueShown = Math.min(pool, total);
    carry = pool - dueShown;
    const promoted = Math.min(newLimit, total - dueShown, pendingLeft);
    pendingLeft -= promoted;
    return { offset, count: dueShown + promoted };
  });
}
function countBySubject(items, subjectName) {
  const counts = /* @__PURE__ */ new Map();
  for (const it of items) counts.set(it.subjectId, (counts.get(it.subjectId) ?? 0) + 1);
  const out = [];
  for (const [subjectId, count] of counts) {
    const name = subjectName(subjectId);
    if (!name) continue;
    out.push({ subjectId, name, count });
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

// src/review-resume.ts
var RESUME_SPREAD_PER_DAY = 10;
var RESUME_SPREAD_MAX_DAYS = 30;
function spreadResumeDueDates(count, now = /* @__PURE__ */ new Date(), opts = {}) {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const maxDays = Math.max(1, opts.maxDays ?? RESUME_SPREAD_MAX_DAYS);
  const basePerDay = Math.max(1, opts.perDay ?? RESUME_SPREAD_PER_DAY);
  const perDay = Math.max(basePerDay, Math.ceil(n / maxDays));
  const today = srsDayIndex(now);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(srsDayStart(today + Math.floor(i / perDay)));
  }
  return out;
}

// src/rules/review-preferences.ts
var BATCH_SIZE3 = 1e3;
var UPSERT_CHUNK = 500;
async function getReviewPrefs(client, userId) {
  const { data } = await client.from("review_preferences").select("paused_subject_ids, daily_limit").eq("user_id", userId).maybeSingle();
  const row = data;
  return {
    pausedSubjectIds: new Set((row?.paused_subject_ids ?? []).filter(Boolean)),
    dailyLimit: normalizeDailyLimit(row?.daily_limit)
  };
}
async function getDiagnosisPausedSubjectIds(client, userId) {
  const { data, error } = await client.from("review_preferences").select("diagnosis_paused_subject_ids").eq("user_id", userId).maybeSingle();
  if (error) return /* @__PURE__ */ new Set();
  const row = data;
  return new Set((row?.diagnosis_paused_subject_ids ?? []).filter(Boolean));
}
async function getExcludedDiagnosisSubjectSlugs(client, userId) {
  const ids = await getDiagnosisPausedSubjectIds(client, userId);
  if (ids.size === 0) return /* @__PURE__ */ new Set();
  const { data } = await client.from("subjects").select("id, slug").in("id", [...ids]);
  return new Set((data ?? []).map((r) => r.slug).filter(Boolean));
}
async function setDiagnosisSubjectPaused(client, userId, subjectId, paused, now = /* @__PURE__ */ new Date()) {
  const current = await getDiagnosisPausedSubjectIds(client, userId);
  if (current.has(subjectId) === paused) return { pausedSubjectIds: [...current] };
  if (paused) current.add(subjectId);
  else current.delete(subjectId);
  const next = [...current];
  const { error } = await client.from("review_preferences").upsert(
    { user_id: userId, diagnosis_paused_subject_ids: next, updated_at: now.toISOString() },
    { onConflict: "user_id" }
  );
  if (error) return { error: "진단 과목 설정을 저장하지 못했어요." };
  return { pausedSubjectIds: next };
}
async function getStoredStudyPhase(client, userId) {
  const { data } = await client.from("review_preferences").select("study_phase").eq("user_id", userId).maybeSingle();
  const phase = data?.study_phase;
  return phase === "expanding" || phase === "settling" ? phase : null;
}
async function saveStudyPhase(client, userId, phase, now = /* @__PURE__ */ new Date()) {
  await client.from("review_preferences").upsert(
    {
      user_id: userId,
      study_phase: phase,
      study_phase_at: now.toISOString(),
      updated_at: now.toISOString()
    },
    { onConflict: "user_id" }
  );
}
async function getPausedSubjectIds(client, userId) {
  return (await getReviewPrefs(client, userId)).pausedSubjectIds;
}
async function setDailyLimit(client, userId, limit, now = /* @__PURE__ */ new Date()) {
  if (!DAILY_LIMIT_OPTIONS.includes(limit)) {
    return { error: "고를 수 없는 값이에요." };
  }
  const { error } = await client.from("review_preferences").upsert(
    { user_id: userId, daily_limit: limit, updated_at: now.toISOString() },
    { onConflict: "user_id" }
  );
  if (error) return { error: "하루 문항 수를 저장하지 못했어요." };
  return { dailyLimit: limit };
}
async function getReviewSubjectOptions(client, userId) {
  const byPaper = /* @__PURE__ */ new Map();
  let from = 0;
  while (true) {
    const { data } = await client.from("user_question_status").select("paper_id, srs_due_at").eq("user_id", userId).is("srs_suspended_at", null).gt("wrong_count", 0).range(from, from + BATCH_SIZE3 - 1);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const cur = byPaper.get(r.paper_id) ?? { scheduled: 0, pending: 0 };
      if (r.srs_due_at) cur.scheduled++;
      else cur.pending++;
      byPaper.set(r.paper_id, cur);
    }
    if (data.length < BATCH_SIZE3) break;
    from += BATCH_SIZE3;
  }
  if (byPaper.size === 0) return [];
  const names = /* @__PURE__ */ new Map();
  const counts = /* @__PURE__ */ new Map();
  for (const ids of chunk([...byPaper.keys()], 100)) {
    const { data } = await client.from("exam_papers").select("id, subjects(id, name)").in("id", ids);
    for (const row of data ?? []) {
      if (!row.subjects) continue;
      names.set(row.subjects.id, row.subjects.name);
      const add = byPaper.get(row.id) ?? { scheduled: 0, pending: 0 };
      const cur = counts.get(row.subjects.id) ?? { scheduled: 0, pending: 0 };
      counts.set(row.subjects.id, {
        scheduled: cur.scheduled + add.scheduled,
        pending: cur.pending + add.pending
      });
    }
  }
  const paused = await getPausedSubjectIds(client, userId);
  return [...names].map(([id, name]) => {
    const c = counts.get(id) ?? { scheduled: 0, pending: 0 };
    return {
      id,
      name,
      paused: paused.has(id),
      scheduledCount: c.scheduled,
      pendingCount: c.pending
    };
  }).sort(
    (a, b) => b.scheduledCount + b.pendingCount - (a.scheduledCount + a.pendingCount) || a.name.localeCompare(b.name, "ko")
  );
}
async function respreadResumedSubject(client, admin, userId, subjectId, now) {
  const nowIso = now.toISOString();
  const rows = [];
  let from = 0;
  while (true) {
    const { data } = await client.from("user_question_status").select("*").eq("user_id", userId).not("srs_due_at", "is", null).is("srs_suspended_at", null).lte("srs_due_at", nowIso).order("srs_due_at", { ascending: true }).range(from, from + BATCH_SIZE3 - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE3) break;
    from += BATCH_SIZE3;
  }
  if (rows.length === 0) return;
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const subjectByPaper = /* @__PURE__ */ new Map();
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await client.from("exam_papers").select("id, subject_id").in("id", ids);
    for (const p of data ?? []) {
      subjectByPaper.set(p.id, p.subject_id);
    }
  }
  const mine = rows.filter((r) => subjectByPaper.get(r.paper_id) === subjectId);
  if (mine.length === 0) return;
  const dueDates = spreadResumeDueDates(mine.length, now);
  const updated = mine.map((r, i) => ({ ...r, srs_due_at: dueDates[i].toISOString() }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    await admin.from("user_question_status").upsert(part, { onConflict: "user_id,paper_id,question_number" });
  }
}
async function spreadOverdueBacklog(client, admin, userId, now = /* @__PURE__ */ new Date()) {
  const nowIso = now.toISOString();
  const { dailyLimit } = await getReviewPrefs(client, userId);
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from("user_question_status").select("*").eq("user_id", userId).not("srs_due_at", "is", null).is("srs_suspended_at", null).lte("srs_due_at", nowIso).order("srs_due_at", { ascending: true }).range(from, from + BATCH_SIZE3 - 1);
    if (error) return { error: "밀린 복습을 정리하지 못했어요." };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE3) break;
    from += BATCH_SIZE3;
  }
  if (rows.length === 0) return { spreadCount: 0 };
  const dueDates = spreadResumeDueDates(rows.length, now, {
    perDay: Math.max(1, Math.floor(dailyLimit / 2))
  });
  const updated = rows.map((r, i) => ({ ...r, srs_due_at: dueDates[i].toISOString() }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    const { error } = await admin.from("user_question_status").upsert(part, { onConflict: "user_id,paper_id,question_number" });
    if (error) return { error: "밀린 복습을 정리하지 못했어요." };
  }
  return { spreadCount: rows.length };
}
async function restoreSuspendedQuestions(client, admin, userId, now = /* @__PURE__ */ new Date()) {
  const { dailyLimit } = await getReviewPrefs(client, userId);
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from("user_question_status").select("*").eq("user_id", userId).not("srs_suspended_at", "is", null).order("srs_suspended_at", { ascending: true }).range(from, from + BATCH_SIZE3 - 1);
    if (error) return { error: "접어둔 문제를 되살리지 못했어요." };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE3) break;
    from += BATCH_SIZE3;
  }
  if (rows.length === 0) return { restoredCount: 0 };
  const dueDates = spreadResumeDueDates(rows.length, now, {
    perDay: Math.max(1, Math.floor(dailyLimit / 4))
  });
  const updated = rows.map((r, i) => ({
    ...r,
    srs_suspended_at: null,
    srs_due_at: dueDates[i].toISOString()
  }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    const { error } = await admin.from("user_question_status").upsert(part, { onConflict: "user_id,paper_id,question_number" });
    if (error) return { error: "접어둔 문제를 되살리지 못했어요." };
  }
  return { restoredCount: rows.length };
}
async function setSubjectPaused(client, admin, userId, subjectId, paused, now = /* @__PURE__ */ new Date()) {
  const current = await getPausedSubjectIds(client, userId);
  const wasPaused = current.has(subjectId);
  if (wasPaused === paused) return { pausedSubjectIds: [...current] };
  if (paused) current.add(subjectId);
  else current.delete(subjectId);
  const next = [...current];
  const { error } = await client.from("review_preferences").upsert(
    { user_id: userId, paused_subject_ids: next, updated_at: now.toISOString() },
    { onConflict: "user_id" }
  );
  if (error) return { error: "복습 과목 설정을 저장하지 못했어요." };
  if (!paused) {
    try {
      await respreadResumedSubject(client, admin, userId, subjectId, now);
    } catch {
    }
  }
  return { pausedSubjectIds: next };
}

// src/nickname.ts
var NICKNAME_MIN = 2;
var NICKNAME_MAX = 10;
var CONTROL_CHARS = /\p{Cc}/u;
var BANNED_SUBSTRINGS = [
  // 운영진/관리자 사칭
  "admin",
  "administrator",
  "관리자",
  "운영자",
  "운영진",
  "매니저",
  "manager",
  "moderator",
  "모더레이터",
  "system",
  "시스템",
  "root",
  "공지사항",
  "notice",
  "staff",
  "스태프",
  "고객센터",
  "공모아",
  // 비속어 (일부, 완전하지 않음)
  "씨발",
  "시발",
  "병신",
  "지랄",
  "좆",
  "개새끼",
  "새끼",
  "썅",
  "닥쳐",
  "fuck",
  "shit",
  "bitch",
  "asshole"
];
function normalizeForBanCheck(s) {
  return s.toLowerCase().replace(/[^\p{L}]/gu, "");
}
function containsBannedWord(nickname) {
  const normalized = normalizeForBanCheck(nickname);
  return BANNED_SUBSTRINGS.some((word) => normalized.includes(word));
}
function validateNickname(raw) {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return {
      nickname: null,
      error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.`
    };
  }
  if (CONTROL_CHARS.test(nickname)) {
    return { nickname: null, error: "닉네임에 사용할 수 없는 문자가 포함되어 있어요." };
  }
  if (containsBannedWord(nickname)) {
    return { nickname: null, error: "사용할 수 없는 닉네임이에요." };
  }
  return { nickname, error: null };
}
var FALLBACK_NICKNAME = "회원";
function authorNickname(metadataNickname) {
  if (typeof metadataNickname !== "string") return FALLBACK_NICKNAME;
  const trimmed = metadataNickname.trim();
  return trimmed ? trimmed.slice(0, NICKNAME_MAX) : FALLBACK_NICKNAME;
}

// src/avatar.ts
var AVATAR_MAX_BYTES = 5 * 1024 * 1024;
var AVATAR_SIZE = 256;
var AVATAR_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif"
];
function isAllowedAvatarMime(mime) {
  return AVATAR_ALLOWED_MIME.includes(mime);
}
function avatarUploadError(file) {
  if (!isAllowedAvatarMime(file.type)) {
    return "JPG·PNG·WEBP·GIF 이미지만 올릴 수 있어요.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return `이미지는 ${Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))}MB 이하로 올려주세요.`;
  }
  if (file.size === 0) return "이미지를 선택해주세요.";
  return null;
}
function avatarInitial(nickname) {
  return [...String(nickname ?? "").trim()][0] ?? "회";
}
var AVATAR_PATH_RE = /^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.webp$/;
function isValidAvatarPath(path) {
  return typeof path === "string" && AVATAR_PATH_RE.test(path);
}
function avatarPublicUrl(supabaseUrl, path) {
  if (!isValidAvatarPath(path)) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path}`;
}
var AVATAR_ENCODED_MAX_BYTES = 512 * 1024;
var AVATAR_BASE64_MAX_CHARS = Math.ceil(AVATAR_ENCODED_MAX_BYTES / 3) * 4;
var AVATAR_PATHS_MAX = 200;
function u16(bytes, at) {
  return bytes[at] | bytes[at + 1] << 8;
}
function u24(bytes, at) {
  return bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
}
function u32(bytes, at) {
  return (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
}
function ascii(bytes, at, len) {
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[at + i]);
  return out;
}
function readWebpInfo(bytes) {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk2 = ascii(bytes, 12, 4);
  if (chunk2 === "VP8 ") {
    if (bytes[23] !== 157 || bytes[24] !== 1 || bytes[25] !== 42) return null;
    return {
      width: u16(bytes, 26) & 16383,
      height: u16(bytes, 28) & 16383,
      animated: false
    };
  }
  if (chunk2 === "VP8L") {
    if (bytes[20] !== 47) return null;
    const packed = u32(bytes, 21);
    return {
      width: (packed & 16383) + 1,
      height: (packed >>> 14 & 16383) + 1,
      animated: false
    };
  }
  if (chunk2 === "VP8X") {
    return {
      width: u24(bytes, 24) + 1,
      height: u24(bytes, 27) + 1,
      animated: (bytes[20] & 2) !== 0
    };
  }
  return null;
}
function avatarBytesError(bytes) {
  if (bytes.length === 0) return "이미지를 선택해주세요.";
  if (bytes.length > AVATAR_ENCODED_MAX_BYTES) {
    return "이미지가 너무 커요. 다른 사진으로 시도해주세요.";
  }
  const info = readWebpInfo(bytes);
  if (!info) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.animated) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.width !== info.height) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.width < 1 || info.width > AVATAR_SIZE) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  if (bytes.length > u32(bytes, 4) + 8) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  return null;
}
function avatarUrlMap(supabaseUrl, rows) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows ?? []) {
    const url = avatarPublicUrl(supabaseUrl, row.avatar_path);
    if (url) map.set(row.user_id, url);
  }
  return map;
}

// src/rules/avatar.ts
async function uploadUserAvatar(client, input, deps = {}) {
  const invalid = avatarBytesError(input.webp);
  if (invalid) return { error: invalid, status: 400 };
  const uuid = deps.randomUuid ?? (() => crypto.randomUUID());
  const path = `${input.userId}/${uuid()}.webp`;
  const { error: uploadError } = await client.storage.from("avatars").upload(path, input.webp, { contentType: "image/webp", cacheControl: "31536000" });
  if (uploadError) {
    console.error("[avatar] 업로드 실패:", uploadError.message);
    return {
      error: /bucket/i.test(uploadError.message) ? "이미지 저장소가 아직 준비되지 않았어요. 운영자에게 알려주세요." : "업로드에 실패했어요. 잠시 후 다시 시도해주세요.",
      status: 500
    };
  }
  const { data: previous } = await client.from("profiles").select("avatar_path").eq("user_id", input.userId).maybeSingle();
  const { error: profileError } = previous ? await client.from("profiles").update({ avatar_path: path }).eq("user_id", input.userId) : await client.from("profiles").insert({
    user_id: input.userId,
    nickname: authorNickname(await resolveNickname(client, input)),
    avatar_path: path
  });
  if (profileError) {
    await client.storage.from("avatars").remove([path]);
    return { error: "저장에 실패했어요.", status: 500 };
  }
  await writeMetadataAvatarPath(client, input.userId, path);
  const stale = previous?.avatar_path;
  if (stale && stale !== path && isOwnAvatarPath(input.userId, stale)) {
    await client.storage.from("avatars").remove([stale]);
  }
  return { avatarPath: path };
}
async function removeUserAvatar(client, input) {
  const { data: profile } = await client.from("profiles").select("avatar_path").eq("user_id", input.userId).maybeSingle();
  const { error } = await client.from("profiles").update({ avatar_path: null }).eq("user_id", input.userId);
  if (error) return { error: "삭제에 실패했어요.", status: 500 };
  await writeMetadataAvatarPath(client, input.userId, null);
  const path = profile?.avatar_path;
  if (path && isOwnAvatarPath(input.userId, path)) {
    await client.storage.from("avatars").remove([path]);
  }
  return { avatarPath: null };
}
function isOwnAvatarPath(userId, path) {
  return isValidAvatarPath(path) && path.startsWith(`${userId}/`);
}
async function resolveNickname(client, input) {
  if (input.metadataNickname !== void 0) return input.metadataNickname;
  const { data } = await client.auth.admin.getUserById(input.userId);
  return data?.user?.user_metadata?.nickname;
}
async function writeMetadataAvatarPath(client, userId, path) {
  const { error } = await client.auth.admin.updateUserById(userId, {
    user_metadata: { avatar_path: path }
  });
  if (error) console.error("[avatar] user_metadata 갱신 실패:", error.message);
}

// src/concept-key.ts
var TRAILING_NOISE = [
  "의 이해",
  "의 개념",
  "의 종류",
  "의 정의",
  "의 원리",
  "의 특징",
  "의 구분",
  "개념 정리",
  "핵심 정리",
  "정리",
  "개념",
  "종류",
  "방식",
  "기법",
  "유형",
  "이해"
];
var DERIVED_SUFFIXES = ["화", "성", "적"];
var SPLIT_PATTERN = /[\s·,、/()[\]{}<>"'“”‘’:;~\-–—]+/;
var PARTICLES = ["의", "와", "과", "및", "에서", "에 대한", "에 관한", "관련"];
function stripTrailingNoise(s) {
  let out = s;
  for (const noise of TRAILING_NOISE) {
    if (out.length > noise.length && out.endsWith(noise)) {
      out = out.slice(0, -noise.length).trim();
    }
  }
  return out;
}
function stripParticle(token) {
  for (const p of PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return token;
}
function stripDerived(token) {
  for (const suffix of DERIVED_SUFFIXES) {
    if (token.length >= 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}
function conceptKeyOf(keywordTitle) {
  if (!keywordTitle) return null;
  const cleaned = stripTrailingNoise(keywordTitle.trim());
  if (!cleaned) return null;
  for (const raw of cleaned.split(SPLIT_PATTERN)) {
    const token = stripDerived(stripParticle(raw.trim()));
    if (token.length >= 2) return token.toLowerCase();
  }
  return cleaned.toLowerCase();
}

// src/rules/review-queue.ts
var BATCH_SIZE4 = 1e3;
var PENDING_FETCH_LIMIT = 300;
var PENDING_RECENT_FETCH_LIMIT = 100;
var CONCEPT_WINDOW_MULTIPLIER = 3;
function forecastWindowEnd(now) {
  const endDayIndex = srsDayIndex(now) + DUE_FORECAST_DAYS;
  return new Date(
    (endDayIndex * 24 + 4) * 60 * 60 * 1e3 - 9 * 60 * 60 * 1e3
  ).toISOString();
}
async function fetchConceptKeys(questionIds, adminFactory) {
  const out = /* @__PURE__ */ new Map();
  if (questionIds.length === 0) return out;
  let admin;
  try {
    admin = adminFactory();
  } catch {
    return out;
  }
  for (const columns of ["question_id, keyword_title, concept_id", "question_id, keyword_title"]) {
    try {
      let failed = false;
      const found = /* @__PURE__ */ new Map();
      for (const ids of chunk(questionIds, 200)) {
        const { data, error } = await admin.from("question_explanations").select(columns).in("question_id", ids);
        if (error) {
          failed = true;
          break;
        }
        for (const row of data ?? []) {
          const key = row.concept_id ?? conceptKeyOf(row.keyword_title);
          if (key) found.set(row.question_id, key);
        }
      }
      if (!failed) return found;
    } catch {
    }
  }
  return out;
}
async function collectDueCandidates(client, userId, now = /* @__PURE__ */ new Date(), adminFactory) {
  const windowEnd = forecastWindowEnd(now);
  const { pausedSubjectIds: paused, dailyLimit } = await getReviewPrefs(client, userId);
  const empty = {
    candidates: [],
    pending: [],
    pendingSources: /* @__PURE__ */ new Map(),
    subjectNames: /* @__PURE__ */ new Map(),
    pausedSubjectIds: paused,
    dailyLimit
  };
  const statusRows = [];
  {
    let from = 0;
    while (true) {
      const { data } = await client.from("user_question_status").select("paper_id, question_number, last_answered_at, srs_due_at, srs_lapses").eq("user_id", userId).not("srs_due_at", "is", null).is("srs_suspended_at", null).lte("srs_due_at", windowEnd).range(from, from + BATCH_SIZE4 - 1);
      if (!data || data.length === 0) break;
      statusRows.push(...data);
      if (data.length < BATCH_SIZE4) break;
      from += BATCH_SIZE4;
    }
  }
  const [
    { data: pendingData },
    { data: pendingRecentData },
    { count: pendingCount },
    { count: suspendedCount }
  ] = await Promise.all([
    client.from("user_question_status").select("paper_id, question_number, last_answered_at, wrong_count").eq("user_id", userId).is("srs_due_at", null).is("srs_suspended_at", null).gt("wrong_count", 0).order("wrong_count", { ascending: false }).order("last_answered_at", { ascending: true }).limit(PENDING_FETCH_LIMIT),
    // 최근에 틀린 순 한 벌 더. 위 조회의 창이 오래된 쪽에 고정돼 있어, 이게
    // 없으면 어제 오답이 승격 후보에 아예 못 들어온다.
    client.from("user_question_status").select("paper_id, question_number, last_answered_at, wrong_count").eq("user_id", userId).is("srs_due_at", null).is("srs_suspended_at", null).gt("wrong_count", 0).order("last_answered_at", { ascending: false }).limit(PENDING_RECENT_FETCH_LIMIT),
    client.from("user_question_status").select("paper_id", { count: "exact", head: true }).eq("user_id", userId).is("srs_due_at", null).is("srs_suspended_at", null).gt("wrong_count", 0),
    // 접어둔 문항 수. 큐에서 사라진 문항이 어디로 갔는지 화면에서 말해줘야 한다 —
    // 조용히 없어지면 사용자는 데이터가 날아간 걸로 읽는다.
    client.from("user_question_status").select("paper_id", { count: "exact", head: true }).eq("user_id", userId).not("srs_suspended_at", "is", null)
  ]);
  const pendingRows = [];
  {
    const seen = /* @__PURE__ */ new Set();
    for (const r of [...pendingData ?? [], ...pendingRecentData ?? []]) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pendingRows.push(r);
    }
  }
  const pendingTotal = pendingCount ?? 0;
  const suspendedTotal = suspendedCount ?? 0;
  if (statusRows.length === 0 && pendingRows.length === 0) {
    return { ...empty, pendingTotal, suspendedTotal };
  }
  const marks = await fetchWrongNoteMarks(client, userId);
  const paperIds = [
    ...new Set([...statusRows, ...pendingRows].map((r) => r.paper_id))
  ];
  const papers = [];
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await client.from("exam_papers").select("id, subject_id, exam_type_id, year, round, level, subjects(id, name)").in("id", ids);
    for (const p of data ?? []) papers.push(p);
  }
  const { repByPaperId } = representativePaperIds(
    papers.map((p) => ({ ...p, title: "" }))
  );
  const repId = (paperId) => repByPaperId.get(paperId) ?? paperId;
  const subjectOfPaper = /* @__PURE__ */ new Map();
  for (const p of papers) if (p.subjects) subjectOfPaper.set(p.id, p.subjects);
  const deletedRepKeys = /* @__PURE__ */ new Set();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }
  const byRepQ = /* @__PURE__ */ new Map();
  for (const r of statusRows) {
    const rep = repId(r.paper_id);
    const key = `${rep}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const ex = byRepQ.get(key);
    if (ex && r.last_answered_at <= ex.at) continue;
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    byRepQ.set(key, {
      dueAt: r.srs_due_at,
      lapses: r.srs_lapses ?? 0,
      at: r.last_answered_at,
      subjectId: subj?.id ?? null
    });
  }
  const pendingByRepQ = /* @__PURE__ */ new Map();
  const pendingSources = /* @__PURE__ */ new Map();
  for (const r of pendingRows) {
    const rep = repId(r.paper_id);
    const key = `${rep}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const sources = pendingSources.get(key) ?? [];
    if (!sources.includes(r.paper_id)) sources.push(r.paper_id);
    pendingSources.set(key, sources);
    if (byRepQ.has(key)) continue;
    const ex = pendingByRepQ.get(key);
    const wrongCount = Math.max(ex?.wrongCount ?? 0, r.wrong_count ?? 0);
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    if (!ex || r.last_answered_at > ex.at) {
      pendingByRepQ.set(key, {
        wrongCount,
        at: r.last_answered_at,
        subjectId: subj?.id ?? null
      });
    } else {
      ex.wrongCount = wrongCount;
    }
  }
  const repIds = [
    ...new Set(
      [...byRepQ.keys(), ...pendingByRepQ.keys()].map((k) => k.slice(0, k.lastIndexOf("#")))
    )
  ];
  const mediaByPaper = await fetchQuestionMedia(client, repIds);
  const candidates = [];
  for (const [key, v] of byRepQ) {
    const idx = key.lastIndexOf("#");
    const paperId = key.slice(0, idx);
    const questionNumber = Number(key.slice(idx + 1));
    if (!mediaByPaper.get(paperId)?.get(questionNumber)?.images.length) continue;
    if (v.subjectId && paused.has(v.subjectId)) continue;
    candidates.push({
      paperId,
      questionNumber,
      subjectId: v.subjectId,
      dueAt: v.dueAt,
      lapses: v.lapses
    });
  }
  const pending = [];
  for (const [key, v] of pendingByRepQ) {
    const idx = key.lastIndexOf("#");
    const paperId = key.slice(0, idx);
    const questionNumber = Number(key.slice(idx + 1));
    if (!mediaByPaper.get(paperId)?.get(questionNumber)?.images.length) continue;
    if (v.subjectId && paused.has(v.subjectId)) continue;
    pending.push({
      paperId,
      questionNumber,
      subjectId: v.subjectId,
      wrongCount: v.wrongCount,
      lastAnsweredAt: v.at
    });
  }
  {
    const window = Math.max(60, dailyLimit * CONCEPT_WINDOW_MULTIPLIER);
    const nowIso = now.toISOString();
    const topDue = candidates.filter((c) => c.dueAt <= nowIso).sort((a, b) => duePriorityScore(b, now) - duePriorityScore(a, now)).slice(0, window);
    const topPending = [...pending].sort(
      (a, b) => b.wrongCount - a.wrongCount || (a.lastAnsweredAt < b.lastAnsweredAt ? -1 : 1)
    ).slice(0, window);
    const questionIdOf = (paperId, questionNumber) => mediaByPaper.get(paperId)?.get(questionNumber)?.questionId ?? null;
    const ids = /* @__PURE__ */ new Set();
    for (const c of [...topDue, ...topPending]) {
      const id = questionIdOf(c.paperId, c.questionNumber);
      if (id) ids.add(id);
    }
    const conceptByQuestionId = await fetchConceptKeys([...ids], adminFactory);
    if (conceptByQuestionId.size > 0) {
      for (const c of [...topDue, ...topPending]) {
        const id = questionIdOf(c.paperId, c.questionNumber);
        c.conceptKey = id ? conceptByQuestionId.get(id) ?? null : null;
      }
    }
  }
  const subjectNames = /* @__PURE__ */ new Map();
  for (const s of subjectOfPaper.values()) if (!paused.has(s.id)) subjectNames.set(s.id, s.name);
  return {
    candidates,
    pending,
    pendingSources,
    pendingTotal,
    suspendedTotal,
    subjectNames,
    pausedSubjectIds: paused,
    dailyLimit
  };
}
async function getDueReviewSummary(client, userId, now = /* @__PURE__ */ new Date(), adminFactory) {
  const { candidates, pending, pendingTotal, suspendedTotal, subjectNames, dailyLimit } = await collectDueCandidates(client, userId, now, adminFactory);
  const queue = buildDueQueue(candidates, pending, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit)
  });
  const nowIso = now.toISOString();
  const dueTotal = candidates.filter((c) => c.dueAt <= nowIso).length;
  const newCount = queue.filter((c) => c.isNew).length;
  const today = srsDayIndex(now);
  const relearnCount = candidates.filter(
    (c) => c.dueAt > nowIso && srsDayIndex(new Date(c.dueAt)) === today
  ).length;
  const forecast = forecastDueByDay(candidates, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit),
    pendingCount: pending.length
  });
  const nextDue = forecast.find((d) => d.offset > 0 && d.count > 0);
  return {
    todayCount: queue.length,
    // 승격된 신규는 상한에 걸린 게 아니므로 "밀린 수"에서 뺀다.
    deferredCount: Math.max(0, dueTotal - (queue.length - newCount)),
    newCount,
    // 오늘 태울 몫은 이미 큐에 들어왔으니 대기 중 숫자에서 뺀다.
    pendingTotal: Math.max(0, pendingTotal - newCount),
    suspendedTotal,
    overdueTotal: dueTotal,
    relearnCount,
    dailyLimit,
    subjects: countBySubject(queue, (id) => id ? subjectNames.get(id) ?? null : null),
    forecast,
    nextDueOffset: queue.length === 0 ? nextDue?.offset ?? null : null
  };
}
async function getSessionSchedule(client, userId, sessionId, now = /* @__PURE__ */ new Date(), adminFactory) {
  const admin = adminFactory();
  const { data: session } = await admin.from("review_sessions").select("id, user_id, submitted_at").eq("id", sessionId).maybeSingle();
  if (!session || session.user_id !== userId || session.submitted_at == null) return null;
  const { data: itemRows } = await admin.from("review_session_items").select("paper_id, question_number, position").eq("session_id", sessionId).order("position", { ascending: true });
  const sessionItems = itemRows ?? [];
  if (sessionItems.length === 0) return null;
  const paperIds = [...new Set(sessionItems.map((r) => r.paper_id))];
  let targets = /* @__PURE__ */ new Map();
  try {
    targets = await resolveStatusTargets(
      client,
      userId,
      sessionItems.map((it) => ({
        paperId: it.paper_id,
        questionNumber: it.question_number
      })),
      { answersClient: admin }
    );
  } catch {
  }
  const lookupIds = new Set(paperIds);
  for (const ids of targets.values()) for (const id of ids) lookupIds.add(id);
  const dueByKey = /* @__PURE__ */ new Map();
  for (const ids of chunk([...lookupIds], 100)) {
    const { data } = await client.from("user_question_status").select("paper_id, question_number, srs_due_at").eq("user_id", userId).in("paper_id", ids).not("srs_due_at", "is", null);
    for (const r of data ?? []) {
      dueByKey.set(`${r.paper_id}#${r.question_number}`, r.srs_due_at);
    }
  }
  const titleById = /* @__PURE__ */ new Map();
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await client.from("exam_papers").select("id, title").in("id", ids);
    for (const p of data ?? []) {
      titleById.set(p.id, p.title);
    }
  }
  const today = srsDayIndex(now);
  const items = sessionItems.map((it) => {
    let due;
    const candidates2 = targets.get(statusTargetKey(it.paper_id, it.question_number)) ?? [
      it.paper_id
    ];
    for (const paperId of [...candidates2, it.paper_id]) {
      const found = dueByKey.get(`${paperId}#${it.question_number}`);
      if (found && (due == null || found < due)) due = found;
    }
    return {
      position: it.position,
      paperTitle: titleById.get(it.paper_id) ?? null,
      questionNumber: it.question_number,
      dueInDays: due ? Math.max(0, srsDayIndex(new Date(due)) - today) : null
    };
  });
  const { candidates, pending, dailyLimit } = await collectDueCandidates(
    client,
    userId,
    now,
    adminFactory
  );
  return {
    items,
    forecast: forecastDueByDay(candidates, now, {
      total: dailyLimit,
      newItems: newItemsForLimit(dailyLimit),
      pendingCount: pending.length
    })
  };
}
async function promotePendingItems(promoted, pendingSources, userId, now, adminFactory) {
  if (promoted.length === 0) return;
  const admin = adminFactory();
  const nowIso = now.toISOString();
  for (const c of promoted) {
    const key = `${c.paperId}#${c.questionNumber}`;
    const paperIds = pendingSources.get(key) ?? [c.paperId];
    await admin.from("user_question_status").update({ srs_due_at: nowIso, updated_at: nowIso }).eq("user_id", userId).eq("question_number", c.questionNumber).in("paper_id", paperIds).is("srs_due_at", null);
  }
}
async function collectDueQueueItems(client, userId, now = /* @__PURE__ */ new Date(), adminFactory) {
  const { candidates, pending, pendingSources, dailyLimit } = await collectDueCandidates(
    client,
    userId,
    now,
    adminFactory
  );
  const queue = buildDueQueue(candidates, pending, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit)
  });
  try {
    await promotePendingItems(
      queue.filter((c) => c.isNew),
      pendingSources,
      userId,
      now,
      adminFactory
    );
  } catch {
  }
  return queue.map((c) => ({ paperId: c.paperId, questionNumber: c.questionNumber }));
}
async function collectExtraQueueItems(client, userId, now = /* @__PURE__ */ new Date(), adminFactory) {
  const { candidates, pending, pendingSources, dailyLimit } = await collectDueCandidates(
    client,
    userId,
    now,
    adminFactory
  );
  const nowIso = now.toISOString();
  if (candidates.some((c) => c.dueAt <= nowIso)) {
    return { items: [], error: "오늘 예정된 복습을 먼저 끝내주세요." };
  }
  if (pending.length === 0) {
    return { items: [], error: "더 가져올 오답이 없어요." };
  }
  const batch = buildDueQueue([], pending, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit)
  });
  try {
    await promotePendingItems(batch, pendingSources, userId, now, adminFactory);
  } catch {
  }
  return {
    items: batch.map((c) => ({ paperId: c.paperId, questionNumber: c.questionNumber }))
  };
}

// src/review-pick.ts
var REVIEW_PICK_RECENT_DAYS = 30;
var REVIEW_PICK_TIER_WEIGHTS = [3, 2, 1];
var REVIEW_PICK_REPEAT_THRESHOLD = 2;
function reviewPickTier(c, now = /* @__PURE__ */ new Date()) {
  if (c.wrongCount >= REVIEW_PICK_REPEAT_THRESHOLD) return 0;
  const cutoff = now.getTime() - REVIEW_PICK_RECENT_DAYS * 24 * 60 * 60 * 1e3;
  const at = Date.parse(c.lastWrongAt);
  if (Number.isFinite(at) && at >= cutoff) return 1;
  return 2;
}
function shuffleInPlace(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function tierQuotas(limit) {
  const weights = [...REVIEW_PICK_TIER_WEIGHTS];
  const total = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => limit * w / total);
  const quotas = exact.map((v) => Math.floor(v));
  let left = limit - quotas.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    quotas[i]++;
    left--;
  }
  return quotas;
}
function pickWeightedReviewCandidates(candidates, limit, opts = {}) {
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0 || candidates.length === 0) return [];
  if (candidates.length <= cap) return shuffleInPlace([...candidates], rand);
  const buckets = [[], [], []];
  for (const c of candidates) buckets[reviewPickTier(c, now)].push(c);
  for (const b of buckets) shuffleInPlace(b, rand);
  const quotas = tierQuotas(cap);
  const picked = [];
  const taken = [0, 0, 0];
  for (let t = 0; t < buckets.length; t++) {
    const take = Math.min(quotas[t], buckets[t].length);
    for (let i = 0; i < take; i++) picked.push(buckets[t][i]);
    taken[t] = take;
  }
  for (let t = 0; picked.length < cap && t < buckets.length; t++) {
    for (let i = taken[t]; picked.length < cap && i < buckets[t].length; i++) {
      picked.push(buckets[t][i]);
    }
  }
  return shuffleInPlace(picked, rand);
}
function pickRandomReviewCandidates(candidates, limit, rand = Math.random) {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];
  return shuffleInPlace([...candidates], rand).slice(0, cap);
}
function pickReviewCandidates(candidates, limit, strategy, opts = {}) {
  return strategy === "random" ? pickRandomReviewCandidates(candidates, limit, opts.rand) : pickWeightedReviewCandidates(candidates, limit, opts);
}

// src/rules/review-session.ts
var DEFAULT_LIMIT = 20;
var REVIEW_SESSION_MAX_LIMIT = 50;
var MAX_LIMIT = REVIEW_SESSION_MAX_LIMIT;
var DUE_SCOPE = "due";
function shuffle(arr, random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
async function collectSubjectReviewSource(client, userId, subjectSlug) {
  const { data: subj } = await client.from("subjects").select("id").eq("slug", subjectSlug).maybeSingle();
  const subjectId = subj?.id;
  if (!subjectId) return null;
  const candidates = await collectAllReviewCandidates(client, userId, {
    includeResolved: true,
    subjectId
  });
  return {
    subject: { id: subjectId },
    questions: candidates.map((c) => ({
      paperId: c.paperId,
      questionNumber: c.questionNumber,
      wrongCount: c.wrongCount,
      lastWrongAt: c.lastWrongAt,
      resolved: c.resolved,
      images: c.images
    }))
  };
}
async function createReviewSessionForUser(client, admin, userId, input, deps = {}) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const note = await (deps.loadSubject ?? collectSubjectReviewSource)(
    client,
    userId,
    input.subjectSlug
  );
  if (!note) return { error: "과목을 찾을 수 없어요." };
  let candidates = note.questions.filter((q) => q.images.length > 0);
  if (input.onlyUnresolved) candidates = candidates.filter((q) => !q.resolved);
  if (input.onlyDue) {
    const cutoff = new Date(
      now.getTime() - REVIEW_COOLDOWN_HOURS * 3600 * 1e3
    ).toISOString();
    candidates = candidates.filter((q) => q.lastWrongAt <= cutoff);
  }
  if (candidates.length === 0) {
    return {
      error: input.onlyDue ? "지금 복습할 문항이 없어요. 하루 뒤에 다시 확인해보세요." : input.onlyUnresolved ? "아직 안 극복한(이미지가 있는) 오답이 없어요." : "이 과목에 다시 풀 오답이 없어요."
    };
  }
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const picked = pickReviewCandidates(candidates, limit, input.strategy ?? "weighted");
  return insertReviewSession(admin, userId, picked, {
    subjectId: note.subject.id,
    scope: "subject",
    onlyUnresolved: input.onlyUnresolved,
    requestId: input.requestId ?? null
  });
}
async function collectAllReviewCandidates(client, userId, opts) {
  const statusRows = [];
  {
    let from = 0;
    const SIZE = 1e3;
    while (true) {
      const { data } = await client.from("user_question_status").select("paper_id, question_number, last_is_correct, last_answered_at, wrong_count").eq("user_id", userId).gt("wrong_count", 0).range(from, from + SIZE - 1);
      if (!data || data.length === 0) break;
      statusRows.push(...data);
      if (data.length < SIZE) break;
      from += SIZE;
    }
  }
  if (statusRows.length === 0) return [];
  const marks = await fetchWrongNoteMarks(client, userId);
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];
  const papers = [];
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await client.from("exam_papers").select("id, subject_id, exam_type_id, year, round, level").in("id", ids);
    for (const p of data ?? []) papers.push(p);
  }
  const allowedPapers = opts.subjectId ? new Set(papers.filter((p) => p.subject_id === opts.subjectId).map((p) => p.id)) : null;
  const { repByPaperId } = representativePaperIds(
    papers.map((p) => ({ ...p, title: "" }))
  );
  const repId = (paperId) => repByPaperId.get(paperId) ?? paperId;
  const deletedRepKeys = /* @__PURE__ */ new Set();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }
  const byRepQ = /* @__PURE__ */ new Map();
  for (const r of statusRows) {
    if (allowedPapers && !allowedPapers.has(r.paper_id)) continue;
    const key = `${repId(r.paper_id)}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const ex = byRepQ.get(key);
    const wrongCount = Math.max(ex?.wrongCount ?? 0, r.wrong_count ?? 0);
    if (!ex || r.last_answered_at > ex.at) {
      byRepQ.set(key, { resolved: r.last_is_correct, at: r.last_answered_at, wrongCount });
    } else {
      ex.wrongCount = wrongCount;
    }
  }
  const repIds = [...new Set([...byRepQ.keys()].map((k) => k.split("#")[0]))];
  const mediaByPaper = await fetchQuestionMedia(client, repIds);
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const cutoff = opts.onlyDue ? new Date(now.getTime() - REVIEW_COOLDOWN_HOURS * 3600 * 1e3).toISOString() : null;
  const candidates = [];
  for (const [key, v] of byRepQ) {
    if (!opts.includeResolved && v.resolved) continue;
    if (cutoff && v.at > cutoff) continue;
    const [rep, qnumStr] = key.split("#");
    const qnum = Number(qnumStr);
    const images = mediaByPaper.get(rep)?.get(qnum)?.images ?? [];
    if (images.length === 0) continue;
    candidates.push({
      paperId: rep,
      questionNumber: qnum,
      wrongCount: v.wrongCount,
      lastWrongAt: v.at,
      resolved: v.resolved,
      images
    });
  }
  return candidates;
}
async function collectPaperReviewCandidates(client, userId, paperIds) {
  if (paperIds.length === 0) return [];
  const rows = [];
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await client.from("user_question_status").select("paper_id, question_number").eq("user_id", userId).in("paper_id", ids).gt("wrong_count", 0);
    for (const r of data ?? []) rows.push(r);
  }
  if (rows.length === 0) return [];
  const [mediaByPaper, marks] = await Promise.all([
    fetchQuestionMedia(client, paperIds),
    fetchWrongNoteMarks(client, userId, paperIds)
  ]);
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const r of rows) {
    if (!mediaByPaper.get(r.paper_id)?.get(r.question_number)?.images.length) continue;
    const key = `${r.paper_id}#${r.question_number}`;
    if (marks.deleted.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ paperId: r.paper_id, questionNumber: r.question_number });
  }
  return items;
}
async function createPaperReviewSessionForUser(client, admin, userId, paperIds, opts = {}) {
  const items = await collectPaperReviewCandidates(client, userId, paperIds);
  if (items.length === 0) {
    return { error: "다시 풀 (이미지가 있는) 틀린 문제가 없어요." };
  }
  return createReviewSessionFromItems(admin, userId, items, MAX_LIMIT, {
    requestId: opts.requestId ?? null,
    random: opts.random
  });
}
async function createAllReviewSessionForUser(client, admin, userId, opts) {
  const candidates = await collectAllReviewCandidates(client, userId, opts);
  const limit = Math.min(Math.max(1, opts.limit ?? MAX_LIMIT), MAX_LIMIT);
  const items = pickReviewCandidates(candidates, limit, opts.strategy ?? "weighted");
  if (items.length === 0) {
    return {
      error: opts.onlyDue ? "지금 복습할 문항이 없어요. 하루 뒤에 다시 확인해보세요." : opts.includeResolved ? "다시 풀 문항이 없어요." : "아직 안 극복한(이미지가 있는) 오답이 없어요."
    };
  }
  return createReviewSessionFromItems(admin, userId, items, items.length, {
    keepOrder: true,
    requestId: opts.requestId ?? null
  });
}
var FROM_ITEMS_INPUT_MAX = 200;
async function filterQuestionsAnsweredByUser(client, items, userId) {
  const clean = items.filter(
    (it) => typeof it?.paperId === "string" && it.paperId.length > 0 && Number.isInteger(it?.questionNumber)
  ).slice(0, FROM_ITEMS_INPUT_MAX);
  if (clean.length === 0) return [];
  let query = client.from("user_question_status").select("paper_id, question_number").in("paper_id", [...new Set(clean.map((it) => it.paperId))]);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query;
  const mine = new Set(
    (data ?? []).map(
      (r) => `${r.paper_id}#${r.question_number}`
    )
  );
  return clean.filter((it) => mine.has(`${it.paperId}#${it.questionNumber}`));
}
var UNIQUE_VIOLATION = "23505";
async function insertReviewSession(admin, userId, picked, opts) {
  const row = {
    user_id: userId,
    subject_id: opts.subjectId,
    scope: opts.scope,
    only_unresolved: opts.onlyUnresolved,
    total_questions: picked.length
  };
  if (opts.requestId) row.request_id = opts.requestId;
  const { data: session, error: sessionError } = await admin.from("review_sessions").insert(row).select("id").single();
  if (sessionError || !session) {
    if (opts.requestId && sessionError?.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin.from("review_sessions").select("id").eq("user_id", userId).eq("request_id", opts.requestId).maybeSingle();
      if (existing) return { sessionId: existing.id };
    }
    return { error: "세션 생성에 실패했어요." };
  }
  const sessionId = session.id;
  const { error: itemsError } = await admin.from("review_session_items").insert(
    picked.map((q, i) => ({
      session_id: sessionId,
      paper_id: q.paperId,
      question_number: q.questionNumber,
      position: i,
      selected_choice: null,
      is_correct: null
    }))
  );
  if (itemsError) {
    await admin.from("review_sessions").delete().eq("id", sessionId);
    return { error: "세션 생성에 실패했어요." };
  }
  return { sessionId };
}
async function createReviewSessionFromItems(admin, userId, items, limit = MAX_LIMIT, opts = {}) {
  const seen = /* @__PURE__ */ new Set();
  const clean = [];
  for (const it of items) {
    if (!it?.paperId || !Number.isInteger(it?.questionNumber)) continue;
    const key = `${it.paperId}#${it.questionNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ paperId: it.paperId, questionNumber: it.questionNumber });
  }
  if (clean.length === 0) return { error: "다시 풀 문항이 없어요." };
  const cap = Math.min(Math.max(1, limit), opts.maxLimit ?? MAX_LIMIT);
  const picked = (opts.keepOrder ? clean : shuffle(clean, opts.random ?? Math.random)).slice(
    0,
    cap
  );
  return insertReviewSession(admin, userId, picked, {
    subjectId: opts.subjectId ?? null,
    // 'due'는 복습(간격 반복) 세션. 이걸로 "이어서 풀기"가 섞어풀기 세션을
    // 잘못 집어오지 않게 구분한다.
    scope: opts.scope ?? "subject",
    onlyUnresolved: true,
    requestId: opts.requestId ?? null
  });
}
async function createDueReviewSessionForUser(admin, userId, items, opts = {}) {
  if (items.length === 0) {
    return { error: "오늘 복습할 문항이 없어요." };
  }
  return createReviewSessionFromItems(admin, userId, items, items.length, {
    keepOrder: true,
    scope: DUE_SCOPE,
    requestId: opts.requestId ?? null
  });
}
var RESUME_MAX_AGE_HOURS = 24;
async function findUnfinishedDueSession(admin, userId, now = /* @__PURE__ */ new Date()) {
  const since = new Date(
    now.getTime() - RESUME_MAX_AGE_HOURS * 60 * 60 * 1e3
  ).toISOString();
  const { data } = await admin.from("review_sessions").select("id, total_questions").eq("user_id", userId).eq("scope", DUE_SCOPE).is("submitted_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data;
  return { sessionId: row.id, total: row.total_questions };
}
async function markReviewItemGuessed(admin, userId, sessionId, position, now = /* @__PURE__ */ new Date()) {
  const { data: session } = await admin.from("review_sessions").select("id, user_id, submitted_at").eq("id", sessionId).maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  if (session.submitted_at == null) return { error: "채점 후에 표시할 수 있어요." };
  const { data: item } = await admin.from("review_session_items").select("id, paper_id, question_number, is_correct").eq("session_id", sessionId).eq("position", position).maybeSingle();
  if (!item) return { error: "문항을 찾을 수 없어요." };
  if (item.is_correct !== true) return {};
  await admin.from("review_session_items").update({ guessed: true }).eq("id", item.id);
  const { data: status } = await admin.from("user_question_status").select("srs_interval_days, srs_ease, srs_reps, srs_lapses, srs_due_at").eq("user_id", userId).eq("paper_id", item.paper_id).eq("question_number", item.question_number).maybeSingle();
  if (!status?.srs_due_at) return {};
  const { dueAt } = srsGuessed(srsStateFromRow(status), now);
  await admin.from("user_question_status").update({ srs_due_at: dueAt.toISOString(), updated_at: now.toISOString() }).eq("user_id", userId).eq("paper_id", item.paper_id).eq("question_number", item.question_number);
  return {};
}
async function collectConceptReviewCandidates(client, admin, concept, subjectSlug, conceptId) {
  const kw = concept.trim();
  if (!kw && !conceptId) return [];
  const explQuery = admin.from("question_explanations").select("question_id").limit(500);
  const { data: expl } = await (conceptId ? explQuery.eq("concept_id", conceptId) : explQuery.eq("keyword_title", kw));
  const questionIds = [
    ...new Set((expl ?? []).map((r) => r.question_id))
  ];
  if (questionIds.length === 0) return [];
  let subjectId = null;
  if (subjectSlug) {
    const { data: subj } = await admin.from("subjects").select("id").eq("slug", subjectSlug).maybeSingle();
    subjectId = subj?.id ?? null;
  }
  const rows = [];
  for (const ids of chunk(questionIds, 100)) {
    const q = subjectId ? admin.from("questions").select("paper_id, question_number, exam_papers!inner(subject_id)").in("id", ids).eq("exam_papers.subject_id", subjectId) : admin.from("questions").select("paper_id, question_number").in("id", ids);
    const { data } = await q;
    for (const r of data ?? []) {
      rows.push({ paper_id: r.paper_id, question_number: r.question_number });
    }
  }
  if (rows.length === 0) return [];
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const mediaByPaper = await fetchQuestionMedia(client, paperIds);
  const voidedByPaper = /* @__PURE__ */ new Map();
  for (const ids of chunk(paperIds, 200)) {
    const { data } = await admin.from("paper_answers").select("paper_id, voided_questions").in("paper_id", ids);
    for (const row of data ?? []) {
      voidedByPaper.set(row.paper_id, new Set(row.voided_questions ?? []));
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const r of rows) {
    if (!mediaByPaper.get(r.paper_id)?.get(r.question_number)?.images.length) continue;
    if (voidedByPaper.get(r.paper_id)?.has(r.question_number)) continue;
    const key = `${r.paper_id}#${r.question_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ paperId: r.paper_id, questionNumber: r.question_number });
  }
  return items;
}
async function createConceptReviewSessionForUser(client, admin, userId, input, deps = {}) {
  const items = await collectConceptReviewCandidates(
    client,
    admin,
    input.concept,
    input.subjectSlug,
    input.conceptId ?? null
  );
  if (items.length === 0) {
    return { error: "이 개념으로 풀 수 있는 기출 문항을 찾지 못했어요." };
  }
  return createReviewSessionFromItems(admin, userId, items, input.limit ?? 5, {
    requestId: input.requestId ?? null,
    random: deps.random
  });
}
async function getReviewSessionView(client, admin, userId, sessionId) {
  const { data: session } = await admin.from("review_sessions").select("id, user_id, subject_id, scope, total_questions, score, submitted_at, created_at").eq("id", sessionId).maybeSingle();
  if (!session || session.user_id !== userId) return null;
  const { data: itemRows } = await admin.from("review_session_items").select("id, paper_id, question_number, position, selected_choice, is_correct, guessed").eq("session_id", sessionId).order("position", { ascending: true });
  const items = itemRows ?? [];
  const submitted = session.submitted_at != null;
  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const mediaByPaper = await fetchQuestionMedia(client, paperIds);
  const paperMeta = /* @__PURE__ */ new Map();
  if (paperIds.length > 0) {
    const { data: papers } = await client.from("exam_papers").select("id, title, choice_count").in("id", paperIds);
    for (const p of papers ?? []) {
      paperMeta.set(p.id, { title: p.title, choiceCount: p.choice_count });
    }
  }
  const answersByPaper = /* @__PURE__ */ new Map();
  if (submitted && paperIds.length > 0) {
    const { data: ans } = await admin.from("paper_answers").select("paper_id, answers").in("paper_id", paperIds);
    for (const row of ans ?? []) {
      answersByPaper.set(row.paper_id, row.answers ?? []);
    }
  }
  let subjectSlug = null;
  let subjectName = null;
  if (session.subject_id) {
    const { data: subj } = await client.from("subjects").select("slug, name").eq("id", session.subject_id).maybeSingle();
    if (subj) {
      subjectSlug = subj.slug;
      subjectName = subj.name;
    }
  }
  const viewItems = items.map((it) => {
    const media = mediaByPaper.get(it.paper_id)?.get(it.question_number);
    const meta = paperMeta.get(it.paper_id);
    return {
      position: it.position,
      images: media?.images ?? [],
      choiceCount: media?.choiceCount ?? meta?.choiceCount ?? 4,
      selectedChoice: submitted ? it.selected_choice : null,
      correctChoice: submitted ? answersByPaper.get(it.paper_id)?.[it.question_number - 1] ?? null : null,
      isCorrect: submitted ? it.is_correct : null,
      paperId: submitted ? it.paper_id : null,
      paperTitle: submitted ? meta?.title ?? null : null,
      questionNumber: submitted ? it.question_number : null,
      guessed: submitted ? it.guessed === true : false
    };
  });
  return {
    id: session.id,
    scope: session.scope ?? "subject",
    createdAt: session.created_at,
    subjectSlug,
    subjectName,
    total: session.total_questions,
    score: session.score ?? null,
    submitted,
    items: viewItems
  };
}
function toReviewSolveItems(view) {
  return view.items.map((it) => ({
    position: it.position,
    images: it.images,
    choiceCount: it.choiceCount
  }));
}
function toReviewResultItems(view) {
  return view.items.map((it) => ({
    position: it.position,
    images: it.images,
    choiceCount: it.choiceCount,
    selectedChoice: it.selectedChoice,
    correctChoice: it.correctChoice,
    isCorrect: it.isCorrect === true,
    paperTitle: it.paperTitle,
    questionNumber: it.questionNumber,
    guessed: it.guessed,
    paperId: it.paperId
  }));
}
async function listSubmittedReviewSessions(admin, userId, opts = {}) {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const embed = opts.subjectSlug ? "subjects!inner(slug, name)" : "subjects(slug, name)";
  let query = admin.from("review_sessions").select(`id, scope, subject_id, total_questions, score, created_at, submitted_at, ${embed}`).eq("user_id", userId).not("submitted_at", "is", null).order("created_at", { ascending: false }).limit(limit);
  if (opts.scope) query = query.eq("scope", opts.scope);
  if (opts.subjectSlug) query = query.eq("subjects.slug", opts.subjectSlug);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => {
    const subject = Array.isArray(s.subjects) ? s.subjects[0] ?? null : s.subjects;
    return {
      sessionId: s.id,
      scope: s.scope ?? "subject",
      subjectSlug: subject?.slug ?? null,
      subjectName: subject?.name ?? null,
      total: s.total_questions,
      score: s.score,
      createdAt: s.created_at,
      submittedAt: s.submitted_at
    };
  });
}
async function submitReviewSessionForUser(client, admin, userId, sessionId, answers, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const { data: claimed, error: claimError } = await admin.from("review_sessions").update({ submitted_at: now.toISOString() }).eq("id", sessionId).eq("user_id", userId).is("submitted_at", null).select("id, scope, created_at");
  if (claimError) return { error: "채점 저장에 실패했어요.", status: 500 };
  const session = (claimed ?? [])[0];
  if (!session) {
    const { data: existing } = await admin.from("review_sessions").select("id, user_id").eq("id", sessionId).maybeSingle();
    if (!existing || existing.user_id !== userId) {
      return { error: "세션을 찾을 수 없어요.", status: 404 };
    }
    return { error: "이미 채점된 세션이에요.", status: 400 };
  }
  const releaseClaim = async () => {
    try {
      await admin.from("review_sessions").update({ submitted_at: null }).eq("id", sessionId);
    } catch {
    }
  };
  const source = session.scope === "mix" ? "mix" : "review";
  const { data: itemRows } = await admin.from("review_session_items").select("id, session_id, paper_id, question_number, position, selected_choice, is_correct").eq("session_id", sessionId).order("position", { ascending: true });
  const items = itemRows ?? [];
  if (items.length === 0) {
    await releaseClaim();
    return { error: "세션에 문항이 없어요.", status: 400 };
  }
  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const answersByPaper = /* @__PURE__ */ new Map();
  const voidedByPaper = /* @__PURE__ */ new Map();
  const { data: ans } = await admin.from("paper_answers").select("paper_id, answers, voided_questions").in("paper_id", paperIds);
  for (const row of ans ?? []) {
    answersByPaper.set(row.paper_id, row.answers ?? []);
    voidedByPaper.set(row.paper_id, new Set(row.voided_questions ?? []));
  }
  let score = 0;
  const gradedRows = items.map((it) => {
    const selected = sanitizeSelectedChoice(answers[it.position]);
    const correct = answersByPaper.get(it.paper_id)?.[it.question_number - 1];
    const isCorrect = voidedByPaper.get(it.paper_id)?.has(it.question_number) === true || selected !== null && selected === correct;
    if (isCorrect) score++;
    return {
      id: it.id,
      session_id: it.session_id,
      paper_id: it.paper_id,
      question_number: it.question_number,
      position: it.position,
      selected_choice: selected,
      is_correct: isCorrect
    };
  });
  const { error: upsertError } = await admin.from("review_session_items").upsert(gradedRows, { onConflict: "id" });
  if (upsertError) {
    await releaseClaim();
    return { error: "채점 저장에 실패했어요.", status: 500 };
  }
  await admin.from("review_sessions").update({ score }).eq("id", sessionId);
  let targets = /* @__PURE__ */ new Map();
  try {
    targets = await resolveStatusTargets(
      client,
      userId,
      gradedRows.map((r) => ({
        paperId: r.paper_id,
        questionNumber: r.question_number
      })),
      { answersClient: admin }
    );
  } catch {
  }
  const byPaper = /* @__PURE__ */ new Map();
  for (const r of gradedRows) {
    const paperIds2 = targets.get(statusTargetKey(r.paper_id, r.question_number)) ?? [r.paper_id];
    for (const paperId of paperIds2) {
      const list2 = byPaper.get(paperId) ?? [];
      list2.push({ question_number: r.question_number, is_correct: r.is_correct });
      byPaper.set(paperId, list2);
    }
  }
  try {
    for (const [paperId, results] of byPaper) {
      await recordQuestionResults(admin, userId, paperId, results, source, {
        now,
        ...opts.questionStatus
      });
    }
  } catch {
  }
  try {
    const elapsedSeconds = (now.getTime() - new Date(session.created_at).getTime()) / 1e3;
    await recordAttendance(
      admin,
      userId,
      attendanceQuestionCount({
        answeredCount: gradedRows.filter((r) => r.selected_choice !== null).length,
        elapsedSeconds
      }),
      { now }
    );
  } catch {
  }
  const view = await getReviewSessionView(client, admin, userId, sessionId);
  return { view: view ?? void 0 };
}
var LAST_CHOICE_BATCH = 1e3;
async function fetchLastWrongChoices(admin, userId, subjectId) {
  const out = /* @__PURE__ */ new Map();
  const latest = /* @__PURE__ */ new Map();
  let from = 0;
  for (; ; ) {
    const { data, error } = await admin.from("review_session_items").select(
      "paper_id, question_number, selected_choice, review_sessions!inner(user_id, submitted_at), exam_papers!inner(subject_id)"
    ).eq("review_sessions.user_id", userId).eq("exam_papers.subject_id", subjectId).eq("is_correct", false).order("paper_id", { ascending: true }).order("question_number", { ascending: true }).range(from, from + LAST_CHOICE_BATCH - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) {
      const key = `${r.paper_id}#${r.question_number}`;
      const at = r.review_sessions?.submitted_at ?? "";
      const prev = latest.get(key);
      if (prev === void 0 || at > prev) {
        latest.set(key, at);
        out.set(key, r.selected_choice);
      }
    }
    if (rows.length < LAST_CHOICE_BATCH) break;
    from += LAST_CHOICE_BATCH;
  }
  return out;
}

// src/exam-level-tier.ts
var TIER_BY_EXAM_TYPE = {
  경찰: "9급",
  해경: "9급",
  소방: "9급",
  계리직: "9급"
};
var CADET_TRACK = "간부후보";
var PROMOTION_TRACK = "승진";
function examLevelTier(paper) {
  const level = paper.level?.trim();
  if (level) return level;
  const type = paper.examTypeName?.trim();
  if (!type) return null;
  const track = paper.track ?? "";
  if (track.includes(PROMOTION_TRACK)) return null;
  if (track.includes(CADET_TRACK)) {
    return TIER_BY_EXAM_TYPE[type] ? "7급" : null;
  }
  return TIER_BY_EXAM_TYPE[type] ?? null;
}
function isApproxLevelTier(paper) {
  return !paper.level?.trim() && examLevelTier(paper) !== null;
}

// src/mix-practice.ts
var MIX_DEFAULT_LIMIT = 20;
var MIX_MIN_LIMIT = 5;
var MIX_MAX_LIMIT = 100;
function clampMixLimit(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MIX_DEFAULT_LIMIT;
  return Math.min(MIX_MAX_LIMIT, Math.max(MIX_MIN_LIMIT, Math.round(n)));
}
var MIX_NO_LEVEL = "__none__";
function filterMixCandidatesByLevel(candidates, levels) {
  if (levels.length === 0) return candidates;
  const set = new Set(levels);
  return candidates.filter((c) => set.has(c.level ?? MIX_NO_LEVEL));
}
var MIX_ALL_YEARS = { from: null, to: null };
function normalizeYearRange(range, bounds) {
  const min = bounds.min;
  const max = bounds.max;
  if (min == null || max == null) return MIX_ALL_YEARS;
  const toInt = (v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  let from = toInt(range?.from);
  let to = toInt(range?.to);
  if (from != null && to != null && from > to) [from, to] = [to, from];
  from = from == null ? null : Math.min(Math.max(from, min), max);
  to = to == null ? null : Math.min(Math.max(to, min), max);
  if ((from == null || from <= min) && (to == null || to >= max)) return MIX_ALL_YEARS;
  return { from, to };
}
function filterMixCandidatesByYear(candidates, range) {
  if (range.from == null && range.to == null) return candidates;
  return candidates.filter((c) => {
    if (c.year == null) return false;
    if (range.from != null && c.year < range.from) return false;
    if (range.to != null && c.year > range.to) return false;
    return true;
  });
}
function mixCandidateKey(c) {
  return `${c.paperId}#${c.questionNumber}`;
}
function shuffleWith(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function roundRobinByPaper(items, limit, rand) {
  const byPaper = /* @__PURE__ */ new Map();
  for (const it of shuffleWith(items, rand)) {
    const list2 = byPaper.get(it.paperId) ?? [];
    list2.push(it);
    byPaper.set(it.paperId, list2);
  }
  const queues = shuffleWith([...byPaper.values()], rand);
  const out = [];
  let idx = 0;
  while (out.length < limit && queues.length > 0) {
    const q = queues[idx % queues.length];
    const next = q.shift();
    if (next) out.push(next);
    if (q.length === 0) {
      queues.splice(idx % queues.length, 1);
      if (queues.length === 0) break;
      idx = idx % queues.length;
    } else {
      idx = (idx + 1) % queues.length;
    }
  }
  return out;
}
function takeSpreadByConcept(ordered, need, counts) {
  const out = [];
  if (need <= 0 || ordered.length === 0) return out;
  const taken = /* @__PURE__ */ new Set();
  let cap = 1;
  while (out.length < need && taken.size < ordered.length) {
    let progressed = false;
    for (const c of ordered) {
      if (out.length >= need) break;
      const key = mixCandidateKey(c);
      if (taken.has(key)) continue;
      const concept = c.conceptId ?? null;
      if (concept && (counts.get(concept) ?? 0) >= cap) continue;
      taken.add(key);
      out.push(c);
      progressed = true;
      if (concept) counts.set(concept, (counts.get(concept) ?? 0) + 1);
    }
    if (!progressed) cap++;
  }
  return out;
}
function pickMixQuestions(candidates, limit, seenKeys = /* @__PURE__ */ new Set(), rand = Math.random) {
  const cap = Math.max(0, Math.floor(limit));
  const unseen = [];
  const seen = [];
  for (const c of candidates) {
    (seenKeys.has(mixCandidateKey(c)) ? seen : unseen).push(c);
  }
  const conceptCounts = /* @__PURE__ */ new Map();
  const fresh = takeSpreadByConcept(
    roundRobinByPaper(unseen, unseen.length, rand),
    cap,
    conceptCounts
  );
  const filler = fresh.length < cap ? takeSpreadByConcept(
    roundRobinByPaper(seen, seen.length, rand),
    cap - fresh.length,
    conceptCounts
  ) : [];
  return {
    picked: shuffleWith([...fresh, ...filler], rand),
    unseenCount: fresh.length,
    // 새 문항만으로 정원을 못 채웠다 = 이 과목의 (풀 수 있는) 기출을 전부 만났다.
    coveredAll: unseen.length < cap
  };
}
function mixSessionTitle(createdAt, ordinal = 1) {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return "섞어풀기";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    month: "numeric",
    day: "numeric"
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const base = `${month}월 ${day}일 섞어풀기`;
  return ordinal > 1 ? `${base} (${ordinal})` : base;
}
function labelMixSessions(sessions, dayKey) {
  const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const countByDay = /* @__PURE__ */ new Map();
  const titles = /* @__PURE__ */ new Map();
  for (const s of sorted) {
    const key = dayKey(s.createdAt);
    const n = (countByDay.get(key) ?? 0) + 1;
    countByDay.set(key, n);
    titles.set(s.id, mixSessionTitle(s.createdAt, n));
  }
  return titles;
}

// src/data/subjects.ts
async function getSubjectBySlug(client, slug) {
  const { data } = await client.from("subjects").select("*").eq("slug", slug).maybeSingle();
  return data ?? null;
}

// src/rules/mix-practice.ts
var MIX_SCOPE = "mix";
function embedOne(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
var EMPTY_MIX_POOL = {
  candidates: [],
  paperCount: 0,
  examTypeNames: [],
  levelGroups: [],
  cells: [],
  minYear: null,
  maxYear: null,
  repByPaperId: {}
};
async function fetchCanonicalConcepts(admin, questionIds) {
  const raw = /* @__PURE__ */ new Map();
  await inParallel(chunk(questionIds, 200), async (ids) => {
    const { data } = await admin.from("question_explanations").select("question_id, concept_id").in("question_id", ids).not("concept_id", "is", null);
    for (const r of data ?? []) {
      if (r.concept_id) raw.set(r.question_id, r.concept_id);
    }
  });
  if (raw.size === 0) return raw;
  const mergedInto = /* @__PURE__ */ new Map();
  await inParallel(chunk([...new Set(raw.values())], 200), async (ids) => {
    const { data } = await admin.from("concepts").select("id, merged_into").in("id", ids);
    for (const r of data ?? []) {
      mergedInto.set(r.id, r.merged_into);
    }
  });
  const canonical = (id) => {
    let cur = id;
    for (let i = 0; i < 5; i++) {
      const next = mergedInto.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };
  const out = /* @__PURE__ */ new Map();
  for (const [qid, cid] of raw) out.set(qid, canonical(cid));
  return out;
}
async function buildMixPool(client, admin, subjectId, opts = {}) {
  const papers = await fetchAllPages(
    (from, to) => client.from("exam_papers").select(
      "id, subject_id, exam_type_id, year, round, level, track, title, created_at, exam_types(name)"
    ).eq("subject_id", subjectId).order("id", { ascending: true }).range(from, to),
    "섞어풀기 문제지"
  );
  if (papers.length === 0) return EMPTY_MIX_POOL;
  const signals = await fetchPaperIdentitySignals(client, collidingPaperIds(papers), admin);
  const { repByPaperId } = representativePaperIds(papers, signals);
  const repIds = [...new Set(papers.map((p) => repByPaperId.get(p.id) ?? p.id))];
  const voidedByPaper = /* @__PURE__ */ new Map();
  await inParallel(chunk(repIds, 200), async (ids) => {
    const { data } = await admin.from("paper_answers").select("paper_id, voided_questions").in("paper_id", ids);
    for (const row of data ?? []) {
      voidedByPaper.set(row.paper_id, new Set(row.voided_questions ?? []));
    }
  });
  const answeredRepIds = repIds.filter((id) => voidedByPaper.has(id));
  if (answeredRepIds.length === 0) return { ...EMPTY_MIX_POOL, paperCount: repIds.length };
  const tierByPaper = new Map(
    papers.map((p) => {
      const input = {
        level: p.level,
        examTypeName: embedOne(p.exam_types)?.name ?? null,
        track: p.track
      };
      return [p.id, { tier: examLevelTier(input), approx: isApproxLevelTier(input) }];
    })
  );
  const rowsById = /* @__PURE__ */ new Map();
  await inParallel(chunk(answeredRepIds, 25), async (ids) => {
    const rows = await fetchAllPages(
      (from, to) => client.from("questions").select("id, paper_id, question_number, question_images!inner(order_index)").in("paper_id", ids).order("paper_id", { ascending: true }).order("question_number", { ascending: true }).range(from, to),
      "섞어풀기 문항"
    );
    for (const r of rows) {
      if (voidedByPaper.get(r.paper_id)?.has(r.question_number)) continue;
      rowsById.set(r.id, r);
    }
  });
  const conceptByQuestionId = opts.includeConcepts === false ? /* @__PURE__ */ new Map() : await fetchCanonicalConcepts(admin, [...rowsById.keys()]);
  const yearByPaper = new Map(papers.map((p) => [p.id, p.year ?? null]));
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Map();
  const cellCounts = /* @__PURE__ */ new Map();
  for (const r of rowsById.values()) {
    const meta = tierByPaper.get(r.paper_id);
    const c = {
      paperId: r.paper_id,
      questionNumber: r.question_number,
      level: meta?.tier ?? null,
      year: yearByPaper.get(r.paper_id) ?? null,
      conceptId: conceptByQuestionId.get(r.id) ?? null
    };
    const key = mixCandidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
    const gk = c.level ?? MIX_NO_LEVEL;
    const g = groups.get(gk) ?? { count: 0, approx: false };
    g.count++;
    if (meta?.approx) g.approx = true;
    groups.set(gk, g);
    const ck = `${gk}|${c.year ?? ""}`;
    cellCounts.set(ck, (cellCounts.get(ck) ?? 0) + 1);
  }
  const levelGroups = [...groups.entries()].map(([key, g]) => ({
    key,
    count: g.count,
    approx: g.approx
  }));
  const cells = [...cellCounts.entries()].map(([k, count]) => {
    const idx = k.lastIndexOf("|");
    const year = k.slice(idx + 1);
    return { level: k.slice(0, idx), year: year ? Number(year) : null, count };
  });
  const examTypeNames = [
    ...new Set(
      papers.map((p) => embedOne(p.exam_types)?.name).filter((n) => !!n)
    )
  ];
  const years = papers.map((p) => p.year);
  return {
    candidates,
    paperCount: repIds.length,
    examTypeNames,
    levelGroups,
    cells,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    repByPaperId: Object.fromEntries(repByPaperId)
  };
}
async function fetchPlayableQuestionCounts(client) {
  const out = {};
  const SIZE = 1e3;
  let from = 0;
  while (true) {
    const { data, error } = await client.rpc("mix_playable_question_counts").range(from, from + SIZE - 1);
    if (error) {
      console.error("mix_playable_question_counts 실패", error.message);
      return null;
    }
    const rows = data ?? [];
    for (const r of rows) out[r.paper_id] = r.question_count;
    if (rows.length < SIZE) break;
    from += SIZE;
  }
  return out;
}
function buildMixHubIndex(input) {
  const { papers, examTypes, playable } = input;
  const unit = playable ? "question" : "paper";
  const countOf = (paperId) => playable ? playable[paperId] ?? 0 : 1;
  const examTypeName = new Map(examTypes.map((t) => [t.id, t.name]));
  const subjects = new Map(input.subjects.map((r) => [r.id, r]));
  const tierStats = /* @__PURE__ */ new Map();
  const bySubject = /* @__PURE__ */ new Map();
  for (const p of papers) {
    const subject = subjects.get(p.subject_id);
    if (!subject) continue;
    const count = countOf(p.id);
    if (count === 0) continue;
    const tierInput = {
      level: p.level,
      examTypeName: examTypeName.get(p.exam_type_id) ?? null,
      track: p.track
    };
    const key = examLevelTier(tierInput) ?? MIX_NO_LEVEL;
    const t = tierStats.get(key) ?? { approx: false, count: 0 };
    t.count += count;
    if (isApproxLevelTier(tierInput)) t.approx = true;
    tierStats.set(key, t);
    const entry = bySubject.get(subject.id) ?? { slug: subject.slug, name: subject.name, count: 0, byTier: {} };
    entry.count += count;
    entry.byTier[key] = (entry.byTier[key] ?? 0) + count;
    bySubject.set(subject.id, entry);
  }
  return {
    tiers: [...tierStats.entries()].map(([key, t]) => ({
      key,
      approx: t.approx,
      count: t.count
    })),
    subjects: [...bySubject.values()],
    unit
  };
}
function toMixOverview(subject, pool) {
  return {
    subject,
    questionCount: pool.candidates.length,
    paperCount: pool.paperCount,
    examTypeNames: pool.examTypeNames,
    levelGroups: pool.levelGroups,
    cells: pool.cells,
    minYear: pool.minYear,
    maxYear: pool.maxYear
  };
}
async function fetchSeenKeys(client, userId, repByPaperId) {
  const out = /* @__PURE__ */ new Set();
  const SIZE = 1e3;
  let from = 0;
  while (true) {
    const { data } = await client.from("user_question_status").select("paper_id, question_number").eq("user_id", userId).range(from, from + SIZE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const rep = repByPaperId[r.paper_id] ?? r.paper_id;
      out.add(`${rep}#${r.question_number}`);
    }
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return out;
}
async function createMixSessionForUser(client, admin, userId, input, deps) {
  const subject = await getSubjectBySlug(client, input.subjectSlug);
  if (!subject) return { error: "과목을 찾을 수 없어요." };
  const pool = await deps.getMixPool(subject.id);
  if (pool.candidates.length === 0) {
    return {
      error: "이 과목은 아직 섞어풀기를 준비 중이에요. 문항 이미지와 정답이 등록된 문제지가 생기면 열려요."
    };
  }
  const known = new Set(pool.levelGroups.map((g) => g.key));
  const levels = (input.levels ?? []).filter((l) => known.has(l));
  const year = normalizeYearRange(input.year, { min: pool.minYear, max: pool.maxYear });
  const candidates = filterMixCandidatesByYear(
    filterMixCandidatesByLevel(pool.candidates, levels),
    year
  );
  if (candidates.length === 0) {
    const narrowed = [levels.length > 0 ? "급수" : null, year.from != null || year.to != null ? "연도" : null].filter(Boolean).join("·");
    return {
      error: narrowed ? `고른 ${narrowed} 범위에는 아직 풀 수 있는 문항이 없어요. 범위를 넓혀보세요.` : "출제할 문항이 없어요."
    };
  }
  const limit = clampMixLimit(input.limit);
  const seen = await fetchSeenKeys(client, userId, pool.repByPaperId);
  const { picked, unseenCount, coveredAll } = pickMixQuestions(candidates, limit, seen);
  if (picked.length === 0) return { error: "출제할 문항이 없어요." };
  const res = await createReviewSessionFromItems(admin, userId, picked, picked.length, {
    keepOrder: true,
    scope: MIX_SCOPE,
    subjectId: subject.id,
    maxLimit: MIX_MAX_LIMIT,
    requestId: input.requestId ?? null
  });
  if (res.error || !res.sessionId) return { error: res.error ?? "세션 생성에 실패했어요." };
  return { sessionId: res.sessionId, unseenCount, coveredAll };
}
async function fetchSubmittedMixSessions(admin, userId, subjectId) {
  const { data } = await admin.from("review_sessions").select("id, created_at, score, total_questions").eq("user_id", userId).eq("subject_id", subjectId).eq("scope", MIX_SCOPE).not("submitted_at", "is", null).order("created_at", { ascending: false }).limit(200);
  return data ?? [];
}
async function fetchResolvedKeys(client, userId, items, repByPaperId) {
  const resolved = /* @__PURE__ */ new Set();
  const wrongCount = /* @__PURE__ */ new Map();
  if (items.length === 0) return { resolved, wrongCount };
  const wantedReps = new Set(items.map((it) => it.paperId));
  const realIds = new Set(wantedReps);
  for (const [real, rep] of Object.entries(repByPaperId)) {
    if (wantedReps.has(rep)) realIds.add(real);
  }
  const latest = /* @__PURE__ */ new Map();
  await inParallel(chunk([...realIds], 200), async (ids) => {
    const { data } = await client.from("user_question_status").select("paper_id, question_number, last_is_correct, last_answered_at, wrong_count").eq("user_id", userId).in("paper_id", ids);
    for (const r of data ?? []) {
      const key = `${repByPaperId[r.paper_id] ?? r.paper_id}#${r.question_number}`;
      wrongCount.set(key, Math.max(wrongCount.get(key) ?? 0, r.wrong_count ?? 0));
      const ex = latest.get(key);
      if (!ex || r.last_answered_at > ex.at) {
        latest.set(key, { correct: r.last_is_correct, at: r.last_answered_at });
      }
    }
  });
  for (const [key, v] of latest) if (v.correct) resolved.add(key);
  return { resolved, wrongCount };
}
async function listMixSessions(client, admin, userId, subjectId, deps) {
  const sessions = await fetchSubmittedMixSessions(admin, userId, subjectId);
  if (sessions.length === 0) return [];
  const wrongBySession = /* @__PURE__ */ new Map();
  await inParallel(chunk(sessions.map((s) => s.id), 50), async (ids) => {
    const { data } = await admin.from("review_session_items").select("session_id, paper_id, question_number").in("session_id", ids).eq("is_correct", false);
    for (const r of data ?? []) {
      const list2 = wrongBySession.get(r.session_id) ?? [];
      list2.push(r);
      wrongBySession.set(r.session_id, list2);
    }
  });
  const pool = await deps.getMixPool(subjectId);
  const allWrong = [...wrongBySession.values()].flat();
  const { resolved } = await fetchResolvedKeys(
    client,
    userId,
    allWrong.map((r) => ({ paperId: r.paper_id, questionNumber: r.question_number })),
    pool.repByPaperId
  );
  const titles = labelMixSessions(
    sessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey
  );
  return sessions.map((s) => {
    const wrong = wrongBySession.get(s.id) ?? [];
    const resolvedCount = wrong.filter(
      (r) => resolved.has(`${r.paper_id}#${r.question_number}`)
    ).length;
    return {
      id: s.id,
      title: titles.get(s.id) ?? "섞어풀기",
      createdAt: s.created_at,
      score: s.score ?? 0,
      total: s.total_questions,
      wrongCount: wrong.length,
      resolvedCount
    };
  });
}
function toMixSessionBriefs(rows, limit) {
  const usable = rows.flatMap((row) => {
    const subject = embedOne(row.subjects);
    return subject?.slug ? [{ row, subject }] : [];
  });
  const titles = labelMixSessions(
    usable.map(({ row }) => ({ id: row.id, createdAt: row.created_at })),
    kstDayKey
  );
  return usable.slice(0, limit).map(({ row, subject }) => ({
    id: row.id,
    title: titles.get(row.id) ?? "섞어풀기",
    createdAt: row.created_at,
    score: row.score ?? 0,
    total: row.total_questions,
    subjectSlug: subject.slug,
    subjectName: subject.name
  }));
}
async function listRecentMixSessions(admin, userId, limit = 5) {
  const { data } = await admin.from("review_sessions").select("id, created_at, score, total_questions, subjects(slug, name)").eq("user_id", userId).eq("scope", MIX_SCOPE).not("submitted_at", "is", null).order("created_at", { ascending: false }).limit(100);
  return toMixSessionBriefs(data ?? [], limit);
}
async function getMixSessionWrongNote(client, admin, userId, sessionId, includeExplanations, deps) {
  const { data: session } = await admin.from("review_sessions").select("id, user_id, subject_id, scope, score, total_questions, created_at, submitted_at").eq("id", sessionId).maybeSingle();
  if (!session || session.user_id !== userId || session.scope !== MIX_SCOPE || session.submitted_at == null || !session.subject_id) {
    return null;
  }
  const { data: subjectRow } = await client.from("subjects").select("*").eq("id", session.subject_id).maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow;
  const { data: itemRows } = await admin.from("review_session_items").select("paper_id, question_number, position, selected_choice, is_correct").eq("session_id", sessionId).order("position", { ascending: true });
  const items = itemRows ?? [];
  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const wanted = /* @__PURE__ */ new Map();
  for (const it of items) {
    const set = wanted.get(it.paper_id) ?? /* @__PURE__ */ new Set();
    set.add(it.question_number);
    wanted.set(it.paper_id, set);
  }
  const [
    { data: paperRows },
    mediaByPaper,
    answersByPaper,
    explanationsByPaper,
    explainedByPaper,
    memoByKey,
    marks,
    pool,
    allSessions
  ] = await Promise.all([
    paperIds.length > 0 ? client.from("exam_papers").select("id, title, level, track, choice_count, exam_types(name)").in("id", paperIds) : Promise.resolve({ data: [] }),
    fetchQuestionMedia(client, paperIds, wanted),
    fetchCorrectAnswers(admin, paperIds),
    includeExplanations ? fetchExplanations(admin, paperIds, wanted) : Promise.resolve(/* @__PURE__ */ new Map()),
    includeExplanations ? Promise.resolve(/* @__PURE__ */ new Map()) : fetchExplainedNumbers(admin, paperIds, wanted),
    fetchMemos(client, userId, paperIds),
    fetchWrongNoteMarks(client, userId, paperIds),
    deps.getMixPool(session.subject_id),
    fetchSubmittedMixSessions(admin, userId, session.subject_id)
  ]);
  const paperById = new Map(
    (paperRows ?? []).map((p) => [p.id, p])
  );
  const { resolved, wrongCount } = await fetchResolvedKeys(
    client,
    userId,
    items.map((it) => ({ paperId: it.paper_id, questionNumber: it.question_number })),
    pool.repByPaperId
  );
  const questions = items.map((it) => {
    const key = `${it.paper_id}#${it.question_number}`;
    const paper = paperById.get(it.paper_id);
    const media = mediaByPaper.get(it.paper_id)?.get(it.question_number);
    return {
      position: it.position,
      paperId: it.paper_id,
      paperTitle: paper ? applyExamTypeSubjectName(getPaperDisplayTitle(paper.title, paper.track)) : "삭제된 문제지",
      paperLevel: paper?.level ?? null,
      examTypeName: embedOne(paper?.exam_types)?.name ?? null,
      questionNumber: it.question_number,
      selectedChoice: it.selected_choice,
      correctChoice: answersByPaper.get(it.paper_id)?.[it.question_number - 1] ?? null,
      isCorrect: it.is_correct === true,
      choiceCount: media?.choiceCount ?? paper?.choice_count ?? 4,
      images: media?.images ?? [],
      explanation: explanationsByPaper.get(it.paper_id)?.get(it.question_number) ?? null,
      explanationLocked: explainedByPaper.get(it.paper_id)?.has(it.question_number) ?? false,
      memo: memoByKey.get(key) ?? null,
      pinned: marks.pinned.has(key),
      wrongCount: wrongCount.get(key) ?? (it.is_correct === false ? 1 : 0),
      resolved: resolved.has(key)
    };
  });
  const titles = labelMixSessions(
    allSessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey
  );
  const wrong = questions.filter((q) => !q.isCorrect);
  return {
    session: {
      id: session.id,
      title: titles.get(session.id) ?? "섞어풀기",
      createdAt: session.created_at,
      score: session.score ?? 0,
      total: session.total_questions
    },
    subject,
    questions,
    wrongCount: wrong.length,
    resolvedCount: wrong.filter((q) => q.resolved).length
  };
}
async function createRetryFromMixSession(admin, userId, sessionId, opts = {}) {
  const { data: session } = await admin.from("review_sessions").select("id, user_id, subject_id, submitted_at").eq("id", sessionId).maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  if (session.submitted_at == null) return { error: "채점 후에 다시 풀 수 있어요." };
  const { data: rows } = await admin.from("review_session_items").select("paper_id, question_number, position").eq("session_id", sessionId).eq("is_correct", false).order("position", { ascending: true });
  const items = (rows ?? []).map((r) => ({
    paperId: r.paper_id,
    questionNumber: r.question_number
  }));
  if (items.length === 0) return { error: "다시 풀 틀린 문항이 없어요." };
  return createReviewSessionFromItems(admin, userId, items, items.length, {
    subjectId: session.subject_id ?? null,
    maxLimit: MIX_MAX_LIMIT,
    requestId: opts.requestId ?? null,
    random: opts.random
  });
}

// src/diagnosis-progress.ts
var DIAGNOSIS_MIN_WRONG = 15;
var DIAGNOSIS_MIN_ATTEMPTS = 3;
function computeDiagnosisProgress({
  attemptCount,
  wrongCount
}) {
  const byAttempts = Math.min(1, attemptCount / DIAGNOSIS_MIN_ATTEMPTS);
  const byWrongs = Math.min(1, wrongCount / DIAGNOSIS_MIN_WRONG);
  const eligible = byAttempts >= 1 || byWrongs >= 1;
  if (byAttempts >= byWrongs) {
    const left2 = Math.max(0, DIAGNOSIS_MIN_ATTEMPTS - attemptCount);
    return {
      eligible,
      ratio: byAttempts,
      label: `응시 ${Math.min(attemptCount, DIAGNOSIS_MIN_ATTEMPTS)}/${DIAGNOSIS_MIN_ATTEMPTS}`,
      remainingHint: eligible ? null : left2 === 1 ? "한 회차만 더 풀면 진단이 열려요" : `${left2}회차만 더 풀면 진단이 열려요`
    };
  }
  const left = Math.max(0, DIAGNOSIS_MIN_WRONG - wrongCount);
  return {
    eligible,
    ratio: byWrongs,
    label: `오답 ${Math.min(wrongCount, DIAGNOSIS_MIN_WRONG)}/${DIAGNOSIS_MIN_WRONG}`,
    remainingHint: eligible ? null : `오답 ${left}개가 더 모이면 진단이 열려요`
  };
}

// src/data/home.ts
var SAMPLE_TODAY_STUDY = {
  todayAttempts: 2,
  accuracyPct: 84,
  streakDays: 7,
  week: [38, 55, 46, 72, 61, 88, 24],
  todayIndex: 5,
  attemptCount: DIAGNOSIS_MIN_ATTEMPTS - 1,
  wrongCount: 5
};
var DIAGNOSIS_CYCLE_DAYS = 7;
var DIAGNOSIS_WINDOW_DAYS = 7;
var COACH_MAX_TOTAL = 10;
function kstToday2(now = /* @__PURE__ */ new Date()) {
  return kstDateKey(now);
}
function kstDaysAgo(days, now = /* @__PURE__ */ new Date()) {
  const d = /* @__PURE__ */ new Date(`${kstToday2(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function currentCycleStartDate(now = /* @__PURE__ */ new Date()) {
  return kstDaysAgo(DIAGNOSIS_CYCLE_DAYS - 1, now);
}
function nextDiagnosisDate(lastDate) {
  const d = /* @__PURE__ */ new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAGNOSIS_CYCLE_DAYS);
  return d.toISOString().slice(0, 10);
}
function isDiagnosisEligible(counts) {
  return computeDiagnosisProgress(counts).eligible;
}
var DIAGNOSIS_LOCKED_HINT = `문제를 조금 더 풀면 진단을 받을 수 있어요 (오답 ${DIAGNOSIS_MIN_WRONG}개 또는 ${DIAGNOSIS_MIN_ATTEMPTS}회 응시).`;

// src/data/mypage.ts
async function fetchDiagnosisEligibility(client, userId) {
  const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
    client.from("cbt_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    client.from("user_question_status").select("paper_id", { count: "exact", head: true }).eq("user_id", userId).gt("wrong_count", 0)
  ]);
  const counts = { attemptCount: attemptCount ?? 0, wrongCount: wrongCount ?? 0 };
  return { eligible: isDiagnosisEligible(counts), ...counts };
}

// src/diagnosis-report.ts
function conceptSelectionKey(c) {
  return c.conceptId ?? `kw:${c.concept.trim()}`;
}
function normalizeConceptSelection(input) {
  if (!Array.isArray(input)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of input) {
    const concept = typeof raw?.concept === "string" ? raw.concept.trim() : "";
    if (!concept) continue;
    const conceptId = typeof raw?.conceptId === "string" && raw.conceptId ? raw.conceptId : null;
    const key = conceptId ?? `kw:${concept}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ conceptId, concept });
    if (out.length >= COACH_MAX_TOTAL) break;
  }
  return out;
}

// src/rules/diagnosis-request.ts
async function getWeeklyDiagnosis(client, userId, now = /* @__PURE__ */ new Date()) {
  const { data } = await client.from("ai_diagnoses").select("id, report, diagnosis_date, selected_concepts").eq("user_id", userId).gte("diagnosis_date", currentCycleStartDate(now)).order("diagnosis_date", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data;
  const report = row.report ?? null;
  return {
    status: report ? "ready" : "pending",
    report,
    date: row.diagnosis_date,
    id: row.id,
    selectedConcepts: row.selected_concepts ?? null
  };
}
async function getLatestReadyDiagnosis(client, userId) {
  const { data } = await client.from("ai_diagnoses").select("report, diagnosis_date").eq("user_id", userId).not("report", "is", null).order("diagnosis_date", { ascending: false }).limit(1).maybeSingle();
  const row = data;
  if (!row || !row.report) return null;
  return { report: row.report, date: row.diagnosis_date };
}
var DIAGNOSIS_LOCKED = "AI 약점 진단은 멤버십 기능이에요.";
var REQUEST_FAILED = "진단 요청에 실패했어요. 잠시 후 다시 시도해주세요.";
async function requestDiagnosisForUser(client, input, deps) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const { userId } = input;
  if (!input.premium) return { ok: false, reason: "premium", error: DIAGNOSIS_LOCKED };
  const selected = normalizeConceptSelection(input.selectedConcepts ?? []);
  const existing = await getWeeklyDiagnosis(client, userId, now);
  if (existing) {
    if (existing.status === "pending" && selected.length > 0) {
      await deps.getAdmin().from("ai_diagnoses").update({ selected_concepts: selected }).eq("user_id", userId).eq("diagnosis_date", existing.date).is("report", null);
    }
    return {
      ok: true,
      status: existing.status,
      diagnosisId: existing.id,
      date: existing.date,
      nextDate: nextDiagnosisDate(existing.date),
      // 이번에 고른 것이 있으면 그것(위에서 행에 갈아 넣었다), 없으면 행에 남아 있던 선택.
      // 호출부(웹 즉시 생성 경로)가 "요청 행에 실제로 박힌 목록"으로 생성기를 부른다.
      selectedConcepts: selected.length > 0 ? selected : existing.selectedConcepts ?? []
    };
  }
  const eligibility = await fetchDiagnosisEligibility(client, userId);
  if (!eligibility.eligible) {
    return { ok: false, reason: "not-eligible", error: DIAGNOSIS_LOCKED_HINT };
  }
  const date = kstToday2(now);
  const { data, error } = await deps.getAdmin().from("ai_diagnoses").insert({
    user_id: userId,
    diagnosis_date: date,
    report: null,
    selected_concepts: selected.length > 0 ? selected : null
  }).select("id").maybeSingle();
  if (error) {
    if (error.code !== "23505") {
      return { ok: false, reason: "insert-failed", error: REQUEST_FAILED };
    }
    const raced = await getWeeklyDiagnosis(client, userId, now);
    return {
      ok: true,
      status: raced?.status ?? "pending",
      diagnosisId: raced?.id ?? null,
      date: raced?.date ?? date,
      nextDate: nextDiagnosisDate(raced?.date ?? date),
      selectedConcepts: selected
    };
  }
  return {
    ok: true,
    status: "pending",
    diagnosisId: data?.id ?? null,
    date,
    nextDate: nextDiagnosisDate(date),
    selectedConcepts: selected
  };
}

// src/rules/diagnosis-aggregate.ts
var PAGE_SIZE = 1e3;
async function fetchAll(admin, table, columns, apply) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await apply(
      admin.from(table).select(columns).range(from, from + PAGE_SIZE - 1)
    );
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}
var questionKey = (pid, n) => `${pid}#${n}`;
function sinceIso(days, now) {
  if (days == null) return null;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
async function collectAnswerEvents(admin, userId, days, now) {
  const since = sinceIso(days, now);
  const out = /* @__PURE__ */ new Map();
  const bump = (paperId, questionNumber, isCorrect) => {
    const k = questionKey(paperId, questionNumber);
    const e = out.get(k) ?? { paperId, questionNumber, wrong: 0, total: 0 };
    e.total++;
    if (isCorrect === false) e.wrong++;
    out.set(k, e);
  };
  const attemptRows = await fetchAll(
    admin,
    "cbt_attempts",
    "id, paper_id",
    (q) => since ? q.eq("user_id", userId).gte("created_at", since) : q.eq("user_id", userId)
  );
  const attemptPaperId = new Map(attemptRows.map((a) => [a.id, a.paper_id]));
  for (const ids of chunk([...attemptPaperId.keys()], 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll(
      admin,
      "cbt_attempt_answers",
      "attempt_id, question_number, selected_choice, is_correct",
      (q) => q.in("attempt_id", ids)
    );
    for (const r of rows) {
      if (r.selected_choice == null) continue;
      const paperId = attemptPaperId.get(r.attempt_id);
      if (paperId) bump(paperId, r.question_number, r.is_correct);
    }
  }
  const sessionRows = await fetchAll(admin, "review_sessions", "id", (q) => {
    const base = q.eq("user_id", userId).not("submitted_at", "is", null);
    return since ? base.gte("created_at", since) : base;
  });
  for (const ids of chunk(sessionRows.map((s) => s.id), 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll(
      admin,
      "review_session_items",
      "paper_id, question_number, selected_choice, is_correct",
      (q) => q.in("session_id", ids)
    );
    for (const r of rows) {
      if (r.selected_choice == null) continue;
      bump(r.paper_id, r.question_number, r.is_correct);
    }
  }
  return out;
}
var WIDEN_LADDER = [7, 30, 90, null];
async function getDiagnosisAggregate(admin, userId, opts = {}, deps = {}) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const requested = opts.days === void 0 ? 7 : opts.days;
  const widenAllowed = opts.widen !== false;
  const subjectFilter = opts.subjectSlug ?? null;
  const attempts = await fetchAll(
    admin,
    "cbt_attempts",
    "id, paper_id, score, total_questions, exam_papers!inner(subject_id, subjects(name, slug))",
    (q) => q.eq("user_id", userId).order("created_at", { ascending: true })
  );
  const bySubjectMap = /* @__PURE__ */ new Map();
  for (const a of attempts) {
    const subj = a.exam_papers?.subjects;
    if (!subj) continue;
    const entry = bySubjectMap.get(subj.slug) ?? {
      id: a.exam_papers?.subject_id ?? "",
      name: subj.name,
      slug: subj.slug,
      attempts: 0,
      scoreSum: 0,
      totalSum: 0,
      recentPct: []
    };
    entry.attempts++;
    entry.scoreSum += a.score ?? 0;
    entry.totalSum += a.total_questions ?? 0;
    if ((a.total_questions ?? 0) > 0) {
      entry.recentPct.push(Math.round((a.score ?? 0) / a.total_questions * 100));
    }
    bySubjectMap.set(subj.slug, entry);
  }
  const subjects = [...bySubjectMap.values()].map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    attempts: e.attempts,
    avgScorePct: e.totalSum > 0 ? Math.round(e.scoreSum / e.totalSum * 100) : null,
    recentScores: e.recentPct.slice(-5)
  }));
  const ladder = !widenAllowed || requested === null ? [requested] : [requested, ...WIDEN_LADDER.filter((d) => d === null || d > requested)];
  let statsByQuestion = /* @__PURE__ */ new Map();
  let usedDays = requested;
  let widened = false;
  for (const days of ladder) {
    statsByQuestion = await collectAnswerEvents(admin, userId, days, now);
    const anyWrong = [...statsByQuestion.values()].some((s) => s.wrong > 0);
    if (anyWrong) {
      usedDays = days;
      widened = days !== requested;
      break;
    }
    usedDays = days;
    widened = days !== requested;
  }
  const statusRows = [...statsByQuestion.values()].filter((s) => s.wrong > 0).map((s) => ({ paper_id: s.paperId, question_number: s.questionNumber }));
  const answeredRows = [...statsByQuestion.values()];
  const answerStats = statsByQuestion;
  const paperIds = [...new Set(answeredRows.map((r) => r.paperId))];
  const questionIdByKey = /* @__PURE__ */ new Map();
  const paperSubject = /* @__PURE__ */ new Map();
  for (const ids of chunk(paperIds, 100)) {
    if (ids.length === 0) continue;
    const qrows = await fetchAll(
      admin,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids)
    );
    for (const r of qrows) questionIdByKey.set(questionKey(r.paper_id, r.question_number), r.id);
    const prows = await fetchAll(admin, "exam_papers", "id, subject_id, subjects(name, slug)", (q) => q.in("id", ids));
    for (const p of prows) {
      paperSubject.set(p.id, p.subjects ? { name: p.subjects.name, slug: p.subjects.slug } : null);
    }
  }
  const questionIds = [...questionIdByKey.values()];
  const conceptRefByQuestionId = /* @__PURE__ */ new Map();
  const conceptIdsSeen = /* @__PURE__ */ new Set();
  for (const ids of chunk(questionIds, 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll(
      admin,
      "question_explanations",
      "question_id, keyword_title, concept_id",
      (q) => q.in("question_id", ids)
    );
    for (const r of rows) {
      const title = (r.keyword_title ?? "").trim();
      if (!r.concept_id && !title) continue;
      if (r.concept_id) conceptIdsSeen.add(r.concept_id);
      conceptRefByQuestionId.set(r.question_id, { conceptId: r.concept_id, title });
    }
  }
  const conceptMeta = /* @__PURE__ */ new Map();
  for (const ids of chunk([...conceptIdsSeen], 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll(
      admin,
      "concepts",
      "id, name, kind",
      (q) => q.in("id", ids)
    );
    for (const r of rows) conceptMeta.set(r.id, { name: r.name, kind: r.kind });
  }
  const conceptMap = /* @__PURE__ */ new Map();
  const answeredBySubject = /* @__PURE__ */ new Map();
  for (const r of answeredRows) {
    const slug = paperSubject.get(r.paperId)?.slug;
    if (slug) answeredBySubject.set(slug, (answeredBySubject.get(slug) ?? 0) + 1);
  }
  for (const r of answeredRows) {
    const qid = questionIdByKey.get(questionKey(r.paperId, r.questionNumber));
    if (!qid) continue;
    const ref = conceptRefByQuestionId.get(qid);
    if (!ref) continue;
    const meta = ref.conceptId ? conceptMeta.get(ref.conceptId) : void 0;
    const concept = meta?.name ?? ref.title;
    if (!concept) continue;
    const subj = paperSubject.get(r.paperId);
    if (subjectFilter && subj?.slug !== subjectFilter) continue;
    const key = `${ref.conceptId ?? `kw:${ref.title}`}###${subj?.slug ?? ""}`;
    const entry = conceptMap.get(key) ?? {
      concept,
      conceptId: ref.conceptId,
      conceptKind: meta?.kind ?? null,
      subject: subj?.name ?? null,
      subjectSlug: subj?.slug ?? null,
      wrongCount: 0,
      correctSum: 0,
      answerSum: 0
    };
    if (r.wrong > 0) entry.wrongCount++;
    const st = answerStats.get(questionKey(r.paperId, r.questionNumber));
    if (st) {
      entry.correctSum += st.total - st.wrong;
      entry.answerSum += st.total;
    }
    conceptMap.set(key, entry);
  }
  const conceptsRaw = [...conceptMap.values()].filter((e) => e.wrongCount > 0).map((e) => ({
    concept: e.concept,
    conceptId: e.conceptId,
    conceptKind: e.conceptKind,
    subject: e.subject,
    subjectSlug: e.subjectSlug,
    wrongCount: e.wrongCount,
    answeredCount: e.answerSum,
    accuracyPct: e.answerSum > 0 ? Math.round(e.correctSum / e.answerSum * 100) : null,
    scoreGainPct: (() => {
      const denom = e.subjectSlug ? answeredBySubject.get(e.subjectSlug) ?? 0 : 0;
      if (denom <= 0) return null;
      return Math.round(e.wrongCount / denom * 1e3) / 10;
    })()
  })).sort((a, b) => b.wrongCount - a.wrongCount || a.concept.localeCompare(b.concept)).slice(0, 60);
  const corpusCount = /* @__PURE__ */ new Map();
  const countKeyOf = (c) => c.conceptId ?? `kw:${c.concept}`;
  const uniqueTargets = /* @__PURE__ */ new Map();
  for (const c of conceptsRaw) uniqueTargets.set(countKeyOf(c), c);
  await Promise.all(
    [...uniqueTargets.entries()].map(async ([k, c]) => {
      const q = admin.from("question_explanations").select("question_id", { count: "exact", head: true });
      const { count } = await (c.conceptId ? q.eq("concept_id", c.conceptId) : q.eq("keyword_title", c.concept));
      corpusCount.set(k, count ?? 0);
    })
  );
  const concepts = conceptsRaw.map((c) => ({
    ...c,
    corpusCount: corpusCount.get(countKeyOf(c)) ?? 0
  }));
  const groupMap = /* @__PURE__ */ new Map();
  for (const c of concepts) {
    const key = c.subjectSlug ?? "__none__";
    const g = groupMap.get(key) ?? { subject: c.subject ?? "기타", subjectSlug: c.subjectSlug, totalWrong: 0, concepts: [] };
    g.totalWrong += c.wrongCount;
    g.concepts.push(c);
    groupMap.set(key, g);
  }
  const bySubject = [...groupMap.values()].map((g) => ({ ...g, concepts: g.concepts.sort((a, b) => b.wrongCount - a.wrongCount) })).sort((a, b) => b.totalWrong - a.totalWrong);
  return {
    window: { days: usedDays, widened },
    totals: {
      attempts: attempts.length,
      wrongQuestions: subjectFilter ? statusRows.filter((r) => paperSubject.get(r.paper_id)?.slug === subjectFilter).length : statusRows.length,
      conceptsWithKeyword: [...conceptMap.values()].filter((e) => e.wrongCount > 0).length
    },
    subjects,
    concepts,
    bySubject
  };
}
function toBoardConcept(c) {
  return {
    concept: c.concept,
    conceptId: c.conceptId,
    subject: c.subject,
    subjectSlug: c.subjectSlug,
    wrongCount: c.wrongCount,
    accuracyPct: c.accuracyPct,
    scoreGainPct: c.scoreGainPct,
    corpusCount: c.corpusCount
  };
}
function toDiagnosisBoard(agg) {
  return {
    window: agg.window,
    subjects: agg.subjects.map((s) => ({ name: s.name, slug: s.slug })),
    concepts: agg.concepts.map(toBoardConcept),
    bySubject: agg.bySubject.map((g) => ({
      subject: g.subject,
      subjectSlug: g.subjectSlug,
      totalWrong: g.totalWrong,
      concepts: g.concepts.map(toBoardConcept)
    }))
  };
}
async function getPendingDiagnosisBatch(admin, userId) {
  const { data } = await admin.from("ai_diagnosis_batches").select("requested_at, context").eq("user_id", userId).eq("status", "pending").order("requested_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const context = data.context;
  return {
    requestedAt: data.requested_at,
    conceptCount: Array.isArray(context?.targets) ? context.targets.length : 0
  };
}

// src/diagnosis-targets.ts
var COACH_PER_SUBJECT = 7;
function pickCoachTargets(agg, excludedSubjectSlugs, selected = null) {
  if (selected && selected.length > 0) return pickSelectedConcepts(agg, selected);
  const bySubject = /* @__PURE__ */ new Map();
  for (const c of agg.concepts) {
    const slug = c.subjectSlug ?? "";
    if (slug && excludedSubjectSlugs.has(slug)) continue;
    const list2 = bySubject.get(slug) ?? [];
    if (list2.length >= COACH_PER_SUBJECT) continue;
    list2.push(c);
    bySubject.set(slug, list2);
  }
  const groups = [...bySubject.values()].sort(
    (a, b) => b.reduce((n, c) => n + c.wrongCount, 0) - a.reduce((n, c) => n + c.wrongCount, 0)
  );
  for (const g of groups) {
    g.sort((a, b) => b.wrongCount - a.wrongCount || (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101));
  }
  const picked = [];
  for (let rank = 0; rank < COACH_PER_SUBJECT && picked.length < COACH_MAX_TOTAL; rank++) {
    for (const g of groups) {
      if (picked.length >= COACH_MAX_TOTAL) break;
      if (g[rank]) picked.push(g[rank]);
    }
  }
  return picked;
}
function pickSelectedConcepts(agg, selected) {
  const wanted = new Set(selected.map(conceptSelectionKey));
  const picked = [];
  for (const c of agg.concepts) {
    if (!wanted.has(conceptSelectionKey(c))) continue;
    picked.push(c);
    if (picked.length >= COACH_MAX_TOTAL) break;
  }
  return picked;
}

// src/diagnosis-coach.ts
var DIAGNOSIS_MODEL_DEFAULT = "claude-opus-5";
function resolveDiagnosisModel(envValue) {
  return (envValue ?? "").trim() || DIAGNOSIS_MODEL_DEFAULT;
}
var MAX_EVIDENCE = 6;
var MAX_STEPS = 5;
var MAX_CHECKPOINTS = 5;
function buildCoachingParams(targets, samples, model = DIAGNOSIS_MODEL_DEFAULT) {
  const system = `당신은 한국 공무원·자격 시험 학습 코치입니다. 한 수험생이 개념별로 실제 틀린 문항들을 받습니다 — 발문 요약, 정답과 그 근거, 그 사람이 고른 오답 선지와 그 선지가 틀린 이유, 같은 문항을 몇 번 틀렸는지까지.

당신이 쓸 것은 개념 설명이 아니라 **이 사람 한 명에 대한 진단서**입니다. 판단 기준은 하나입니다: 여기서 이 사람의 오답 기록을 빼면 남는 말이 없어야 합니다. 개념만 보고 누구에게나 쓸 수 있는 학습법(예: '기출을 반복하세요', '개념을 정리하세요')은 쓰지 마세요 — 그런 내용이라면 개념마다 미리 써 두면 되는 것이라 이 진단은 실패입니다.

개념마다 아래를 씁니다.
1) weakPattern — 이 개념에서 무너지는 지점(2~4문장). 고른 오답들에 공통으로 흐르는 판단 방식을 짚습니다.
2) rootCause — 왜 그렇게 골랐는지(3~5문장). 무엇을 무엇으로 착각했는지, 어떤 판단 단계를 건너뛰었는지, 어떤 지식이 반쯤만 잡혀 있는지. 증상이 아니라 원인을 씁니다.
3) evidence — 입력에 있는 문항에 한해, 문항마다 한 덩이씩. question 은 그 문항이 무엇을 물었는지 한 줄, myChoice 는 '내가고른선지'가 무엇이었고 그게 어떤 판단이었는지(기록이 없으면 null), insight 는 그 선택이 드러내는 착각. 최대 ${MAX_EVIDENCE}개.
4) steps — 오늘부터의 극복 계획 3~${MAX_STEPS}단계. title 은 할 일 이름, detail 은 무엇을 어떻게 하는지(예: '정답 선지 5개를 옮겨 적고 각 문장에서 조건절에 밑줄'), minutes 는 예상 소요 시간(분). 순서대로 실행할 수 있어야 합니다.
5) checkpoints — 시험장에서 같은 유형을 만났을 때 순서대로 확인할 것 3~${MAX_CHECKPOINTS}개. 각 한 줄, 생각이 아니라 동작으로.
6) trap — 이 개념 문항에서 반복되는 함정 한 줄.
7) howToOvercome — 처방 한 줄 요약(steps 를 한 문장으로).

규칙:
- 반드시 주어진 문항들에서 드러난 근거로만 말할 것. 입력에 없는 수치·과목·개념·판례·조문·교재명·강의명을 지어내지 말 것. 문항 수나 정답률을 다시 계산해 쓰지 말 것.
- 표본이 적어 공통점이 안 보이면 억지로 패턴을 만들지 말고, 놓친 정답 진술이 무엇을 요구했는지와 그 개념의 핵심 함정을 근거로 쓸 것.
- 분량은 충분히 써도 됩니다. 다만 같은 말을 표현만 바꿔 반복하지 말 것 — 길이는 근거의 개수에서 나와야 합니다.
- 과장·위로·응원 문구 없이 담백하게. 수험생 본인에게 '~해요/~하세요' 체로 직접 말할 것.
- 발문이 '옳지 않은 것 / 적절하지 않은 것 / 아닌 것'을 묻는 문항에서는 '고른 선지가 사실은 맞는 설명이었다', '발문의 부정 방향을 놓쳤다'를 진단으로 쓰지 말 것 — 그런 문항은 정답 하나만 틀린 진술이라 오답이면 반드시 맞는 선지를 고르게 된다. 아무나 해당하는 동어반복이라 이 수험생에 대해 아무것도 말해 주지 않는다. 이 유형에서는 '내가고른선지'가 아니라 **놓친 정답 진술(정답근거)**이 무엇을 요구했는지를 근거로 삼을 것.
- 같은 문항을 여러 번 틀렸다면(틀린횟수 2 이상) 그 사실을 원인 분석에 반영할 것 — 한 번 보고 넘긴 것과 다시 걸린 것은 처방이 다릅니다.`;
  const conceptKeyOf2 = (c) => c.conceptId ?? `kw:${c.concept.trim()}`;
  const samplesByConcept = /* @__PURE__ */ new Map();
  for (const s of samples) {
    const list2 = samplesByConcept.get(s.conceptKey) ?? [];
    list2.push(s);
    samplesByConcept.set(s.conceptKey, list2);
  }
  const userPayload = {
    concepts: targets.map((t) => ({
      concept: t.concept,
      subject: t.subject,
      // 지식형이면 "개념을 모른다", 기능형이면 "이 유형 풀이에 약하다" 쪽으로 조언한다.
      유형: t.conceptKind === "skill" ? "문제풀이 기능" : "지식 개념",
      wrongCount: t.wrongCount,
      answeredCount: t.answeredCount,
      accuracyPct: t.accuracyPct,
      // 이 개념에서 실제로 틀린 문항들. pickedChoice가 없으면 CBT 응시 기록이 없는
      // 문항(섞어풀기 등)이라 "무엇을 골랐는지"는 알 수 없다.
      wrongQuestions: (samplesByConcept.get(conceptKeyOf2(t)) ?? []).map((s) => ({
        발문: s.questionText,
        정답: s.correctChoice,
        정답근거: s.correctSummary,
        내가고른선지: s.pickedChoice,
        그선지가틀린이유: s.pickedReason,
        틀린횟수: s.wrongTimes,
        // 마지막에 맞혔는지. "다시 걸렸다"와 "이미 잡았다"를 구분해 준다.
        지금은맞히는지: s.resolved
      }))
    }))
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            concept: { type: "string", description: "입력에 있던 개념 이름 그대로" },
            weakPattern: { type: "string", description: "무너지는 지점 2~4문장" },
            rootCause: { type: "string", description: "왜 그렇게 골랐는지 3~5문장" },
            evidence: {
              type: "array",
              description: `입력에 있는 오답 문항별 근거(최대 ${MAX_EVIDENCE}개)`,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  question: { type: "string" },
                  // 응시 기록이 없어 무엇을 골랐는지 모르는 문항이 있다. 그때 지어내지
                  // 않도록 null 을 허용한다(스키마가 문자열만 받으면 모델이 채운다).
                  myChoice: { anyOf: [{ type: "string" }, { type: "null" }] },
                  insight: { type: "string" }
                },
                required: ["question", "myChoice", "insight"]
              }
            },
            steps: {
              type: "array",
              description: `오늘부터의 극복 계획(3~${MAX_STEPS}단계)`,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                  minutes: { type: "integer", description: "예상 소요 시간(분)" }
                },
                required: ["title", "detail", "minutes"]
              }
            },
            checkpoints: {
              type: "array",
              description: `시험장 체크리스트(3~${MAX_CHECKPOINTS}개)`,
              items: { type: "string" }
            },
            trap: { type: "string", description: "반복되는 함정 한 줄" },
            howToOvercome: { type: "string", description: "처방 한 줄 요약" }
          },
          required: [
            "concept",
            "weakPattern",
            "rootCause",
            "evidence",
            "steps",
            "checkpoints",
            "trap",
            "howToOvercome"
          ]
        }
      }
    },
    required: ["items"]
  };
  return {
    model,
    // 응답 상한은 실은 개념 수에 따라 잡는다(아래 maxTokensFor). 잘린 JSON 은 파싱에서
    // 조용히 실패해 그 요청의 극복법이 0개가 되고, 생성은 주기당 1회라 그 개념은 그 주가
    // 통째로 빈다(요금은 이미 나갔다). 상한은 지출 목표가 아니라 안전망이다.
    //
    // ⚠️ 이 값이 21,333(=128K/6)을 넘으면 SDK 가 **비스트리밍 요청을 아예 거부한다**
    // (client.calculateNonstreamingTimeout: 10분 넘을 요청은 스트리밍 필수). 개념 1개짜리
    // 요청(기본 경로)은 그 아래지만, 즉시 경로(diagnosis-generate.ts)는 여전히
    // messages.stream 을 쓴다 — 여러 개념을 한 요청에 싣는 경우까지 같은 코드가 감당한다.
    max_tokens: maxTokensFor(targets.length),
    // effort 는 그대로 비용이다(thinking 토큰이 출력 요금으로 붙는다). 여러 문항의 오답
    // 선지에서 공통 원인을 찾는 일이라 high 가 이상적이지만, 요금 대비 체감을 보고
    // medium 으로 운영한다 — 프롬프트와 스키마(원인·근거·계획·체크리스트)는 그대로라
    // 결과의 "모양"은 같고, 근거를 얼마나 파고드느냐가 달라진다.
    // 결과가 다시 일반론으로 흐르면 개념 수를 줄이기 전에 여기를 high 로 되돌릴 것.
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content: "다음은 한 수험생이 개념별로 실제 틀린 문항들입니다. 개념마다 이 사람이 무너지는 지점과 그 원인, 문항별 근거, 극복 계획을 만들어 주세요. 입력 JSON:\n" + JSON.stringify(userPayload)
      }
    ]
  };
}
var MAX_TOKENS_BASE = 12e3;
var MAX_TOKENS_PER_CONCEPT = 4e3;
var MAX_TOKENS_CAP = 48e3;
function maxTokensFor(conceptCount) {
  return Math.min(MAX_TOKENS_CAP, MAX_TOKENS_BASE + MAX_TOKENS_PER_CONCEPT * Math.max(1, conceptCount));
}
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function list(v, max, map) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const item of v) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : null;
}
function toEvidence(item) {
  const o = item ?? {};
  const question = str(o.question);
  const insight = str(o.insight);
  if (!question || !insight) return null;
  return { question, myChoice: str(o.myChoice), insight };
}
function toStep(item) {
  const o = item ?? {};
  const title = str(o.title);
  const detail = str(o.detail);
  if (!title || !detail) return null;
  const minutes = typeof o.minutes === "number" && Number.isFinite(o.minutes) && o.minutes > 0 ? Math.round(o.minutes) : null;
  return { title, detail, minutes };
}
function parseCoachingItems(responseText, targets) {
  if (!responseText.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const targetByConcept = new Map(targets.map((t) => [t.concept, t]));
  const out = [];
  for (const raw of items) {
    const it = raw ?? {};
    const t = targetByConcept.get(typeof it.concept === "string" ? it.concept : "");
    if (!t) continue;
    const weakPattern = str(it.weakPattern);
    const howToOvercome = str(it.howToOvercome);
    if (!weakPattern || !howToOvercome) continue;
    out.push({
      concept: t.concept,
      conceptId: t.conceptId ?? null,
      subject: t.subject,
      subjectSlug: t.subjectSlug,
      weakPattern,
      howToOvercome,
      rootCause: str(it.rootCause),
      evidence: list(it.evidence, MAX_EVIDENCE, toEvidence),
      steps: list(it.steps, MAX_STEPS, toStep),
      checkpoints: list(it.checkpoints, MAX_CHECKPOINTS, (v) => str(v)),
      trap: str(it.trap)
    });
  }
  return out;
}

// src/rules/diagnosis-samples.ts
async function fetchAll2(admin, table, columns, apply) {
  const rows = [];
  let from = 0;
  const SIZE = 1e3;
  while (true) {
    const base = admin.from(table).select(columns).range(from, from + SIZE - 1);
    const q = apply(base);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return rows;
}
var questionKey2 = (pid, n) => `${pid}#${n}`;
var SAMPLE_TEXT_MAX = 240;
function truncate(s, max = SAMPLE_TEXT_MAX) {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
async function getWrongQuestionSamples(admin, userId, targets, perConcept = 6) {
  const wantedIds = new Set(targets.map((t) => t.conceptId).filter((v) => !!v));
  const wantedTitles = new Set(
    targets.filter((t) => !t.conceptId).map((t) => t.concept.trim()).filter(Boolean)
  );
  const displayByKey = new Map(
    targets.map((t) => [t.conceptId ?? `kw:${t.concept.trim()}`, t.concept])
  );
  if (wantedIds.size === 0 && wantedTitles.size === 0) return [];
  const statusRows = await fetchAll2(
    admin,
    "user_question_status",
    "paper_id, question_number, wrong_count, last_is_correct",
    (q) => q.eq("user_id", userId).gt("wrong_count", 0)
  );
  if (statusRows.length === 0) return [];
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];
  const questionIdByKey = /* @__PURE__ */ new Map();
  const paperSubject = /* @__PURE__ */ new Map();
  for (const ids of chunk(paperIds, 100)) {
    const qrows = await fetchAll2(
      admin,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids)
    );
    for (const r of qrows) questionIdByKey.set(questionKey2(r.paper_id, r.question_number), r.id);
    const prows = await fetchAll2(
      admin,
      "exam_papers",
      "id, subjects(name)",
      (q) => q.in("id", ids)
    );
    for (const p of prows) paperSubject.set(p.id, p.subjects?.name ?? null);
  }
  const questionIds = [...questionIdByKey.values()];
  const expByQuestionId = /* @__PURE__ */ new Map();
  for (const ids of chunk(questionIds, 100)) {
    const rows = await fetchAll2(
      admin,
      "question_explanations",
      "question_id, concept_id, keyword_title, question_text, correct_choice_number, correct_choice_summary, choice_explanations",
      (q) => q.in("question_id", ids)
    );
    for (const r of rows) {
      const hit = r.concept_id ? wantedIds.has(r.concept_id) : wantedTitles.has((r.keyword_title ?? "").trim());
      if (hit) expByQuestionId.set(r.question_id, r);
    }
  }
  if (expByQuestionId.size === 0) return [];
  const byConcept = /* @__PURE__ */ new Map();
  for (const st of statusRows) {
    const qid = questionIdByKey.get(questionKey2(st.paper_id, st.question_number));
    if (!qid) continue;
    const exp = expByQuestionId.get(qid);
    if (!exp) continue;
    const ckey = exp.concept_id ?? `kw:${(exp.keyword_title ?? "").trim()}`;
    if (!displayByKey.has(ckey)) continue;
    const list2 = byConcept.get(ckey) ?? [];
    list2.push({ row: exp, status: st, subject: paperSubject.get(st.paper_id) ?? null });
    byConcept.set(ckey, list2);
  }
  const picked = [];
  for (const list2 of byConcept.values()) {
    list2.sort(
      (a, b) => Number(a.status.last_is_correct) - Number(b.status.last_is_correct) || b.status.wrong_count - a.status.wrong_count
    );
    picked.push(...list2.slice(0, perConcept));
  }
  if (picked.length === 0) return [];
  const pickedPaperIds = [...new Set(picked.map((c) => c.status.paper_id))];
  const attempts = await fetchAll2(
    admin,
    "cbt_attempts",
    "id, paper_id",
    (q) => q.eq("user_id", userId).in("paper_id", pickedPaperIds)
  );
  const attemptPaper = new Map(attempts.map((a) => [a.id, a.paper_id]));
  const chosenByKey = /* @__PURE__ */ new Map();
  for (const ids of chunk([...attemptPaper.keys()], 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll2(
      admin,
      "cbt_attempt_answers",
      "attempt_id, question_number, selected_choice, is_correct",
      (q) => q.in("attempt_id", ids)
    );
    for (const r of rows) {
      if (r.is_correct || r.selected_choice == null) continue;
      const paperId = attemptPaper.get(r.attempt_id);
      if (!paperId) continue;
      chosenByKey.set(questionKey2(paperId, r.question_number), r.selected_choice);
    }
  }
  return picked.map(({ row, status, subject }) => {
    const pickedChoice = chosenByKey.get(questionKey2(status.paper_id, status.question_number)) ?? null;
    const choiceRow = pickedChoice != null ? (row.choice_explanations ?? []).find((c) => c?.number === pickedChoice) : void 0;
    const reason = choiceRow ? [choiceRow.verdict_label, choiceRow.explanation].filter(Boolean).join(" — ") : null;
    const conceptKey = row.concept_id ?? `kw:${(row.keyword_title ?? "").trim()}`;
    return {
      conceptKey,
      concept: displayByKey.get(conceptKey) ?? (row.keyword_title ?? "").trim(),
      subject,
      questionText: truncate(row.question_text, 200),
      correctChoice: row.correct_choice_number,
      correctSummary: truncate(row.correct_choice_summary),
      pickedChoice,
      pickedReason: truncate(reason),
      wrongTimes: status.wrong_count,
      resolved: status.last_is_correct
    };
  });
}

// src/rules/diagnosis-generate.ts
var SAMPLES_PER_CONCEPT = 8;
function frequencyTerciles(corpusCounts) {
  const counts = corpusCounts.filter((n) => n > 0).sort((a, b) => a - b);
  const q1 = counts.length ? counts[Math.floor(counts.length / 3)] : 0;
  const q2 = counts.length ? counts[Math.floor(counts.length * 2 / 3)] : 0;
  return (n) => n <= 0 ? null : n > q2 ? 3 : n > q1 ? 2 : 1;
}
function toWeakConcepts(agg) {
  const freq = frequencyTerciles(agg.concepts.map((c) => c.corpusCount));
  return agg.concepts.map((c) => ({
    concept: c.concept,
    subject: c.subject,
    subjectSlug: c.subjectSlug,
    wrongCount: c.wrongCount,
    // 리포트 스키마의 필드지만 진단은 더 이상 극복 여부를 세지 않는다(기간 안에
    // 무엇을 틀렸는지만 본다). 앱이 값이 있을 때만 그리므로 null 로 둔다.
    resolvedCount: null,
    frequency: freq(c.corpusCount),
    accuracyPct: c.accuracyPct
  }));
}
function toSubjectTrends(agg) {
  return agg.subjects.filter((s) => s.recentScores.length > 0).map((s) => {
    const scores = s.recentScores;
    let trend = "flat";
    if (scores.length >= 2) {
      const first = scores[0];
      const last2 = scores[scores.length - 1];
      if (last2 - first >= 5) trend = "up";
      else if (first - last2 >= 5) trend = "down";
    }
    const last = scores[scores.length - 1];
    const note = scores.length >= 2 ? `최근 ${scores.length}회 ${scores.join(" → ")}점.` : `최근 ${last}점.`;
    return { subject: s.name, trend, note, scores };
  });
}
function buildSummary(agg) {
  const top = agg.concepts[0];
  const parts = [];
  if (top) {
    const where = top.subject ? `${top.subject} ` : "";
    parts.push(`가장 시급한 약점은 ${where}'${top.concept}'예요(${top.wrongCount}회 틀림).`);
  }
  const up = agg.subjects.find((s) => {
    const sc = s.recentScores;
    return sc.length >= 2 && sc[sc.length - 1] - sc[0] >= 5;
  });
  if (up) parts.push(`${up.name}은(는) 점수가 오르는 중이에요.`);
  return parts.join(" ") || "오답을 개념별로 정리했어요. 하나씩 잡아봐요.";
}
async function planCoaching(admin, userId, excludedSubjectSlugs = /* @__PURE__ */ new Set(), selectedConcepts = null, deps = {}) {
  const agg = await getDiagnosisAggregate(admin, userId, {
    days: DIAGNOSIS_WINDOW_DAYS,
    widen: false
  });
  if (agg.concepts.length === 0) {
    return {
      error: `최근 ${DIAGNOSIS_WINDOW_DAYS}일 동안 새로 틀린 문제가 없어요. 문제를 좀 더 풀고 다시 받아보세요.`
    };
  }
  const picked = pickCoachTargets(agg, excludedSubjectSlugs, selectedConcepts);
  if (picked.length === 0) {
    return {
      error: selectedConcepts && selectedConcepts.length > 0 ? `고른 개념에 최근 ${DIAGNOSIS_WINDOW_DAYS}일 오답이 없어요. 개념을 다시 골라주세요.` : "진단할 과목을 하나 이상 선택해주세요(고른 과목에 최근 오답이 없어요)."
    };
  }
  const targets = picked.map((t) => ({
    concept: t.concept,
    conceptId: t.conceptId,
    conceptKind: t.conceptKind,
    subject: t.subject,
    subjectSlug: t.subjectSlug,
    wrongCount: t.wrongCount,
    answeredCount: t.answeredCount,
    accuracyPct: t.accuracyPct
  }));
  const samples = await getWrongQuestionSamples(
    admin,
    userId,
    targets.map((t) => ({ conceptId: t.conceptId, concept: t.concept })),
    SAMPLES_PER_CONCEPT
  );
  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;
  const requests = targets.map((target, index) => ({
    index,
    target,
    params: buildCoachingParams(
      [target],
      samples.filter((s) => s.conceptKey === conceptSelectionKey(target)),
      model
    )
  }));
  return {
    plan: {
      report: {
        summary: buildSummary(agg),
        weakConcepts: toWeakConcepts(agg),
        subjectTrends: toSubjectTrends(agg),
        mission: null,
        insights: null
      },
      targets,
      requests
    }
  };
}
async function saveDiagnosisReport(admin, diagnosisId, skeleton, conceptCoaching, model = DIAGNOSIS_MODEL_DEFAULT, now = /* @__PURE__ */ new Date()) {
  const report = { ...skeleton, conceptCoaching };
  const { error } = await admin.from("ai_diagnoses").update({ report, model, generated_at: now.toISOString() }).eq("id", diagnosisId).is("report", null);
  return error ? { error: "진단 저장에 실패했어요." } : {};
}

// src/diagnosis-batch-merge.ts
function batchCustomId(diagnosisId, index) {
  return `${diagnosisId}_${index}`;
}
function parseBatchCustomId(customId) {
  const at = customId.lastIndexOf("_");
  if (at < 0) return { prefix: customId, index: null };
  const suffix = customId.slice(at + 1);
  if (!/^\d+$/.test(suffix)) return { prefix: customId, index: null };
  return { prefix: customId.slice(0, at), index: Number(suffix) };
}
function mergeConceptResults(results, targets) {
  const byIndex = /* @__PURE__ */ new Map();
  const failures = [];
  const answered = /* @__PURE__ */ new Set();
  for (const r of results) {
    const scoped = r.index == null ? targets : targets[r.index] ? [targets[r.index]] : [];
    if (scoped.length === 0) continue;
    const indices = r.index == null ? targets.map((_, i) => i) : [r.index];
    for (const i of indices) answered.add(i);
    if (r.status !== "succeeded") {
      failures.push(`${scoped.map((t) => t.concept).join(", ")}: 배치 결과가 ${r.status} 상태`);
      continue;
    }
    const parsed = parseCoachingItems(r.text, scoped);
    for (const c of parsed) {
      const i = r.index ?? targets.findIndex((t) => t.concept === c.concept);
      if (i >= 0 && !byIndex.has(i)) byIndex.set(i, c);
    }
    for (const i of indices) {
      if (!byIndex.has(i)) failures.push(`${targets[i].concept}: 모델이 극복법을 만들지 못함`);
    }
  }
  for (const [i, t] of targets.entries()) {
    if (!answered.has(i)) failures.push(`${t.concept}: 배치 결과에 없음`);
  }
  const coaching = targets.map((_, i) => byIndex.get(i)).filter((c) => !!c);
  return { coaching, failures };
}

// src/rules/diagnosis-batch.ts
var ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages/batches";
var ANTHROPIC_VERSION = "2023-06-01";
var AnthropicRequestError = class extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AnthropicRequestError";
    this.status = status;
  }
};
function isPermanentBatchError(e) {
  const status = e instanceof AnthropicRequestError ? e.status : null;
  return status === 404 || status === 401 || status === 403;
}
var DEFAULT_TIMEOUT_MS = 2e4;
var DEFAULT_CREATE_TIMEOUT_MS = 9e4;
function createAnthropicBatchTransport(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createTimeoutMs = opts.createTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
  const headers = {
    "x-api-key": opts.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json"
  };
  async function callAbsolute(url, init = {}, limitMs = timeoutMs) {
    const res = await doFetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(limitMs)
    });
    if (!res.ok) {
      throw new AnthropicRequestError(
        `Anthropic ${init.method ?? "GET"} → ${res.status}`,
        res.status
      );
    }
    return res;
  }
  function call(path, init = {}, limitMs) {
    return callAbsolute(`${ANTHROPIC_BASE}${path}`, init, limitMs);
  }
  return {
    async create(requests) {
      const res = await call(
        "",
        { method: "POST", body: JSON.stringify({ requests }) },
        createTimeoutMs
      );
      const body = await res.json();
      if (!body.id) throw new Error("Anthropic 배치 응답에 id 가 없다");
      return { id: body.id };
    },
    async cancel(batchId) {
      await call(`/${batchId}/cancel`, { method: "POST" });
    },
    async retrieve(batchId) {
      const res = await call(`/${batchId}`);
      const body = await res.json();
      return {
        processingStatus: body.processing_status ?? "",
        // 응답이 준 주소만 받아들이고, 그것도 api.anthropic.com 인 것만 쓴다 — 응답 한 필드에
        // 따라 아무 주소나 부르러 가지 않는다(키가 헤더에 실려 나간다).
        resultsUrl: typeof body.results_url === "string" && body.results_url.startsWith("https://api.anthropic.com/") ? body.results_url : null
      };
    },
    results(batchId, resultsUrl) {
      return {
        async *[Symbol.asyncIterator]() {
          const res = resultsUrl ? await callAbsolute(resultsUrl) : await call(`/${batchId}/results`);
          const body = res.body;
          if (!body) return;
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (; ; ) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            for (; ; ) {
              const nl = buffer.indexOf("\n");
              if (nl < 0) break;
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              const parsed = line ? safeParse(line) : null;
              if (parsed) yield parsed;
            }
            if (done) break;
          }
          const tail = buffer.trim() ? safeParse(buffer.trim()) : null;
          if (tail) yield tail;
        }
      };
    }
  };
}
function safeParse(line) {
  try {
    const v = JSON.parse(line);
    return typeof v?.custom_id === "string" && v?.result ? v : null;
  } catch {
    return null;
  }
}
var SUBMIT_BATCH_SIZE = 25;
var MAX_ATTEMPTS_PER_DIAGNOSIS = 5;
var SUBMIT_CLAIM_SECONDS = 120;
var DIAGNOSIS_RECHECK_SECONDS = 20;
var COLLECT_WORK_SECONDS = 90;
var BATCH_SLA_HOURS = 24;
async function submitPendingDiagnoses(admin, opts = {}, deps) {
  const transport = deps.transport;
  if (!transport) {
    return { submitted: 0, skipped: 0, error: "진단 생성이 아직 설정되지 않았어요." };
  }
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;
  const limit = opts.limit ?? SUBMIT_BATCH_SIZE;
  const since = new Date(now);
  since.setDate(since.getDate() - (DIAGNOSIS_CYCLE_DAYS - 1));
  let query = admin.from("ai_diagnoses").select("id, user_id, selected_concepts").is("report", null).gte("diagnosis_date", since.toISOString().slice(0, 10)).order("requested_at", { ascending: true }).limit(limit);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data: pendingRows } = await query;
  const pending = pendingRows ?? [];
  if (pending.length === 0) return { submitted: 0, skipped: 0 };
  const { data: existing } = await admin.from("ai_diagnosis_batches").select("diagnosis_id, status").in("diagnosis_id", pending.map((p) => p.id));
  const attempts = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Set();
  for (const row of existing ?? []) {
    attempts.set(row.diagnosis_id, (attempts.get(row.diagnosis_id) ?? 0) + 1);
    if (row.status === "pending") inFlight.add(row.diagnosis_id);
  }
  let skipped = 0;
  const candidates = [];
  for (const row of pending) {
    if (inFlight.has(row.id)) continue;
    if ((attempts.get(row.id) ?? 0) >= MAX_ATTEMPTS_PER_DIAGNOSIS) {
      skipped++;
      continue;
    }
    candidates.push(row);
  }
  if (candidates.length === 0) return { submitted: 0, skipped };
  const claim = await claimForSubmit(admin, candidates.map((c) => c.id), now);
  if (claim.error) {
    return { submitted: 0, skipped, error: "진단 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
  const rows = candidates.filter((c) => claim.ids.has(c.id));
  if (rows.length === 0) {
    return {
      submitted: 0,
      skipped,
      error: opts.userId ? "조금 전 요청을 처리하는 중이에요. 잠시 후 다시 시도해주세요." : void 0
    };
  }
  const requests = [];
  const items = [];
  let lastError;
  for (const row of rows) {
    const { plan, error } = await planCoaching(
      admin,
      row.user_id,
      // 개념을 직접 고른 요청이면 과목 제외 설정은 볼 필요가 없다(선택이 이미 과목까지
      // 정한다). 고르지 않은 구버전 요청만 예전처럼 과목 제외로 좁힌다.
      row.selected_concepts?.length ? /* @__PURE__ */ new Set() : await getExcludedDiagnosisSubjectSlugs(admin, row.user_id),
      row.selected_concepts ?? null,
      { model }
    );
    if (!plan) {
      skipped++;
      lastError = error;
      continue;
    }
    for (const r of plan.requests) {
      requests.push({ custom_id: batchCustomId(row.id, r.index), params: r.params });
    }
    items.push({
      diagnosis_id: row.id,
      user_id: row.user_id,
      custom_id: row.id,
      context: {
        report: plan.report,
        targets: plan.targets.map((t) => ({
          concept: t.concept,
          conceptId: t.conceptId,
          subject: t.subject,
          subjectSlug: t.subjectSlug
        }))
      }
    });
  }
  if (items.length === 0) return { submitted: 0, skipped, error: lastError };
  let batchId;
  try {
    batchId = (await transport.create(requests)).id;
  } catch {
    return {
      submitted: 0,
      skipped,
      error: "진단 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요."
    };
  }
  const { error: insertError } = await admin.from("ai_diagnosis_batches").insert(
    items.map((it) => ({
      diagnosis_id: it.diagnosis_id,
      user_id: it.user_id,
      batch_id: batchId,
      custom_id: it.custom_id,
      model,
      context: it.context,
      status: "pending"
    }))
  );
  if (insertError) {
    await transport.cancel?.(batchId).catch(() => {
    });
    return { submitted: 0, skipped, batchId, error: "진단 요청 기록에 실패했어요." };
  }
  return { submitted: items.length, skipped, batchId, error: lastError };
}
async function claimForSubmit(admin, ids, now) {
  if (ids.length === 0) return { ids: /* @__PURE__ */ new Set() };
  const cutoff = new Date(now.getTime() - SUBMIT_CLAIM_SECONDS * 1e3).toISOString();
  const { data, error } = await admin.from("ai_diagnoses").update({ batch_claimed_at: now.toISOString() }).in("id", ids).is("report", null).lt("batch_claimed_at", cutoff).select("id");
  if (error) return { ids: /* @__PURE__ */ new Set(), error: error.message };
  return { ids: new Set((data ?? []).map((r) => r.id)) };
}
async function collectDiagnosisBatches(admin, opts = {}, deps) {
  const transport = deps.transport;
  if (!transport) return { ready: 0, failed: 0, pending: 0 };
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;
  let query = admin.from("ai_diagnosis_batches").select("id").eq("status", "pending").order("requested_at", { ascending: true }).limit(opts.limit ?? 200);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data } = await query;
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return { ready: 0, failed: 0, pending: 0 };
  const items = await claimForCollect(admin, ids, now);
  const out = { ready: 0, failed: 0, pending: ids.length - items.length };
  if (items.length === 0) return out;
  const byBatch = /* @__PURE__ */ new Map();
  for (const it of items) {
    const list2 = byBatch.get(it.batch_id) ?? [];
    list2.push(it);
    byBatch.set(it.batch_id, list2);
  }
  for (const [batchId, group] of byBatch) {
    let batch;
    try {
      batch = await transport.retrieve(batchId);
    } catch (e) {
      if (!isPermanentBatchError(e)) {
        out.pending += group.length;
        continue;
      }
      const stale = group.filter(
        (g) => now.getTime() - Date.parse(g.requested_at) >= BATCH_SLA_HOURS * 36e5
      );
      if (stale.length === 0) {
        out.pending += group.length;
        continue;
      }
      await closeItems(admin, stale.map((g) => g.id), "failed", "배치를 찾을 수 없어요.", now);
      out.failed += stale.length;
      out.pending += group.length - stale.length;
      continue;
    }
    if (batch.processingStatus !== "ended") {
      out.pending += group.length;
      continue;
    }
    await extendCollectLease(admin, group.map((g) => g.id), now);
    const byPrefix = new Map(group.map((g) => [g.custom_id, g]));
    const gathered = /* @__PURE__ */ new Map();
    try {
      for await (const line of transport.results(batchId, batch.resultsUrl)) {
        const { prefix, index } = parseBatchCustomId(line.custom_id);
        const item = byPrefix.get(prefix);
        if (!item) continue;
        const list2 = gathered.get(item.id) ?? [];
        gathered.set(item.id, list2);
        if (line.result.type !== "succeeded") {
          list2.push({ index, status: line.result.type, text: "" });
          continue;
        }
        list2.push({
          index,
          status: "succeeded",
          text: (line.result.message?.content ?? []).map((b) => b.type === "text" ? b.text ?? "" : "").join("")
        });
      }
    } catch {
      out.pending += group.length;
      continue;
    }
    for (const item of group) {
      const conceptResults = gathered.get(item.id);
      if (!conceptResults) {
        await closeItems(admin, [item.id], "failed", "배치 결과에 이 요청이 없어요.", now);
        out.failed++;
        continue;
      }
      const { coaching, failures } = mergeConceptResults(conceptResults, item.context.targets);
      if (coaching.length === 0) {
        await closeItems(
          admin,
          [item.id],
          "failed",
          failures.join(" / ") || "모델이 극복법을 만들지 못했어요.",
          now
        );
        out.failed++;
        continue;
      }
      const saved = await saveDiagnosisReport(
        admin,
        item.diagnosis_id,
        item.context.report,
        coaching,
        model,
        now
      );
      if (saved.error) {
        out.pending++;
        continue;
      }
      await closeItems(
        admin,
        [item.id],
        "ready",
        failures.length > 0 ? failures.join(" / ") : null,
        now
      );
      out.ready++;
    }
  }
  return out;
}
async function claimForCollect(admin, ids, now) {
  const cutoff = new Date(now.getTime() - DIAGNOSIS_RECHECK_SECONDS * 1e3).toISOString();
  const { data } = await admin.from("ai_diagnosis_batches").update({ last_checked_at: now.toISOString() }).in("id", ids).eq("status", "pending").lt("last_checked_at", cutoff).select("id, diagnosis_id, user_id, batch_id, custom_id, requested_at, context");
  return data ?? [];
}
async function extendCollectLease(admin, ids, now) {
  if (ids.length === 0) return;
  const until = new Date(now.getTime() + COLLECT_WORK_SECONDS * 1e3).toISOString();
  await admin.from("ai_diagnosis_batches").update({ last_checked_at: until }).in("id", ids);
}
async function closeItems(admin, ids, status, error, now) {
  if (ids.length === 0) return;
  await admin.from("ai_diagnosis_batches").update({ status, error, completed_at: now.toISOString() }).in("id", ids);
}
async function collectDiagnosisForUser(admin, userId, deps) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const empty = { date: null, requestedAt: null, conceptCount: 0, error: null };
  const weekly = await getWeeklyDiagnosis(admin, userId, now);
  if (!weekly) return { status: "none", ...empty };
  if (weekly.status === "ready") {
    return { status: "ready", ...empty, date: weekly.date };
  }
  let batch = await latestBatchFor(admin, weekly.id);
  if (!batch) return { status: "pending", ...empty, date: weekly.date };
  if (batch.status === "pending") {
    await collectDiagnosisBatches(admin, { userId }, deps);
    batch = await latestBatchFor(admin, weekly.id) ?? batch;
  }
  const shared = {
    date: weekly.date,
    requestedAt: batch.requestedAt,
    conceptCount: batch.conceptCount
  };
  if (batch.status === "ready") return { status: "ready", ...shared, error: null };
  if (batch.status === "failed") return { status: "failed", ...shared, error: batch.error };
  return { status: "pending", ...shared, error: null };
}
async function latestBatchFor(admin, diagnosisId) {
  const { data } = await admin.from("ai_diagnosis_batches").select("status, error, requested_at, context").eq("diagnosis_id", diagnosisId).order("requested_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data;
  return {
    status: row.status,
    error: row.error,
    requestedAt: row.requested_at,
    conceptCount: Array.isArray(row.context?.targets) ? row.context.targets.length : 0
  };
}

// src/levels.ts
var LEVEL_ORDER = ["9급", "7급", "5급"];
function compareLevels(a, b) {
  const ai = LEVEL_ORDER.indexOf(a);
  const bi = LEVEL_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

// src/paper-slug.ts
function slugifyText(text) {
  return text.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
function getPaperSlug(title, round, track) {
  const bare = track ? title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim() : title;
  let slug = slugifyText(bare);
  if (track) slug += `-${slugifyText(track)}`;
  if (round > 1 && !bare.includes(`${round}차`) && !bare.includes(`${round}회`))
    slug += `-${round}회`;
  return slug;
}
function normalizePaperSlugParam(param) {
  if (!param.includes("%")) return param;
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isPaperUuid(value) {
  return UUID_RE.test(value);
}

// src/data/papers.ts
function encodePapers(papers, subjects, examTypes) {
  const subjectIdx = new Map(subjects.map((s, i) => [s.id, i]));
  const examTypeIdx = new Map(examTypes.map((t, i) => [t.id, i]));
  return papers.map((p) => [
    p.id,
    p.title,
    p.level,
    p.track,
    p.year,
    p.round,
    subjectIdx.get(p.subject_id) ?? -1,
    examTypeIdx.get(p.exam_type_id) ?? -1
  ]);
}
function decodePapers({ subjects, examTypes, papers }) {
  const subjectRefs = subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
  return papers.map(
    ([id, title, level, track, year, round, sIdx, tIdx]) => ({
      id,
      title,
      level,
      track,
      year,
      round,
      subject_id: subjects[sIdx]?.id ?? "",
      exam_type_id: examTypes[tIdx]?.id ?? "",
      subjects: subjectRefs[sIdx] ?? null,
      exam_types: examTypes[tIdx] ?? null
    })
  );
}
function getExamTypeNames(papers) {
  const set = /* @__PURE__ */ new Set();
  for (const p of papers) {
    if (p.exam_types?.name) set.add(p.exam_types.name);
  }
  return [...set];
}
function filterPapers(papers, {
  level,
  year,
  examType,
  matchedSubjectIds,
  isSearching,
  favOnly,
  bookmarkedSubjectIds
}) {
  return papers.filter((p) => {
    if (level && p.level !== level) return false;
    if (year && p.year !== year) return false;
    if (examType && p.exam_types?.name !== examType) return false;
    if (isSearching && !matchedSubjectIds.includes(p.subject_id)) return false;
    if (favOnly && !bookmarkedSubjectIds?.has(p.subject_id)) return false;
    return true;
  });
}
function groupSubjectName(paper) {
  const name = paper.subjects?.name;
  if (!name) return "기타";
  return getSubjectDisplayName(name, paper.exam_types?.name, paper.level, paper.track);
}
function groupByYearAndSubject(papers) {
  const sorted = [...papers].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return groupSubjectName(a).localeCompare(groupSubjectName(b), "ko");
  });
  const byYear = /* @__PURE__ */ new Map();
  for (const paper of sorted) {
    if (!byYear.has(paper.year)) byYear.set(paper.year, /* @__PURE__ */ new Map());
    const bySubject = byYear.get(paper.year);
    const subjectName = groupSubjectName(paper);
    if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
    bySubject.get(subjectName).push(paper);
  }
  return byYear;
}
var TYPICAL_EXAM_MONTH = {
  소방: 3,
  계리직: 3,
  국가직: 4,
  기상직: 4,
  지방직: 6,
  서울시: 6,
  법원직: 6,
  간호직: 6,
  지역인재: 7,
  경찰: 8,
  해경: 8,
  국회직: 9
};
async function fetchExamPaperRows(client) {
  const { data: examTypeRows } = await client.from("exam_types").select("id, name");
  const examTypes = examTypeRows ?? [];
  const monthByExamTypeId = new Map(
    examTypes.map((t) => [t.id, TYPICAL_EXAM_MONTH[t.name] ?? 0])
  );
  const rows = await fetchAllPages(
    (from, to) => client.from("exam_papers").select("id, title, level, track, year, round, subject_id, exam_type_id").order("year", { ascending: false }).order("round", { ascending: false }).order("id", { ascending: true }).range(from, to),
    "문제지 목록"
  );
  rows.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    const am = monthByExamTypeId.get(a.exam_type_id) ?? 0;
    const bm = monthByExamTypeId.get(b.exam_type_id) ?? 0;
    if (am !== bm) return bm - am;
    if (a.round !== b.round) return b.round - a.round;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { rows, examTypes };
}
var SIGNAL_RPC_LIMIT = 500;
async function fetchPaperIdentitySignalsRpc(client, papers) {
  const signals = /* @__PURE__ */ new Map();
  const collidingIds = new Set(collidingPaperIds(papers));
  if (collidingIds.size === 0) return signals;
  const groups = /* @__PURE__ */ new Map();
  for (const p of papers) {
    if (!collidingIds.has(p.id)) continue;
    const key = paperDedupKey(p);
    const arr = groups.get(key);
    if (arr) arr.push(p.id);
    else groups.set(key, [p.id]);
  }
  const chunks = [];
  let current = [];
  for (const ids of groups.values()) {
    if (current.length + ids.length > SIGNAL_RPC_LIMIT && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(...ids);
  }
  if (current.length > 0) chunks.push(current);
  await inParallel(chunks.map((ids, idx) => ({ ids, idx })), async ({ ids, idx }) => {
    const { data, error } = await client.rpc("paper_identity_signals", { p_paper_ids: ids });
    if (error) throw new Error(`중복 판정 신호 조회 실패: ${error.message}`);
    for (const row of data ?? []) {
      signals.set(row.paper_id, {
        questionCount: row.question_count ?? 0,
        answerSignature: row.answer_cluster == null ? null : `${idx}:${row.answer_cluster}`,
        answerLength: row.answer_length
      });
    }
  });
  return signals;
}
async function fetchQuestionCountSignals(client, papers) {
  const signals = /* @__PURE__ */ new Map();
  const ids = collidingPaperIds(papers);
  if (ids.length === 0) return signals;
  for (const id of ids) signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  await inParallel(chunk(ids, 20), async (batch) => {
    const { data } = await client.from("questions").select("paper_id").in("paper_id", batch).range(0, 999);
    for (const row of data ?? []) {
      const s = signals.get(row.paper_id);
      if (s) s.questionCount += 1;
    }
  });
  return signals;
}
async function fetchCbtAvailability(client, paperIds) {
  if (paperIds.length === 0) return /* @__PURE__ */ new Set();
  const { data } = await client.rpc("has_cbt_answers_bulk", { target_paper_ids: paperIds });
  return new Set((data ?? []).map((row) => row.paper_id));
}
async function fetchAllCbtAvailability(client) {
  const rows = await fetchAllPages(
    (from, to) => client.rpc("has_cbt_answers_all").range(from, to),
    "CBT 가능 목록"
  );
  return new Set(rows.map((row) => row.paper_id));
}
async function fetchCatalog(client, signalsProvider) {
  const [{ data: subjectRows }, { rows, examTypes }, cbtAvailability] = await Promise.all([
    client.from("subjects").select("*").order("name"),
    fetchExamPaperRows(client),
    fetchAllCbtAvailability(client)
  ]);
  const subjects = subjectRows ?? [];
  const slugMap = {};
  for (const row of rows) slugMap[getPaperSlug(row.title, row.round, row.track)] = row.id;
  const signals = await signalsProvider(client, rows);
  const papers = collapseDuplicatePapers(rows, signals);
  return {
    subjects,
    examTypes,
    papers: encodePapers(papers, subjects, examTypes),
    cbtMask: papers.map((p) => cbtAvailability.has(p.id) ? "1" : "0").join(""),
    slugMap
  };
}
function buildSubjectIndex(subjects, papers) {
  const stats = /* @__PURE__ */ new Map();
  for (const p of papers) {
    let s = stats.get(p.subject_id);
    if (!s) {
      s = { count: 0, minYear: p.year, maxYear: p.year };
      stats.set(p.subject_id, s);
    }
    s.count += 1;
    if (p.year < s.minYear) s.minYear = p.year;
    if (p.year > s.maxYear) s.maxYear = p.year;
  }
  const entries = subjects.flatMap((subject) => {
    const s = stats.get(subject.id);
    if (!s || s.count === 0) return [];
    return [{ slug: subject.slug, name: subject.name, count: s.count, minYear: s.minYear, maxYear: s.maxYear }];
  });
  return { entries, totalCount: papers.length };
}
async function fetchSubjectFilters(client, subjectId) {
  const [{ data: levelRows }, { data: examTypeRows }] = await Promise.all([
    client.from("exam_papers").select("level").eq("subject_id", subjectId),
    client.from("exam_papers").select("exam_type_id, exam_types(id, name, display_order)").eq("subject_id", subjectId)
  ]);
  const levels = [
    ...new Set(
      (levelRows ?? []).map((r) => r.level).filter((l) => !!l)
    )
  ].sort(compareLevels);
  const examTypeById = /* @__PURE__ */ new Map();
  for (const row of examTypeRows ?? []) {
    const et = row.exam_types;
    if (et) examTypeById.set(et.id, et);
  }
  const examTypes = [...examTypeById.values()].sort((a, b) => a.display_order - b.display_order);
  return { levels, examTypes, hasAnyPaper: (levelRows ?? []).length > 0 };
}
async function fetchSubjectPapers(client, subjectId, filter, signalsProvider) {
  const rows = await fetchAllPages(
    (from, to) => {
      let q = client.from("exam_papers").select("*, subjects(*), exam_types(*)").eq("subject_id", subjectId);
      if (filter.level) q = q.eq("level", filter.level);
      if (filter.examTypeIds && filter.examTypeIds.length > 0) q = q.in("exam_type_id", filter.examTypeIds);
      return q.order("year", { ascending: false }).order("round", { ascending: false }).order("id", { ascending: true }).range(from, to);
    },
    "과목 문제지 목록"
  );
  const signals = await signalsProvider(client, rows);
  return collapseDuplicatePapers(rows, signals);
}
async function fetchMyRoundCounts(client, userId) {
  const counts = /* @__PURE__ */ new Map();
  const { data } = await client.from("cbt_attempts").select("paper_id").eq("user_id", userId);
  for (const row of data ?? []) {
    counts.set(row.paper_id, (counts.get(row.paper_id) ?? 0) + 1);
  }
  return counts;
}

// src/profanity.ts
var PROFANITY_WORDS = [
  // 한국어
  "씨발",
  "시발",
  "씨빨",
  "시빨",
  "씨팔",
  "시팔",
  "씨바",
  "십새",
  "씹새",
  "씹창",
  "씹할",
  "씨부랄",
  "씨부럴",
  "시부랄",
  "시부럴",
  "병신",
  "븅신",
  "빙신",
  "등신",
  "머저리",
  "지랄",
  "지럴",
  "좆",
  "좃같",
  "좇같",
  "존나",
  "존내",
  "존만",
  "새끼",
  "쌔끼",
  "썅",
  "쌍놈",
  "쌍년",
  "개년",
  "개놈",
  "개소리",
  "개같",
  "개차반",
  "미친놈",
  "미친년",
  "니미",
  "느금마",
  "니애미",
  "애미없",
  "엠창",
  "창녀",
  "화냥년",
  "걸레같",
  "입닥쳐",
  "닥쳐라",
  "뒈져",
  "죽여버",
  // 초성 표기
  "ㅅㅂ",
  "ㅆㅂ",
  "ㅄ",
  "ㅂㅅ",
  "ㅈㄹ",
  "ㅆㅍ",
  // 영어
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "whore",
  "nigger",
  "faggot",
  "dickhead"
];
var PROFANITY_ALLOWED_PHRASES = [
  "시발점",
  "시발역",
  "시발자동차",
  "시발차"
];
var PROFANITY_ERROR = "비속어·욕설이 포함되어 있어 등록할 수 없어요.";
function normalizeForProfanityCheck(raw) {
  let text = String(raw ?? "").toLowerCase().normalize("NFC").replace(/[^\p{L}\s]/gu, "").replace(/\s+/gu, " ");
  for (const allowed of PROFANITY_ALLOWED_PHRASES) {
    text = text.split(allowed).join(" ");
  }
  return text;
}
function findProfanity(text) {
  const normalized = normalizeForProfanityCheck(text);
  if (!normalized) return null;
  return PROFANITY_WORDS.find((word) => normalized.includes(word)) ?? null;
}
function containsProfanity(text) {
  return findProfanity(text) !== null;
}
function profanityError(text) {
  return containsProfanity(text) ? PROFANITY_ERROR : null;
}

// src/comment-constraints.ts
var COMMENT_CONTENT_MAX = 2e3;
export {
  ANON_PREVIEW_CARDS,
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MIN_SECONDS_PER_QUESTION,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  AVATAR_ALLOWED_MIME,
  AVATAR_BASE64_MAX_CHARS,
  AVATAR_ENCODED_MAX_BYTES,
  AVATAR_MAX_BYTES,
  AVATAR_PATHS_MAX,
  AVATAR_SIZE,
  AnthropicRequestError,
  BANNED_SUBSTRINGS,
  COACH_PER_SUBJECT,
  COMMENT_CONTENT_MAX,
  DIAGNOSIS_LOCKED,
  DIAGNOSIS_MODEL_DEFAULT,
  DIAGNOSIS_RECHECK_SECONDS,
  DIAGNOSIS_WINDOW_DAYS,
  EMPTY_MIX_POOL,
  EXPLANATION_CONTENT_COLUMNS,
  EXPLANATION_DOWNLOAD_HOURLY_LIMIT,
  EXPLANATION_VIEW_HOURLY_LIMIT,
  FALLBACK_NICKNAME,
  FREE_EXPLANATION_DAILY_PAPERS,
  FREE_MEMBERSHIP,
  FREE_UNTIL,
  FREE_UNTIL_LABEL,
  KST_TIME_ZONE,
  MIN_ATTEMPT_SECONDS,
  MIX_SCOPE,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PAGE_BATCH_SIZE,
  PROFANITY_ALLOWED_PHRASES,
  PROFANITY_ERROR,
  PROFANITY_WORDS,
  QUERY_CONCURRENCY,
  QUESTION_ID_CHUNK,
  REVIEW_COOLDOWN_HOURS,
  REVIEW_PICK_RECENT_DAYS,
  REVIEW_PICK_REPEAT_THRESHOLD,
  REVIEW_PICK_TIER_WEIGHTS,
  REVIEW_SESSION_MAX_LIMIT,
  SRS_EARLY_LAPSE_FACTOR,
  SRS_EARLY_LAPSE_RATIO,
  SRS_EASE_BONUS,
  SRS_EASE_PENALTY,
  SRS_FIRST_INTERVAL_DAYS,
  SRS_FUZZ_MIN_DAYS,
  SRS_FUZZ_RATIO,
  SRS_INITIAL,
  SRS_LEECH_REPEAT,
  SRS_LEECH_THRESHOLD,
  SRS_MAX_EASE,
  SRS_MAX_INTERVAL_DAYS,
  SRS_MIN_EASE,
  SRS_RELEARN_DELAY_HOURS,
  SRS_SECOND_INTERVAL_DAYS,
  TRIAL_DAYS,
  WRONG_NOTE_QUESTION_LIMIT,
  attendanceDaysLeft,
  attendanceEarnedDays,
  attendanceMilestoneDates,
  attendanceMilestonesReached,
  attendanceProgress,
  attendanceQuestionCount,
  authorNickname,
  avatarBytesError,
  avatarInitial,
  avatarPublicUrl,
  avatarUploadError,
  avatarUrlMap,
  batchCustomId,
  buildCoachingParams,
  buildMixHubIndex,
  buildMixPool,
  buildSubjectIndex,
  chunk,
  collapseDuplicatePapers,
  collectAllReviewCandidates,
  collectConceptReviewCandidates,
  collectDiagnosisBatches,
  collectDiagnosisForUser,
  collectDueCandidates,
  collectDueQueueItems,
  collectExtraQueueItems,
  collectPaperReviewCandidates,
  collectSubjectReviewSource,
  collidingPaperIds,
  conceptSelectionKey,
  consumeFreeExplanationQuota,
  containsProfanity,
  createAllReviewSessionForUser,
  createAnthropicBatchTransport,
  createConceptReviewSessionForUser,
  createDueReviewSessionForUser,
  createMixSessionForUser,
  createPaperReviewSessionForUser,
  createRetryFromMixSession,
  createReviewSessionForUser,
  createReviewSessionFromItems,
  daysInMonthKey,
  decodePapers,
  embedOne,
  encodePapers,
  fetchAllCbtAvailability,
  fetchAllPages,
  fetchAnsweredQuestionNumbers,
  fetchCatalog,
  fetchCbtAvailability,
  fetchCorrectAnswers,
  fetchDiagnosisEligibility,
  fetchExamPaperRows,
  fetchExplainedNumbers,
  fetchExplanations,
  fetchLastWrongChoices,
  fetchMemos,
  fetchMyRoundCounts,
  fetchPaperIdentitySignals,
  fetchPaperIdentitySignalsRpc,
  fetchPlayableQuestionCounts,
  fetchQuestionCountSignals,
  fetchQuestionKeys,
  fetchQuestionMedia,
  fetchSubjectFilters,
  fetchSubjectPapers,
  fetchWrongNoteMarks,
  filterPapers,
  filterQuestionsAnsweredByUser,
  findProfanity,
  findUnfinishedDueSession,
  formatCount,
  formatDuration,
  formatFileSize,
  fuzzInterval,
  getDiagnosisAggregate,
  getDiagnosisPausedSubjectIds,
  getDueReviewSummary,
  getExamTypeNames,
  getExcludedDiagnosisSubjectSlugs,
  getLatestReadyDiagnosis,
  getMembership,
  getMixSessionWrongNote,
  getPaperSlug,
  getPausedSubjectIds,
  getPendingDiagnosisBatch,
  getReviewPrefs,
  getReviewSessionView,
  getReviewSubjectOptions,
  getSessionSchedule,
  getStoredStudyPhase,
  getSubjectBySlug,
  getWeeklyDiagnosis,
  groupByYearAndSubject,
  hasOwnPremiumPeriod,
  inParallel,
  isAdFreeMembership,
  isAdminEmail,
  isAllowedAvatarMime,
  isAttendanceOpen,
  isCbtRuleError,
  isFreeForAll,
  isLeechTrigger,
  isPaperUuid,
  isPremiumMembership,
  isPremiumUserFor,
  isSameSrsDay,
  isTrialUnstarted,
  isValidAvatarPath,
  kstDateKey,
  kstDayKey,
  kstMonthKey,
  kstToday,
  listMixSessions,
  listRecentMixSessions,
  listSubmittedReviewSessions,
  markReviewItemGuessed,
  maxTokensFor,
  membershipDaysLeft,
  membershipFromRow,
  mergeConceptResults,
  nextAttendanceMilestone,
  nextDiagnosisDate,
  nextSrs,
  normalizeChoiceExplanations,
  normalizeConceptSelection,
  normalizeForProfanityCheck,
  normalizePaperSlugParam,
  paperDedupKey,
  parseBatchCustomId,
  parseCoachingItems,
  pickCoachTargets,
  pickRandomReviewCandidates,
  pickReviewCandidates,
  pickWeightedReviewCandidates,
  planCoaching,
  profanityError,
  readWebpInfo,
  recordAttendance,
  recordQuestionResults,
  removeUserAvatar,
  representativePaperIds,
  requestDiagnosisForUser,
  resolveDiagnosisModel,
  resolveExplanationAccess,
  resolveStatusTargets,
  resolveWrongNoteExplanations,
  restoreSuspendedQuestions,
  reviewPickTier,
  sanitizeSelectedChoice,
  saveDiagnosisReport,
  saveStudyPhase,
  setDailyLimit,
  setDiagnosisSubjectPaused,
  setSubjectPaused,
  spreadOverdueBacklog,
  srsDayIndex,
  srsDayStart,
  srsDueAt,
  srsGuessed,
  srsRelearnDueAt,
  srsStateFromRow,
  startCbtAttempt,
  startTrialIfEligible,
  statusTargetKey,
  submitCbtAttempt,
  submitPendingDiagnoses,
  submitReviewSessionForUser,
  toDiagnosisBoard,
  toExplanationContent,
  toMixOverview,
  toMixSessionBriefs,
  toReviewResultItems,
  toReviewSolveItems,
  trialDaysLeft,
  trialExpiresAt,
  uploadUserAvatar,
  validateNickname
};
