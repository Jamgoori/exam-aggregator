// AI 약점 진단 **요청**(설계서 §6.7 #21, §12 Phase 4). 옛 `ai-diagnose` 를 대체하는 세
// 함수 중 하나다(나머지: `diagnosis-aggregate`, `diagnosis-collect`).
//
//   { selectedConcepts?: [{ conceptId, concept }] }
//     → { status: "ready" | "pending", date, nextDate, selectedCount,
//         submitted, generating, submitError, recheckSeconds }
//
// **요청 행을 만든 직후 그 자리에서 배치를 제출한다.** 예전에는 행만 만들고 제출·수거를
// 모두 웹 Vercel 크론(시간당 1회)이 했다 — 최악이 "제출 대기 1시간 + 배치 + 수거 대기
// 1시간"이었다. 지금은 제출이 이 호출 안에서 끝나고, 앱은 기다리는 동안
// `diagnosis-collect` 로 직접 수거한다. 남는 것은 배치 자체의 처리 시간뿐이다(대부분 1시간
// 안, 최대 24시간).
//
// **Message Batches API 를 계속 쓴다 — 표준가의 50% 다.** 동기 `/v1/messages` 로 바꾸면
// 요금이 2배가 되고 소유자가 그것을 거절했다. 배치 요금은 토큰 단위라 요청 1건짜리 배치도
// 단가가 같아서, 사용자마다 따로 내도 손해가 없다.
//
// 규칙 본문은 전부 core 다 — 게이트는 `rules/diagnosis-request.ts#requestDiagnosisForUser`,
// 제출은 `rules/diagnosis-batch.ts#submitPendingDiagnoses`. 웹 서버 액션
// `mypage/actions.ts#requestDiagnosis` 가 **같은 두 함수**를 부른다. 여기는 인증·프리미엄
// 판정·요청 파싱·상태 코드 매핑만 한다(어댑터에 if 가 늘면 규칙이 새는 것이다).
//
// 오류(§6.9 — 본문은 `{ error }` 한국어 문구 그대로):
//   401 로그인 필요 · 403 멤버십 잠금 · 400 자격 미달 · 500 요청 행 생성 실패
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, diagnosisBatchDeps, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  DIAGNOSIS_RECHECK_SECONDS,
  getPendingDiagnosisBatch,
  isPremiumUserFor,
  requestDiagnosisForUser,
  submitPendingDiagnoses,
} from "../_shared/core.mjs";

type ConceptSelection = { conceptId: string | null; concept: string };

// 요청 본문의 개념 목록은 여기서 모양만 거른다 — 중복 제거·상한(10개) 자르기는 규칙
// (normalizeConceptSelection)이 한다. 두 곳에서 자르면 "화면이 말한 개수"와 "저장된 개수"가
// 갈린다.
function parseSelectedConcepts(raw: unknown): ConceptSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: ConceptSelection[] = [];
  for (const item of raw) {
    const concept = typeof item?.concept === "string" ? item.concept : "";
    if (!concept) continue;
    out.push({
      conceptId: typeof item?.conceptId === "string" && item.conceptId ? item.conceptId : null,
      concept,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const admin = coreAdmin();

  // 프리미엄 판정은 어댑터 몫이다(웹은 rpc("is_admin") + 세션 클라이언트, Edge 는 JWT 의
  // email 로 admins 를 service_role 조회 — 둘 다 같은 core isPremiumMembership 으로 끝난다).
  // 규칙에는 판정 **결과**만 넘긴다.
  const premium = await isPremiumUserFor(admin, auth);

  const result = await requestDiagnosisForUser(
    admin,
    {
      userId: auth.userId,
      premium,
      selectedConcepts: parseSelectedConcepts(body?.selectedConcepts),
    },
    // Edge 는 요청 클라이언트가 곧 service_role 이라 팩토리도 같은 것을 돌려준다
    // (웹은 세션 클라이언트로 읽고 createAdminClient 로 쓴다 — 읽는 행은 같다).
    { getAdmin: () => admin },
  );

  if (!result.ok) {
    // 규칙이 돌려준 reason 으로만 상태를 고른다. 문구는 웹과 같은 문장을 그대로 흘려보낸다
    // (앱은 이 문구를 다시 쓰지 않고 그대로 그린다 — §6.9).
    const status = result.reason === "premium" ? 403 : result.reason === "not-eligible" ? 400 : 500;
    return json({ error: result.error }, status);
  }

  // 이번 주기 리포트가 이미 있으면 제출할 것이 없다(주기 잠금).
  let submitted = false;
  let submitError: string | null = null;
  let generating = false;

  if (result.status === "pending") {
    try {
      // userId 를 주므로 **이 사람 것만** 배치 1건으로 나간다. 같은 진단에 두 번 제출하지
      // 않는 것은 규칙이 본다: 이미 `ai_diagnosis_batches` 에 pending 행이 있으면 건너뛰고
      // (웹 크론과 같은 기준), 그 판정이 읽은 뒤 쓰는 것이라 연타에는 약하므로 제출 직전에
      // `ai_diagnoses.batch_claimed_at` 을 한 문장으로 선점한다. 잡지 못한 호출은 배치를
      // 내지 않는다 — 두 번 나가면 그대로 요금이 두 배다.
      const res = await submitPendingDiagnoses(admin, { userId: auth.userId }, diagnosisBatchDeps());
      submitted = res.submitted > 0;
      // 제출이 0건인 데는 이유가 있다(그 기간에 오답이 없다·이미 배치에 실려 있다·키
      // 미설정). 앞의 것은 사용자가 고칠 수 있으니 그대로 올리고, 나머지는 오류가 아니다.
      submitError = submitted ? null : (res.error ?? null);
    } catch (e) {
      // **제출이 실패해도 사용자의 요청을 잃지 않는다.** 요청 행은 그대로 두고 200 으로
      // 끝낸다 — 시간당 웹 크론(`/api/cron/diagnosis`)이 예전처럼 주워 간다. 여기서
      // 503·500 을 내면 소유자가 아직 `ANTHROPIC_API_KEY` 를 Edge secret 에 넣지 않은 동안
      // 진단이 통째로 죽는다. 키가 없는 경우는 애초에 예외가 아니라 위의 error 로 온다.
      console.error(
        "diagnosis-request 배치 제출 실패",
        e instanceof Error ? e.message : String(e),
      );
    }
    // 지금 만들어지는 중인가 — 방금 냈거나, 이미 진행 중인 배치가 있거나. 화면은 이 값으로
    // 선택창을 닫고 대기 카드를 띄운다(두 번 누르게 두지 않으려는 것).
    generating = submitted || (await getPendingDiagnosisBatch(admin, auth.userId)) != null;
  }

  return json({
    status: result.status,
    date: result.date,
    nextDate: result.nextDate,
    // 실제로 저장된 개념 수(상한으로 잘린 뒤). 앱이 "N개 개념을 분석하는 중"이라고 말한다.
    selectedCount: result.selectedConcepts.length,
    // ↓ 추가 필드(add-only). 옛 빌드는 이 값들을 모르고 그냥 무시한다.
    submitted,
    generating,
    submitError,
    // 앱이 `diagnosis-collect` 를 부를 때 지켜야 할 최소 간격(초). 서버가 정한다 —
    // 더 자주 불러도 서버가 Anthropic 을 두드리지 않고 pending 만 돌려준다.
    recheckSeconds: DIAGNOSIS_RECHECK_SECONDS,
  });
});
