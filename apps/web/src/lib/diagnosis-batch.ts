import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIAGNOSIS_CYCLE_DAYS } from "@/lib/ai-diagnosis";
import { DIAGNOSIS_MODEL } from "@/lib/diagnosis-coach";
import { planCoaching, saveDiagnosisReport } from "@/lib/diagnosis-generate";
import {
  batchCustomId,
  mergeConceptResults,
  parseBatchCustomId,
  type ConceptResult,
} from "@/lib/diagnosis-batch-merge";
import type { AiDiagnosisReport, DiagnosisConceptSelection } from "@/lib/ai-diagnosis";

// 맞춤 극복법을 Message Batches API 로 만든다.
//
// 왜 배치인가: 진단은 주 1회짜리라 "지금 당장 20초 안에"가 요구사항이 아니다. 배치는
// 같은 모델·같은 프롬프트를 **절반 요금**으로 처리하고(비동기, 24시간 안에 완료 보장),
// 여러 사용자의 요청을 한 번에 밀어 넣을 수 있다. 즉시 생성은 눌린 그 요청 안에서
// 서버리스 함수가 모델 응답을 기다려야 해서 타임아웃과도 싸워야 했다.
//
// 배치 안에서는 **개념 하나가 요청 하나**다(planCoaching 이 그렇게 갈라 준다). 진단 하나를
// 요청 하나(개념 10개)로 내던 때는 모델이 개념을 앞에서부터 차례로 쓰느라 생성 시간이
// 개념 수에 정비례했고, 그게 "10분"의 대부분이었다. 배치는 요청들을 동시에 처리하므로
// 개념별로 갈라 내면 전체가 가장 오래 걸리는 개념 하나 시간으로 줄고, 프롬프트·모델·
// effort 는 그대로라 극복법의 품질은 같다. 한 진단의 요청들은 같은 배치에 함께 실린다 —
// 배치는 끝나야 결과를 읽을 수 있으니, 진단 하나의 결과는 여전히 한 번에 온다.
//
// 흐름은 두 동작뿐이다:
//   제출(submitPendingDiagnoses) — report 가 비어 있는 진단 요청을 모아 배치 1건으로 낸다.
//   수거(collectDiagnosisBatches) — 끝난 배치의 결과를 진단별로 합쳐 report 를 채운다.
// 둘 다 여러 번 불려도 안전해야 한다(크론·페이지 진입·버튼이 각각 부른다). 진행 중인
// 배치가 있는 진단은 제출에서 제외되고, 이미 채워진 report 는 수거가 덮어쓰지 않는다.
//
// 상태는 ai_diagnosis_batches 에 남는다(스키마: supabase/schema.sql) — 진단 하나에 행
// 하나이고, 그 진단의 요청들은 custom_id 접두(진단 행 id)로 묶인다. 제출 시점의 무AI
// 리포트(요약·개념 목록·과목 추세)와 "무엇을 물어봤는지"(대상 개념 목록)를 그 행에
// 저장해 두는 이유는, 수거가 몇 시간 뒤에 일어나기 때문이다 — 그 사이에 사용자가 문제를
// 더 풀면 다시 집계한 결과는 프롬프트와 어긋난다. 질문과 답이 같은 데이터를 보게 하려면
// 질문할 때의 스냅샷을 그대로 들고 있어야 한다.

// 한 번에 배치로 밀어 넣을 진단 요청 수. 진단 하나가 개념 수(최대 COACH_MAX_TOTAL)만큼의
// 요청으로 갈라지므로 배치 1건은 최대 그 곱(250건 남짓)이다 — 요청 10만 건·256MB 가 API
// 상한이므로 한참 아래다. 크론이 매시간 도는 것을 전제로, 한 번에 처리하지 못한 요청은
// 다음 시간에 이어서 나간다.
const SUBMIT_BATCH_SIZE = 25;

// 같은 진단 요청에 대해 배치를 다시 낼 수 있는 횟수. 만들 게 없어 실패하는 요청
// (그 기간에 오답이 없다 등)을 크론이 매시간 영원히 재시도하면 요금과 로그만 쌓인다.
const MAX_ATTEMPTS_PER_DIAGNOSIS = 5;

type BatchItemContext = {
  // 제출 시점에 계산해 둔 리포트의 무AI 부분. 수거할 때 코칭만 얹어 저장한다.
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  // 그때 물어본 개념들. 모델 응답을 화면 데이터에 다시 붙이는 열쇠다. conceptId 는
  // 수거된 극복법 카드가 "같은 개념 기출 풀기"를 정본 개념 축으로 열어주기 위한 값이라
  // 여기에 함께 저장해 둔다(구버전 행에는 없어서 화면이 표기로 떨어진다).
  targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
  }[];
};

type PendingDiagnosisRow = {
  id: string;
  user_id: string;
  // 요청할 때 사용자가 고른 개념들. null 이면 생성기가 알아서 상위 개념을 고른다
  // (구버전 요청·배치 스크립트로 만들어진 행).
  selected_concepts: DiagnosisConceptSelection[] | null;
};

