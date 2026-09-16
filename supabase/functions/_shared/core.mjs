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
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
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
      for (const list of groups.values()) {
        if (picked.length >= cap) break;
        const next = list[i];
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
      const list = byPaper.get(paperId) ?? [];
      list.push({ question_number: r.question_number, is_correct: r.is_correct });
      byPaper.set(paperId, list);
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
    const list = byPaper.get(it.paperId) ?? [];
    list.push(it);
    byPaper.set(it.paperId, list);
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
async function buildMixPool(client, admin, subjectId) {
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
  const conceptByQuestionId = await fetchCanonicalConcepts(admin, [...rowsById.keys()]);
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
      const list = wrongBySession.get(r.session_id) ?? [];
      list.push(r);
      wrongBySession.set(r.session_id, list);
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
  buildMixHubIndex,
  buildMixPool,
  chunk,
  collapseDuplicatePapers,
  collectAllReviewCandidates,
  collectConceptReviewCandidates,
  collectDueCandidates,
  collectDueQueueItems,
  collectExtraQueueItems,
  collectPaperReviewCandidates,
  collectSubjectReviewSource,
  collidingPaperIds,
  consumeFreeExplanationQuota,
  containsProfanity,
  createAllReviewSessionForUser,
  createConceptReviewSessionForUser,
  createDueReviewSessionForUser,
  createMixSessionForUser,
  createPaperReviewSessionForUser,
  createRetryFromMixSession,
  createReviewSessionForUser,
  createReviewSessionFromItems,
  daysInMonthKey,
  embedOne,
  fetchAllPages,
  fetchAnsweredQuestionNumbers,
  fetchCorrectAnswers,
  fetchExplainedNumbers,
  fetchExplanations,
  fetchMemos,
  fetchPaperIdentitySignals,
  fetchPlayableQuestionCounts,
  fetchQuestionKeys,
  fetchQuestionMedia,
  fetchWrongNoteMarks,
  filterQuestionsAnsweredByUser,
  findProfanity,
  findUnfinishedDueSession,
  formatCount,
  formatDuration,
  formatFileSize,
  fuzzInterval,
  getDiagnosisPausedSubjectIds,
  getDueReviewSummary,
  getExcludedDiagnosisSubjectSlugs,
  getMembership,
  getMixSessionWrongNote,
  getPaperSlug,
  getPausedSubjectIds,
  getReviewPrefs,
  getReviewSessionView,
  getReviewSubjectOptions,
  getSessionSchedule,
  getStoredStudyPhase,
  getSubjectBySlug,
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
  listMixSessions,
  listRecentMixSessions,
  listSubmittedReviewSessions,
  markReviewItemGuessed,
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
  resolveWrongNoteExplanations,
  restoreSuspendedQuestions,
  reviewPickTier,
  sanitizeSelectedChoice,
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
  submitReviewSessionForUser,
  toExplanationContent,
  toMixOverview,
  toMixSessionBriefs,
  toReviewResultItems,
  toReviewSolveItems,
  trialDaysLeft,
  trialExpiresAt,
  validateNickname
};
