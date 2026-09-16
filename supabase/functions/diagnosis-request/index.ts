// AI 약점 진단 **요청**(설계서 §6.7 #21, §12 Phase 4). 옛 `ai-diagnose` 를 대체하는 두
// 함수 중 하나다.
//
//   { selectedConcepts?: [{ conceptId, concept }] }
//     → { status: "ready" | "pending", date, nextDate, selectedCount }
//
// **이 함수는 리포트를 만들지 않는다.** `ai_diagnoses` 에 report=null 인 요청 행 하나를
// 만들고 끝이다. 실제 생성은 웹 Vercel 크론 `/api/cron/diagnosis`(시간당, Anthropic Message
// Batches)가 맡는다 — 앱은 요청 뒤 `ai_diagnoses` 를 RLS(select own)로 폴링해 report 가
// 채워지길 기다린다. 그래서 앱의 진단은 "즉시"가 아니다 — 크론(`vercel.json` `0 * * * *`)이
// **제출과 수거를 모두** 시간당 한 번 하므로 앱 단독 경로의 최악은 "제출까지 최대 1시간 +
// 배치 몇 분 + 수거까지 최대 1시간"이다(§13 질문 9 는 "최대 1시간"으로 적었지만 그건 제출
// 지연만 센 것이다 — 화면 문구는 실제대로 "최대 두 시간"이고, 대기 카드 주석에 그 계산이
// 있다: apps/mobile/src/components/diagnosis/diagnosis-generating.tsx).
// 옛 ai-diagnose 의 동기 생성을 버린 대가이자, 웹과 같은 파이프라인·같은 스키마·절반 요금을
// 얻은 이유다.
//
// 규칙 본문은 core `rules/diagnosis-request.ts#requestDiagnosisForUser` — 웹 서버 액션
// `mypage/actions.ts#requestDiagnosis` 가 **같은 함수**를 부른다. 여기는 인증·프리미엄
// 판정·요청 파싱·상태 코드 매핑만 한다(어댑터에 if 가 늘면 규칙이 새는 것이다).
//
// 오류(§6.9 — 본문은 `{ error }` 한국어 문구 그대로):
//   401 로그인 필요 · 403 멤버십 잠금 · 400 자격 미달 · 500 요청 행 생성 실패
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { isPremiumUserFor, requestDiagnosisForUser } from "../_shared/core.mjs";

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

  return json({
    status: result.status,
    date: result.date,
    nextDate: result.nextDate,
    // 실제로 저장된 개념 수(상한으로 잘린 뒤). 앱이 "N개 개념을 분석하는 중"이라고 말한다.
    selectedCount: result.selectedConcepts.length,
  });
});
