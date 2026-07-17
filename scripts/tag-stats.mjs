// 사용법: node scripts/tag-stats.mjs [--subject 국어]
//
// 태깅 진행률·분포 검사 리포트. 과목별로:
//   - 전체 문항 수 / 태깅된 문항 수 (진행률)
//   - 태그별 개수·비율
//   - 설계 임계값 위반 경고: "기타" > 10%(구멍), 단일 태그 > 40%(너무 굵음),
//     단일 태그 < 1%(너무 잘음 — 표본 200개 이상일 때만 의미)
// 봇 계정 로그인으로 실행 (questions는 public read라 사실 로그인 없어도 되지만,
// 다른 태깅 스크립트와 실행 환경을 동일하게 유지한다).

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

async function fetchAllTagged(supabase, subjectFilter) {
  // PostgREST는 group by가 없어 행을 받아서 센다. 페이지네이션으로 전량 순회.
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("questions")
      .select("unit_tag, exam_papers!inner(subjects!inner(name))")
      .not("unit_tag", "is", null)
      .range(from, from + pageSize - 1);
    if (subjectFilter) {
      query = query.eq("exam_papers.subjects.name", subjectFilter);
    }
    const { data, error } = await query;
    if (error) throw new Error(`태깅 행 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchTotalCounts(supabase, subjectFilter) {
  const counts = {};
  for (const tagged of [false, true]) {
    let query = supabase
      .from("questions")
      .select("id, exam_papers!inner(subjects!inner(name))", {
        count: "exact",
        head: true,
      });
    query = tagged
      ? query.not("unit_tag", "is", null)
      : query.is("unit_tag", null);
    if (subjectFilter) {
      query = query.eq("exam_papers.subjects.name", subjectFilter);
    }
    const { count, error } = await query;
    if (error) throw new Error(`개수 조회 실패: ${error.message}`);
    counts[tagged ? "tagged" : "untagged"] = count ?? 0;
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subjectFilter = args.subject ? String(args.subject) : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    console.error(
      "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, publishableKey);
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;
  if (botEmail && botPassword) {
    await supabase.auth.signInWithPassword({ email: botEmail, password: botPassword });
  }

  const totals = await fetchTotalCounts(supabase, subjectFilter);
  const rows = await fetchAllTagged(supabase, subjectFilter);

  const bySubject = new Map();
  for (const row of rows) {
    const subject = row.exam_papers?.subjects?.name ?? "(과목 불명)";
    if (!bySubject.has(subject)) bySubject.set(subject, new Map());
    const tagCounts = bySubject.get(subject);
    tagCounts.set(row.unit_tag, (tagCounts.get(row.unit_tag) ?? 0) + 1);
  }

  const report = {
    scope: subjectFilter ?? "(전체)",
    total_questions: totals.tagged + totals.untagged,
    tagged: totals.tagged,
    untagged: totals.untagged,
    progress_pct:
      totals.tagged + totals.untagged > 0
        ? Math.round((totals.tagged / (totals.tagged + totals.untagged)) * 1000) / 10
        : 0,
    subjects: [],
  };

  for (const [subject, tagCounts] of [...bySubject.entries()].sort(
    (a, b) => b[1].size - a[1].size,
  )) {
    const total = [...tagCounts.values()].reduce((a, b) => a + b, 0);
    const warnings = [];
    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => {
        const pct = Math.round((count / total) * 1000) / 10;
        if (tag === "기타" && pct > 10) {
          warnings.push(`"기타" ${pct}% > 10% — 태그 목록에 구멍 의심`);
        }
        if (tag !== "기타" && pct > 40) {
          warnings.push(`"${tag}" ${pct}% > 40% — 태그가 너무 굵음(분할 검토)`);
        }
        if (tag !== "기타" && total >= 200 && pct < 1) {
          warnings.push(`"${tag}" ${pct}% < 1% — 태그가 너무 잘음(병합 검토)`);
        }
        return { tag, count, pct };
      });
    report.subjects.push({ subject, tagged: total, tags, warnings });
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
