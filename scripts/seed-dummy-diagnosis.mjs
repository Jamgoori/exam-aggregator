// 사용법:
//   node --env-file=.env.local scripts/seed-dummy-diagnosis.mjs --user <uuid|email> [옵션...]
//
// 실제 배치(next-diagnosis.mjs → Claude 생성 → save-diagnosis.mjs)를 거치지 않고,
// ai_diagnoses.report에 더미 리포트를 바로 채워 넣는 테스트용 스크립트. "AI 약점
// 진단받기" 화면을 실제 배치 없이 눈으로 확인하고 싶을 때 쓴다. service_role로
// RLS를 우회해 report가 채워진 상태(ready)로 직접 upsert한다(요청→대기 단계 생략).
//
// 옵션(전부 생략하면 diagnosis-prompt.md 예시와 같은 기본 더미 값 사용):
//   --user     <uuid|email>   필수. auth.users의 uuid 또는 이메일.
//   --date     YYYY-MM-DD     기본값: 오늘(KST).
//   --summary  "문단..."
//   --weak     "개념,과목,과목slug,틀린수,극복수;개념2,..."   (세미콜론으로 여러 개)
//   --trend    "과목,up|down|flat,메모;과목2,..."              (세미콜론으로 여러 개)
//   --model    기본값: "dummy-seed"
//
// 예:
//   node --env-file=.env.local scripts/seed-dummy-diagnosis.mjs --user test@example.com
//   node --env-file=.env.local scripts/seed-dummy-diagnosis.mjs --user <uuid> \
//     --summary "요약..." \
//     --weak "처분성,행정법,administrative-law,8,2;대동법,한국사,korean-history,5,1" \
//     --trend "행정법,up,최근 3회 62→70→75점.;한국사,flat,꾸준히 80점대 유지." \
//     --model dummy-seed

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRENDS = new Set(["up", "down", "flat"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function kstToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function parseWeakConcepts(raw) {
  return raw.split(";").filter(Boolean).map((entry) => {
    const [concept, subject, subjectSlug, wrongCount, resolvedCount] = entry
      .split(",")
      .map((s) => s.trim());
    if (!concept) throw new Error(`--weak 항목에 개념명이 필요합니다: "${entry}"`);
    return {
      concept,
      subject: subject || null,
      subjectSlug: subjectSlug || null,
      wrongCount: wrongCount ? Number(wrongCount) : null,
      resolvedCount: resolvedCount ? Number(resolvedCount) : null,
    };
  });
}

function parseSubjectTrends(raw) {
  return raw.split(";").filter(Boolean).map((entry) => {
    const [subject, trend, ...noteParts] = entry.split(",").map((s) => s.trim());
    if (!subject) throw new Error(`--trend 항목에 과목명이 필요합니다: "${entry}"`);
    if (!TRENDS.has(trend)) throw new Error(`--trend의 추세는 up|down|flat이어야 합니다: "${entry}"`);
    return { subject, trend, note: noteParts.join(",").trim() || "" };
  });
}

const DEFAULT_REPORT = {
  summary:
    "(더미 데이터) 전체 정답률은 상승 중이지만(68% → 75%) 오답이 행정법 판례형에 몰려 있어요. " +
    "특히 처분성 개념은 8번 틀리고 2번만 극복해 가장 시급합니다. 한국사는 안정권이에요.",
  weakConcepts: [
    {
      concept: "처분성",
      subject: "행정법",
      subjectSlug: "administrative-law",
      wrongCount: 8,
      resolvedCount: 2,
    },
  ],
  subjectTrends: [
    {
      subject: "행정법",
      trend: "up",
      note: "최근 3회 62 → 70 → 75점. 판례 문항만 집중하면 80점대 진입 가능.",
    },
  ],
};

async function resolveUserId(supabase, userArg) {
  if (UUID_RE.test(userArg)) return userArg;

  // 이메일로 넘어오면 auth admin API로 조회한다(소량 유저 기준 페이지 순회).
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`유저 조회 실패: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === userArg.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) break;
    page++;
  }
  throw new Error(`이메일로 유저를 찾지 못했습니다: ${userArg}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.user || args.user === true) {
    console.error("사용법: node --env-file=.env.local scripts/seed-dummy-diagnosis.mjs --user <uuid|email> [옵션...]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let report;
  try {
    const userId = await resolveUserId(supabase, args.user);
    const date = typeof args.date === "string" ? args.date : kstToday();
    report = {
      summary: typeof args.summary === "string" ? args.summary : DEFAULT_REPORT.summary,
      weakConcepts:
        typeof args.weak === "string" ? parseWeakConcepts(args.weak) : DEFAULT_REPORT.weakConcepts,
      subjectTrends:
        typeof args.trend === "string" ? parseSubjectTrends(args.trend) : DEFAULT_REPORT.subjectTrends,
    };
    const model = typeof args.model === "string" ? args.model : "dummy-seed";

    const { data, error } = await supabase
      .from("ai_diagnoses")
      .upsert(
        {
          user_id: userId,
          diagnosis_date: date,
          report,
          model,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,diagnosis_date" },
      )
      .select("id, user_id, diagnosis_date")
      .maybeSingle();

    if (error) throw new Error(`저장 실패: ${error.message}`);
    console.log(`더미 진단 저장 완료: ${data.user_id} · ${data.diagnosis_date} (id=${data.id})`);
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}

main();
