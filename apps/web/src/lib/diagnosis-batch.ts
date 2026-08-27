import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MAX_WINDOW_DAYS,
  analysisWindowDays,
} from "@/lib/ai-diagnosis";
import { DIAGNOSIS_MODEL, parseCoachingItems } from "@/lib/diagnosis-coach";
import { planCoaching, saveDiagnosisReport } from "@/lib/diagnosis-generate";
import type { AiDiagnosisReport } from "@/lib/ai-diagnosis";

// 맞춤 극복법을 Message Batches API 로 만든다.
//
// 왜 배치인가: 진단은 주 1회짜리라 "지금 당장 20초 안에"가 요구사항이 아니다. 배치는
// 같은 모델·같은 프롬프트를 **절반 요금**으로 처리하고(비동기, 24시간 안에 완료 보장),
// 여러 사용자의 요청을 한 번에 밀어 넣을 수 있다. 즉시 생성은 눌린 그 요청 안에서
// 서버리스 함수가 모델 응답을 기다려야 해서 타임아웃과도 싸워야 했다.
//
// 흐름은 두 동작뿐이다:
//   제출(submitPendingDiagnoses) — report 가 비어 있는 진단 요청을 모아 배치 1건으로 낸다.
//   수거(collectDiagnosisBatches) — 끝난 배치의 결과를 읽어 report 를 채운다.
// 둘 다 여러 번 불려도 안전해야 한다(크론·페이지 진입·버튼이 각각 부른다). 진행 중인
// 배치가 있는 진단은 제출에서 제외되고, 이미 채워진 report 는 수거가 덮어쓰지 않는다.
//
// 상태는 ai_diagnosis_batches 에 남는다(스키마: supabase/schema.sql). 제출 시점의 무AI
// 리포트(요약·개념 목록·과목 추세)와 "무엇을 물어봤는지"(대상 개념 목록)를 그 행에
// 저장해 두는 이유는, 수거가 몇 시간 뒤에 일어나기 때문이다 — 그 사이에 사용자가 문제를
// 더 풀면 다시 집계한 결과는 프롬프트와 어긋난다. 질문과 답이 같은 데이터를 보게 하려면
// 질문할 때의 스냅샷을 그대로 들고 있어야 한다.

// 한 번에 배치로 밀어 넣을 진단 요청 수. 사용자당 입력이 10K 토큰 남짓이라 이 값이 곧
// 배치 1건의 크기다(요청 10만 건·256MB 가 API 상한이므로 한참 아래다). 크론이 매시간
// 도는 것을 전제로, 한 번에 처리하지 못한 요청은 다음 시간에 이어서 나간다.
const SUBMIT_BATCH_SIZE = 25;

// 같은 진단 요청에 대해 배치를 다시 낼 수 있는 횟수. 만들 게 없어 실패하는 요청
// (그 기간에 오답이 없다 등)을 크론이 매시간 영원히 재시도하면 요금과 로그만 쌓인다.
const MAX_ATTEMPTS_PER_DIAGNOSIS = 5;

type BatchItemContext = {
  // 제출 시점에 계산해 둔 리포트의 무AI 부분. 수거할 때 코칭만 얹어 저장한다.
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  // 그때 물어본 개념들. 모델 응답을 화면 데이터에 다시 붙이는 열쇠다.
  targets: { concept: string; subject: string | null; subjectSlug: string | null }[];
};

type PendingDiagnosisRow = { id: string; user_id: string };