function client(): Anthropic | null {
  // 이 기능 전용 키(즉시 생성과 같은 변수). 없으면 배치를 내지 않는다 — 키가 없다고
  // 사용자 흐름이 깨지지는 않고, 진단은 pending 으로 남아 화면의 데이터층만 보인다.
  const apiKey = process.env.ANTHROPIC_DIAGNOSIS_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
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
    .select("id, user_id, selected_concepts")
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
      // 개념을 직접 고른 요청이면 과목 제외 설정은 볼 필요가 없다(선택이 이미 과목까지
      // 정한다). 고르지 않은 구버전 요청만 예전처럼 과목 제외로 좁힌다.
      row.selected_concepts?.length ? new Set<string>() : await excludedSubjectSlugsFor(row.user_id),
      row.selected_concepts ?? null,
    );
    if (!plan) {
      skipped++;
      lastError = error;
      continue;
    }

    // custom_id 는 배치 안에서만 유일하면 된다. 진단 행 id 를 접두로 쓰고 개념 순번을
    // 붙이면(diagnosis-batch-merge.ts) 결과를 되돌릴 때 매칭 표가 따로 필요 없다 —
    // 접두로 진단 행을, 순번으로 그 진단의 몇 번째 개념인지를 찾는다.
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
          subjectSlug: t.subjectSlug,
        })),
      },
    });
  }

  if (items.length === 0) return { submitted: 0, skipped, error: lastError };

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

  // submitted 는 진단(사용자) 수다. 요청 수(개념 수의 합)가 아니다.
  return { submitted: items.length, skipped, batchId: batch.id, error: lastError };
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

    // 결과의 custom_id 는 `<진단 행 id>_<개념 순번>` 이다(구형 배치는 진단 행 id 그대로).
    // 접두로 진단 행을 찾고, 그 진단의 개념별 결과를 모아 뒀다가 결과 파일을 다 읽은 뒤
    // 진단 단위로 합쳐 저장한다 — 한 진단의 요청들은 같은 배치에 있으므로 이 한 바퀴에
    // 전부 들어 있다.
    const byPrefix = new Map(group.map((g) => [g.custom_id, g]));
    const gathered = new Map<string, ConceptResult[]>();
    let results;
    try {
      results = await anthropic.messages.batches.results(batchId);
    } catch {
      out.pending += group.length;
      continue;
    }

    for await (const result of results) {
      const { prefix, index } = parseBatchCustomId(result.custom_id);
      const item = byPrefix.get(prefix);
      if (!item) continue;
      const list = gathered.get(item.id) ?? [];
      gathered.set(item.id, list);
      if (result.result.type !== "succeeded") {
        // errored / canceled / expired. 사유는 합칠 때 개념 이름과 함께 error 에 남는다.
        list.push({ index, status: result.result.type, text: "" });
        continue;
      }
      list.push({
        index,
        status: "succeeded",
        text: result.result.message.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
      });
    }

    for (const item of group) {
      const conceptResults = gathered.get(item.id);
      if (!conceptResults) {
        // 결과 파일에 아예 없던 진단(있어서는 안 되지만, 있으면 영원히 pending 이 된다).
        await closeItems([item.id], "failed", "배치 결과에 이 요청이 없어요.");
        out.failed++;
        continue;
      }

      const { coaching, failures } = mergeConceptResults(conceptResults, item.context.targets);
      if (coaching.length === 0) {
        // 개념이 하나도 안 나왔을 때만 실패다. 이유를 남겨 두면 나중에 "왜 안 나왔지"를
        // 로그를 뒤지지 않고 이 테이블에서 볼 수 있다.
        await closeItems([item.id], "failed", failures.join(" / ") || "모델이 극복법을 만들지 못했어요.");
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
      // 일부 개념이 빠진 채 저장됐으면 그 사실을 ready 행의 error 에 남긴다 — 사용자가
      // "고른 건 8개인데 6개만 왔다"고 물었을 때 여기서 바로 답이 나온다.
      await closeItems([item.id], "ready", failures.length > 0 ? failures.join(" / ") : null);
      out.ready++;
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
// 다시 눌러야 함"을 구분해 말해 주려면 필요하다. conceptCount 는 로딩 카드가 "고른 8개
// 개념을 분석하는 중"이라고 말해 주기 위한 값 — 몇 개를 기다리는지 모르면 대기가 더 길게
// 느껴진다.
export async function getPendingDiagnosisBatch(
  userId: string,
): Promise<{ requestedAt: string; conceptCount: number } | null> {
  const { data } = await createAdminClient()
    .from("ai_diagnosis_batches")
    .select("requested_at, context")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const context = data.context as BatchItemContext | null;
  return {
    requestedAt: data.requested_at as string,
    conceptCount: context?.targets?.length ?? 0,
  };
}
