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

// src/paper-title.ts
function stripTrackFromTitle(title, track) {
  if (!track) return title;
  return title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim();
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

// src/rules/status-targets.ts
var DEDUP_SELECT = "id, subject_id, exam_type_id, year, round, level, track, title, created_at";
function statusTargetKey(paperId, questionNumber) {
  return `${paperId}#${questionNumber}`;
}
async function resolveStatusTargets(client, userId, items, opts = {}) {
  const out = /* @__PURE__ */ new Map();
  const paperIds = [...new Set(items.map((i) => i.paperId))];
  if (paperIds.length === 0) return out;
  const { data: baseRows } = await client.from("exam_papers").select(DEDUP_SELECT).in("id", paperIds);
  const base = baseRows ?? [];
  if (base.length === 0) return out;
  let siblingQuery = client.from("exam_papers").select(DEDUP_SELECT).in("subject_id", [...new Set(base.map((p) => p.subject_id))]).in("exam_type_id", [...new Set(base.map((p) => p.exam_type_id))]).in("year", [...new Set(base.map((p) => p.year))]).in("round", [...new Set(base.map((p) => p.round))]);
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
    const list = siblingsByRep.get(rep) ?? [];
    list.push(p.id);
    siblingsByRep.set(rep, list);
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

// src/comment-constraints.ts
var COMMENT_CONTENT_MAX = 2e3;

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
export {
  ANON_PREVIEW_CARDS,
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MIN_SECONDS_PER_QUESTION,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  BANNED_SUBSTRINGS,
  COMMENT_CONTENT_MAX,
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
  NICKNAME_MAX,
  NICKNAME_MIN,
  PROFANITY_ALLOWED_PHRASES,
  PROFANITY_ERROR,
  PROFANITY_WORDS,
  QUERY_CONCURRENCY,
  REVIEW_PICK_RECENT_DAYS,
  REVIEW_PICK_REPEAT_THRESHOLD,
  REVIEW_PICK_TIER_WEIGHTS,
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
  attendanceDaysLeft,
  attendanceEarnedDays,
  attendanceMilestoneDates,
  attendanceMilestonesReached,
  attendanceProgress,
  attendanceQuestionCount,
  authorNickname,
  chunk,
  collapseDuplicatePapers,
  collidingPaperIds,
  consumeFreeExplanationQuota,
  containsProfanity,
  daysInMonthKey,
  fetchPaperIdentitySignals,
  fetchQuestionMedia,
  findProfanity,
  formatCount,
  formatDuration,
  formatFileSize,
  fuzzInterval,
  getMembership,
  getPaperSlug,
  hasOwnPremiumPeriod,
  inParallel,
  isAdFreeMembership,
  isAdminEmail,
  isAttendanceOpen,
  isCbtRuleError,
  isFreeForAll,
  isLeechTrigger,
  isPaperUuid,
  isPremiumMembership,
  isPremiumUserFor,
  isSameSrsDay,
  isTrialUnstarted,
  kstDateKey,
  kstDayKey,
  kstMonthKey,
  kstToday,
  membershipDaysLeft,
  membershipFromRow,
  nextAttendanceMilestone,
  nextSrs,
  normalizeChoiceExplanations,
  normalizeForProfanityCheck,
  normalizePaperSlugParam,
  paperDedupKey,
  pickRandomReviewCandidates,
  pickReviewCandidates,
  pickWeightedReviewCandidates,
  profanityError,
  recordAttendance,
  recordQuestionResults,
  representativePaperIds,
  resolveExplanationAccess,
  resolveStatusTargets,
  reviewPickTier,
  sanitizeSelectedChoice,
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
  toExplanationContent,
  trialDaysLeft,
  trialExpiresAt,
  validateNickname
};