function client(): Anthropic | null {
  // 이 기능 전용 키(즉시 생성과 같은 변수). 없으면 배치를 내지 않는다 — 키가 없다고
  // 사용자 흐름이 깨지지는 않고, 진단은 pending 으로 남아 화면의 데이터층만 보인다.
  const apiKey = process.env.ANTHROPIC_DIAGNOSIS_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

// 이 사용자의 분석 창(일). 마지막으로 리포트가 나온 날부터 오늘까지, 최대 2주.
// 배치 경로는 사용자 세션 없이 도는 크론에서도 불리므로 admin 클라이언트로 직접 읽는다.
async function windowDaysFor(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_diagnoses")
    .select("diagnosis_date")
    .eq("user_id", userId)
    .not("report", "is", null)
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = (data?.diagnosis_date as string | undefined) ?? null;
  return last ? analysisWindowDays(last) : DIAGNOSIS_MAX_WINDOW_DAYS;
}

// 사용자가 진단에서 뺀 과목 slug. review-preferences 의 같은 이름 함수는 사용자 세션
// 클라이언트를 받으므로, 크론에서 쓰려고 admin 으로 다시 읽는다.
async function excludedSubjectSlugsFor(userId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_preferences")
    .select("diagnosis_paused_subject_ids")
    .eq("user_id", userId)
    .maybeSingle();
  const ids = (data?.diagnosis_paused_subject_ids as string[] | null) ?? [];
  if (ids.length === 0) return new Set();
  const { data: subjects } = await admin.from("subjects").select("slug").in("id", ids);
  return new Set(((subjects ?? []) as { slug: string }[]).map((s) => s.slug).filter(Boolean));
}

export type SubmitResult = {
  // 배치에 실제로 실린 진단 요청 수.
  submitted: number;
  // 만들 게 없어 건너뛴 요청 수(그 기간에 오답이 없다 등).
  skipped: number;
  batchId?: string;
  // 사용자에게 그대로 보여줄 수 있는 사유(요청 하나짜리 제출에서만 의미가 있다).
  error?: string;
};

// report 가 비어 있는 진단 요청을 모아 배치 1건으로 제출한다.
//
// userId 를 주면 그 사람 것만 낸다("진단 받기" 버튼이 누른 즉시 부르는 경로 — 크론을
// 기다리면 최대 한 시간이 빈다). 주지 않으면 대기 중인 요청 전체를 훑는다(크론).
export async function submitPendingDiagnoses(
  opts: { userId?: string; limit?: number } = {},
): Promise<SubmitResult> {
  const anthropic = client();
  if (!anthropic) return { submitted: 0, skipped: 0, error: "진단 생성이 아직 설정되지 않았어요." };

  const admin = createAdminClient();
  const limit = opts.limit ?? SUBMIT_BATCH_SIZE;

  // 대기 중인 요청. 주기(7일) 밖으로 밀려난 오래된 요청까지 되살리지는 않는다 —
  // 그 사이 사용자의 오답은 이미 다음 주기의 분석 창으로 넘어갔다.
  const since = new Date();
  since.setDate(since.getDate() - (DIAGNOSIS_CYCLE_DAYS - 1));
  let query = admin
    .from("ai_diagnoses")
    .select("id, user_id")
    .is("report", null)
    .gte("diagnosis_date", since.toISOString().slice(0, 10))
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data: pendingRows } = await query;
  const pending = (pendingRows ?? []) as PendingDiagnosisRow[];
  if (pending.length === 0) return { submitted: 0, skipped: 0 };

  // 이미 배치에 실려 처리 중인 요청은 다시 내지 않는다(같은 진단에 두 번 요금이 나간다).
  // 시도 횟수 상한도 여기서 본다 — 만들 게 없어 계속 실패하는 요청을 크론이 영원히
  // 재시도하지 않도록.
  const { data: existing } = await admin
    .from("ai_diagnosis_batches")
    .select("diagnosis_id, status")
    .in("diagnosis_id", pending.map((p) => p.id));
  const attempts = new Map<string, number>();
  const inFlight = new Set<string>();
  for (const row of (existing ?? []) as { diagnosis_id: string; status: string }[]) {
    attempts.set(row.diagnosis_id, (attempts.get(row.diagnosis_id) ?? 0) + 1);
    if (row.status === "pending") inFlight.add(row.diagnosis_id);
  }

  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  const items: {
    diagnosis_id: string;
    user_id: string;
    custom_id: string;
    context: BatchItemContext;
  }[] = [];
  let skipped = 0;
  let lastError: string | undefined;

  for (const row of pending) {
    if (inFlight.has(row.id)) continue;
    if ((attempts.get(row.id) ?? 0) >= MAX_ATTEMPTS_PER_DIAGNOSIS) {
      skipped++;
      continue;
    }

    const { plan, error } = await planCoaching(
      row.user_id,
      await windowDaysFor(row.user_id),
      await excludedSubjectSlugsFor(row.user_id),
    );
    if (!plan) {
      skipped++;
      lastError = error;
      continue;
    }

    // custom_id 는 배치 안에서만 유일하면 된다. 진단 행 id 를 그대로 쓰면 결과를
    // 되돌릴 때 매칭 표가 따로 필요 없다.
    requests.push({ custom_id: row.id, params: plan.params });
    items.push({
      diagnosis_id: row.id,
      user_id: row.user_id,
      custom_id: row.id,
      context: {
        report: plan.report,
        targets: plan.targets.map((t) => ({
          concept: t.concept,
          subject: t.subject,
          subjectSlug: t.subjectSlug,
        })),
      },
    });
  }

  if (requests.length === 0) return { submitted: 0, skipped, error: lastError };

  let batch: Anthropic.Messages.Batches.MessageBatch;
  try {
    batch = await anthropic.messages.batches.create({ requests });
  } catch {
    return { submitted: 0, skipped, error: "진단 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요." };
  }

  // 배치를 낸 뒤에 기록한다. 반대 순서로 하면 create 가 실패했을 때 존재하지 않는
  // 배치를 영원히 기다리는 행이 남는다. 여기서 insert 가 실패하면 그 배치는 결과를
  // 수거하지 못한 채 버려지지만(요금은 나간다), 진단은 pending 이라 다음 제출에서
  // 다시 만들어진다 — 조용히 결과가 사라지는 쪽보다 낫다.
  const { error: insertError } = await admin.from("ai_diagnosis_batches").insert(
    items.map((it) => ({
      diagnosis_id: it.diagnosis_id,
      user_id: it.user_id,
      batch_id: batch.id,
      custom_id: it.custom_id,
      model: DIAGNOSIS_MODEL,
      context: it.context,
      status: "pending",
    })),
  );
  if (insertError) {
    return { submitted: 0, skipped, batchId: batch.id, error: "진단 요청 기록에 실패했어요." };
  }

  return { submitted: requests.length, skipped, batchId: batch.id, error: lastError };
}

