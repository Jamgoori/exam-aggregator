// 사용법: node --env-file=.env.local scripts/save-diagnosis.mjs <결과파일.json>
//
// next-diagnosis.mjs가 내려준 입력 + diagnosis-prompt.md로 생성한 진단 리포트를
// ai_diagnoses에 저장한다(report + generated_at + model). service_role로 실행하며,
// 사용자에겐 update 권한이 없어 리포트 본문은 이 경로로만 채워진다.
//
// 입력 JSON 형식(단일 객체):
// {
//   "diagnosis_id": "uuid",
//   "model_version": "claude-opus-4-8",
//   "report": {
//     "summary": "요약 문단...",
//     "weakConcepts": [
//       { "concept": "처분성", "subject": "행정법", "subjectSlug": "administrative-law",
//         "wrongCount": 8, "resolvedCount": 2 }
//     ],
//     "subjectTrends": [
//       { "subject": "행정법", "trend": "up", "note": "최근 3회 62→70→75점..." }
//     ],
//     "conceptCoaching": [
//       { "concept": "처분성", "subject": "행정법", "subjectSlug": "administrative-law",
//         "weakPattern": "어떤 걸 틀리는지 한두 문장", "howToOvercome": "어떻게 잡을지 한두 문장" }
//     ]
//   }
// }

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const TRENDS = new Set(["up", "down", "flat"]);

function validateReport(report) {
  if (!report || typeof report !== "object") return "report 객체가 없습니다.";
  if (typeof report.summary !== "string" || !report.summary.trim())
    return "report.summary(문자열)가 필요합니다.";
  if (!Array.isArray(report.weakConcepts)) return "report.weakConcepts(배열)가 필요합니다.";
  if (!Array.isArray(report.subjectTrends)) return "report.subjectTrends(배열)가 필요합니다.";
  for (const c of report.weakConcepts) {
    if (!c || typeof c.concept !== "string" || !c.concept.trim())
      return "weakConcepts 항목에 concept(문자열)이 필요합니다.";
  }
  for (const t of report.subjectTrends) {
    if (!t || typeof t.subject !== "string" || !TRENDS.has(t.trend) || typeof t.note !== "string")
      return "subjectTrends 항목은 {subject, trend(up|down|flat), note}여야 합니다.";
  }
  return null;
}

function clampInt(v, lo, hi) {
  if (!Number.isFinite(v)) return null;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// 화면 타입에 맞게 정규화(불필요 필드 제거, 누락 필드 null). 리뉴얼된 대시보드용 필드
// (mission/insights/frequency/accuracyPct/scores)도 있으면 실어 준다 — 전부 선택이라
// 없으면 null/빈배열로 두고 화면이 알아서 대체·숨김한다.
function normalizeReport(report) {
  const mission =
    report.mission && typeof report.mission.headline === "string" && report.mission.headline.trim()
      ? {
          headline: String(report.mission.headline).trim(),
          subjectSlug: report.mission.subjectSlug != null ? String(report.mission.subjectSlug) : null,
          concept: report.mission.concept != null ? String(report.mission.concept) : null,
        }
      : null;

  // 개념별 맞춤 극복법. 온디맨드 경로(lib/diagnosis-generate.ts)가 채우는 것과 같은
  // 필드로, 진단 화면의 개념 카드가 이걸로 "이런 걸 틀려요 / 이렇게 잡으세요"를 그린다.
  // concept 는 화면이 개념 카드와 맞춰보는 키라 반드시 집계에 나온 표기 그대로여야 한다.
  const conceptCoaching = Array.isArray(report.conceptCoaching)
    ? report.conceptCoaching
        .filter(
          (c) =>
            c &&
            typeof c.concept === "string" &&
            c.concept.trim() &&
            typeof c.weakPattern === "string" &&
            c.weakPattern.trim() &&
            typeof c.howToOvercome === "string" &&
            c.howToOvercome.trim(),
        )
        .map((c) => ({
          concept: String(c.concept).trim(),
          subject: c.subject != null ? String(c.subject) : null,
          subjectSlug: c.subjectSlug != null ? String(c.subjectSlug) : null,
          weakPattern: String(c.weakPattern).trim(),
          howToOvercome: String(c.howToOvercome).trim(),
        }))
    : [];

  const insights = Array.isArray(report.insights)
    ? report.insights
        .filter((ins) => ins && typeof ins.text === "string" && ins.text.trim())
        .map((ins) => ({
          subject: ins.subject != null ? String(ins.subject) : null,
          text: String(ins.text).trim(),
          wrongRatePct: clampInt(ins.wrongRatePct, 0, 100),
        }))
    : [];

  return {
    summary: report.summary.trim(),
    mission,
    insights,
    conceptCoaching,
    weakConcepts: report.weakConcepts.map((c) => ({
      concept: String(c.concept).trim(),
      subject: c.subject != null ? String(c.subject) : null,
      subjectSlug: c.subjectSlug != null ? String(c.subjectSlug) : null,
      wrongCount: Number.isFinite(c.wrongCount) ? c.wrongCount : null,
      resolvedCount: Number.isFinite(c.resolvedCount) ? c.resolvedCount : null,
      frequency: clampInt(c.frequency, 1, 3),
      accuracyPct: clampInt(c.accuracyPct, 0, 100),
    })),
    subjectTrends: report.subjectTrends.map((t) => ({
      subject: String(t.subject),
      trend: t.trend,
      note: String(t.note),
      scores: Array.isArray(t.scores)
        ? t.scores.filter((n) => Number.isFinite(n)).map((n) => Math.round(n))
        : null,
    })),
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("사용법: node --env-file=.env.local scripts/save-diagnosis.mjs <결과파일.json>");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const payload = JSON.parse(await readFile(inputPath, "utf-8"));
  const diagnosisId = payload.diagnosis_id;
  if (!diagnosisId) {
    console.error("diagnosis_id가 필요합니다.");
    process.exit(1);
  }
  const invalid = validateReport(payload.report);
  if (invalid) {
    console.error(`리포트 형식 오류: ${invalid}`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase
    .from("ai_diagnoses")
    .update({
      report: normalizeReport(payload.report),
      model: payload.model_version ?? null,
      generated_at: new Date().toISOString(),
    })
    .eq("id", diagnosisId)
    .select("id, user_id, diagnosis_date")
    .maybeSingle();

  if (error) {
    console.error(`저장 실패: ${error.message}`);
    process.exit(1);
  }
  if (!data) {
    console.error(`해당 diagnosis_id를 찾지 못했습니다: ${diagnosisId}`);
    process.exit(1);
  }
  console.log(`저장 완료: ${data.user_id} · ${data.diagnosis_date}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
