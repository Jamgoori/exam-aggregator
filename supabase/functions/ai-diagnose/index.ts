// AI 약점 진단(온디맨드). 웹은 요청 행만 만들고 배치가 채우지만, 앱은 이 함수에서
// 바로 Claude 를 호출해 리포트를 생성·저장·반환한다(스키마는 웹 AiDiagnosisReport 동일).
//
// 필요 시크릿: ANTHROPIC_API_KEY (supabase secrets set). 모델은 DIAGNOSIS_MODEL 로 override.
// 자격: 누적 오답 15개 또는 응시 3회 이상(웹 DIAGNOSIS_MIN_* 와 동일). 하루 1회 캐시.
import { corsHeaders, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { isPremiumUser } from "../_shared/membership.ts";

const MIN_WRONG = 15;
const MIN_ATTEMPTS = 3;
const MODEL = Deno.env.get("DIAGNOSIS_MODEL") ?? "claude-sonnet-5";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  if (!ANTHROPIC_KEY) {
    return json({ error: "진단 기능이 아직 설정되지 않았어요(관리자: ANTHROPIC_API_KEY)." }, 503);
  }

  const admin = adminClient();

  // AI 약점 진단은 멤버십 기능. 아래에서 실제로 모델을 호출하므로, 막지 않으면
  // 화면을 우회한 호출이 그대로 비용이 된다.
  if (!(await isPremiumUser(admin, userId, auth.email))) {
    return json({ error: "AI 약점 진단은 멤버십 기능이에요." }, 403);
  }

  const today = kstToday();

  // 하루 1회 캐시: 오늘 리포트가 있으면 그대로 반환.
  {
    const { data: existing } = await admin
      .from("ai_diagnoses")
      .select("report")
      .eq("user_id", userId)
      .eq("diagnosis_date", today)
      .maybeSingle();
    if (existing?.report) return json({ report: existing.report, date: today, cached: true });
  }

  // 자격 판정.
  const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
    admin.from("cbt_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin
      .from("user_question_status")
      .select("paper_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("wrong_count", 0),
  ]);
  const attempts = attemptCount ?? 0;
  const wrongs = wrongCount ?? 0;
  if (!(wrongs >= MIN_WRONG || attempts >= MIN_ATTEMPTS)) {
    return json(
      {
        error: `문제를 조금 더 풀면 진단을 받을 수 있어요 (오답 ${MIN_WRONG}개 또는 ${MIN_ATTEMPTS}회 응시).`,
      },
      400,
    );
  }

  // 동시호출 방지: 오늘 행을 report=null 로 먼저 "선점"해 Claude 를 한 번만 부른다.
  // 유니크(user_id, diagnosis_date) 충돌이 나면 다른 요청이 이미 생성 중이거나 완료된
  // 것이므로, 다시 읽어 완료됐으면 그 결과를, 아니면 "생성 중"을 돌려준다. 연타/병렬
  // 요청이 Anthropic 을 여러 번 호출해 비용을 태우는 걸 막는다.
  const { error: claimError } = await admin
    .from("ai_diagnoses")
    .insert({ user_id: userId, diagnosis_date: today, report: null });
  if (claimError) {
    if (claimError.code === "23505") {
      const { data: row } = await admin
        .from("ai_diagnoses")
        .select("report")
        .eq("user_id", userId)
        .eq("diagnosis_date", today)
        .maybeSingle();
      if (row?.report) return json({ report: row.report, date: today, cached: true });
      return json({ error: "진단을 생성하고 있어요. 잠시 후 다시 확인해주세요." }, 202);
    }
    return json({ error: "진단 요청에 실패했어요." }, 500);
  }

  // 컨텍스트 수집 + Claude 호출.
  let report;
  try {
    const context = await buildContext(admin, userId);
    report = await generateReport(context);
  } catch (_e) {
    // 생성 실패 시 선점 행을 지워, 그날 진단이 "생성 중"으로 영구히 막히지 않게 한다.
    await admin
      .from("ai_diagnoses")
      .delete()
      .eq("user_id", userId)
      .eq("diagnosis_date", today);
    return json({ error: "진단 생성에 실패했어요. 잠시 후 다시 시도해주세요." }, 502);
  }

  await admin
    .from("ai_diagnoses")
    .update({ report, model: MODEL, generated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("diagnosis_date", today);

  return json({ report, date: today, cached: false });
});

// deno-lint-ignore no-explicit-any
async function buildContext(admin: any, userId: string) {
  const { data: statusRows } = await admin
    .from("user_question_status")
    .select("last_is_correct, wrong_count, exam_papers!inner(subjects!inner(name, slug))")
    .eq("user_id", userId)
    .gt("wrong_count", 0);

  const bySubject = new Map<string, { name: string; slug: string; wrong: number; resolved: number }>();
  for (const r of statusRows ?? []) {
    const ep = Array.isArray(r.exam_papers) ? r.exam_papers[0] : r.exam_papers;
    const s = ep?.subjects ? (Array.isArray(ep.subjects) ? ep.subjects[0] : ep.subjects) : null;
    if (!s) continue;
    const cur = bySubject.get(s.slug) ?? { name: s.name, slug: s.slug, wrong: 0, resolved: 0 };
    if (r.last_is_correct) cur.resolved += 1;
    else cur.wrong += 1;
    bySubject.set(s.slug, cur);
  }

  const { data: attemptRows } = await admin
    .from("cbt_attempts")
    .select("score, total_questions, created_at, exam_papers(title, subjects(name))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(15);

  const recentAttempts = (attemptRows ?? []).map((a: any) => {
    const ep = Array.isArray(a.exam_papers) ? a.exam_papers[0] : a.exam_papers;
    const subj = ep?.subjects ? (Array.isArray(ep.subjects) ? ep.subjects[0] : ep.subjects) : null;
    return {
      subject: subj?.name ?? null,
      score: a.score,
      total: a.total_questions,
      date: String(a.created_at).slice(0, 10),
    };
  });

  return { subjects: [...bySubject.values()], recentAttempts };
}

// deno-lint-ignore no-explicit-any
async function generateReport(context: any) {
  const system =
    "너는 한국 공무원 시험 대비 학습 코치다. 학습자의 과목별 오답/극복 통계와 최근 응시 " +
    "결과를 보고 약점을 진단한다. 반드시 지정한 JSON 스키마만 출력한다(마크다운·설명 금지). " +
    "모든 텍스트는 한국어. 근거 없는 추측 대신 주어진 데이터에 기반한다. subjectSlug 는 " +
    "제공된 slug 를 그대로 쓴다.";

  const schema =
    '{"summary": string, "weakConcepts": [{"concept": string, "subject": string|null, ' +
    '"subjectSlug": string|null, "wrongCount": number|null, "resolvedCount": number|null}], ' +
    '"subjectTrends": [{"subject": string, "trend": "up"|"down"|"flat", "note": string}]}';

  const userMsg =
    `다음은 한 학습자의 데이터다.\n\n` +
    `과목별 통계(오답 wrong / 극복 resolved):\n${JSON.stringify(context.subjects, null, 2)}\n\n` +
    `최근 응시:\n${JSON.stringify(context.recentAttempts, null, 2)}\n\n` +
    `이 데이터로 약점을 진단해 아래 JSON 스키마로만 답하라:\n${schema}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const text: string = (data?.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  // 모델이 코드펜스로 감싸는 경우까지 대비해 첫 { ~ 마지막 } 를 잘라 파싱.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no json");
  const parsed = JSON.parse(text.slice(start, end + 1));

  return {
    summary: String(parsed.summary ?? ""),
    weakConcepts: Array.isArray(parsed.weakConcepts) ? parsed.weakConcepts : [],
    subjectTrends: Array.isArray(parsed.subjectTrends) ? parsed.subjectTrends : [],
  };
}