export type CollectResult = {
  // report 를 채운 진단 수.
  ready: number;
  // 모델이 만들지 못했거나(빈 응답) 배치가 만료·오류로 끝난 수.
  failed: number;
  // 아직 처리 중이라 그대로 둔 수.
  pending: number;
};

// 끝난 배치의 결과를 읽어 report 를 채운다.
//
// userId 를 주면 그 사람의 진행 중 배치만 확인한다(진단 페이지에 들어왔을 때 부르는
// 경로 — 크론을 기다리지 않고 바로 결과를 본다). 주지 않으면 진행 중인 배치 전체를 본다.
export async function collectDiagnosisBatches(
  opts: { userId?: string } = {},
): Promise<CollectResult> {
  const anthropic = client();
  if (!anthropic) return { ready: 0, failed: 0, pending: 0 };

  const admin = createAdminClient();
  let query = admin
    .from("ai_diagnosis_batches")
    .select("id, diagnosis_id, user_id, batch_id, custom_id, context")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(200);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data } = await query;
  const items = (data ?? []) as {
    id: string;
    diagnosis_id: string;
    user_id: string;
    batch_id: string;
    custom_id: string;
    context: BatchItemContext;
  }[];
  if (items.length === 0) return { ready: 0, failed: 0, pending: 0 };

  // 한 배치에 여러 사용자가 실려 있으므로 배치 단위로 묶어 한 번씩만 조회한다.
  const byBatch = new Map<string, typeof items>();
  for (const it of items) {
    const list = byBatch.get(it.batch_id) ?? [];
    list.push(it);
    byBatch.set(it.batch_id, list);
  }

  const out: CollectResult = { ready: 0, failed: 0, pending: 0 };

  for (const [batchId, group] of byBatch) {
    let batch: Anthropic.Messages.Batches.MessageBatch;
    try {
      batch = await anthropic.messages.batches.retrieve(batchId);
    } catch {
      // 배치를 찾을 수 없다(삭제·다른 워크스페이스 키로 교체 등). 영원히 기다리지 않게
      // 실패로 닫는다 — 진단은 pending 이라 다음 제출에서 다시 만들어진다.
      await closeItems(group.map((g) => g.id), "failed", "배치를 찾을 수 없어요.");
      out.failed += group.length;
      continue;
    }

    if (batch.processing_status !== "ended") {
      out.pending += group.length;
      continue;
    }

    const byCustomId = new Map(group.map((g) => [g.custom_id, g]));
    const seen = new Set<string>();
    let results;
    try {
      results = await anthropic.messages.batches.results(batchId);
    } catch {
      out.pending += group.length;
      continue;
    }

    for await (const result of results) {
      const item = byCustomId.get(result.custom_id);
      if (!item) continue;
      seen.add(result.custom_id);

      if (result.result.type !== "succeeded") {
        // errored / canceled / expired. 이유를 남겨 두면 나중에 "왜 안 나왔지"를
        // 로그를 뒤지지 않고 이 테이블에서 볼 수 있다.
        await closeItems([item.id], "failed", `배치 결과가 ${result.result.type} 상태예요.`);
        out.failed++;
        continue;
      }

      const text = result.result.message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      const coaching = parseCoachingItems(text, item.context.targets);
      if (coaching.length === 0) {
        await closeItems([item.id], "failed", "모델이 극복법을 만들지 못했어요.");
        out.failed++;
        continue;
      }

      const saved = await saveDiagnosisReport(item.diagnosis_id, item.context.report, coaching);
      if (saved.error) {
        // 저장만 실패한 경우다. 결과 자체는 이미 배치에서 사라지지 않으므로 pending 으로
        // 두고 다음 수거에서 같은 결과를 다시 읽는다(배치 결과는 24시간 보관된다).
        out.pending++;
        continue;
      }
      await closeItems([item.id], "ready", null);
      out.ready++;
    }

    // 결과 파일에 아예 없던 요청(있어서는 안 되지만, 있으면 영원히 pending 이 된다).
    const missing = group.filter((g) => !seen.has(g.custom_id)).map((g) => g.id);
    if (missing.length > 0) {
      await closeItems(missing, "failed", "배치 결과에 이 요청이 없어요.");
      out.failed += missing.length;
    }
  }

  return out;
}

async function closeItems(ids: string[], status: "ready" | "failed", error: string | null) {
  if (ids.length === 0) return;
  await createAdminClient()
    .from("ai_diagnosis_batches")
    .update({ status, error, completed_at: new Date().toISOString() })
    .in("id", ids);
}

// 이 사용자의 극복법이 지금 배치에서 만들어지는 중인지. 화면이 "생성 중"과 "실패해서
// 다시 눌러야 함"을 구분해 말해 주려면 필요하다.
export async function getPendingDiagnosisBatch(
  userId: string,
): Promise<{ requestedAt: string } | null> {
  const { data } = await createAdminClient()
    .from("ai_diagnosis_batches")
    .select("requested_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { requestedAt: data.requested_at as string } : null;
}
