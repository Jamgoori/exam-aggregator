// AI 약점 진단 대시보드가 그리는 **무AI 집계**(설계서 §6.7 #21, §12 Phase 4).
// `diagnosis-request` 와 함께 옛 `ai-diagnose` 를 대체한다.
//
//   { days?: number | null, subjectSlug?: string | null }
//     → { window, subjects, concepts, bySubject, analysisDays, picker, cycle, generating, eligibility }
//
// 웹 `app/mypage/diagnosis/page.tsx` 가 서버에서 만들던 props 를 한 번의 왕복으로 돌려준다
// (같은 순서·같은 규칙). 규칙 본문은 core `rules/diagnosis-aggregate.ts`(집계)·
// `rules/diagnosis-request.ts`(주기 조회)·`diagnosis-targets.ts`(추천 선정)이고, 여기는
// 인증·프리미엄 판정·투영·직렬화만 한다.
//
// **싣지 않는 것**:
//   · 리포트 본문(conceptCoaching·summary·weakConcepts) — 앱이 `ai_diagnoses.report` 를
//     RLS 로 직접 읽는다(§6.7 #21 "앱은 ai_diagnoses 를 RLS 로 폴링"). 진단 본문은 메모리
//     쿼리캐시에만 두는 값이라(앱 AGENTS.md 금지선), 집계 응답에 섞어 두면 디스크로 새기 쉽다.
//   · 정답·해설 본문·오답 문항 표본 — 그건 배치 제출이 모델 요청 본문을 만들 때만 쓰는
//     입력이고(core `rules/diagnosis-samples.ts#getWrongQuestionSamples`, service_role)
//     화면에는 원래 안 나온다. 응답에 섞지 말 것 — 정답은 RLS 로 막아 둔 값이다.
//   · totals·conceptKind·answeredCount·과목 평균/추세 — 보드가 그리지 않는다(자세한 이유는
//     core rules/diagnosis-aggregate.ts 의 "앱(Edge)용 투영" 절).
//
// ⚠ **비싼 호출이다.** 계정 전체 응시 이력 → 기간 안 응답 → 문항·해설·개념 → 개념별 기출 수로
// 최대 60왕복이 붙고, 웹의 `'use cache'`(30초)에 해당하는 계층이 Edge 에는 없다. 앱은 화면
// 진입과 기간 칩 전환에만 부를 것 — 리포트 대기 폴링은 이 함수가 아니라 `ai_diagnoses`
// 직접 조회(인덱스 한 방)와 `diagnosis-collect`(내 배치 행 두 번 읽기)로 한다.
//
// 그래서 이 응답의 `generating` 은 **화면에 들어온 그 순간의 값**이고 다시 받지 않는다.
// 대기 카드를 그릴지 말지는 요청 행(`ai_diagnoses`)과 `diagnosis-collect` 가 정본이다 —
// 이 값만 믿으면 리포트가 도착한 뒤에도 "만드는 중"이 남는다(diagnosis-board.tsx).
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  conceptSelectionKey,
  DIAGNOSIS_WINDOW_DAYS,
  fetchDiagnosisEligibility,
  getDiagnosisAggregate,
  getExcludedDiagnosisSubjectSlugs,
  getPendingDiagnosisBatch,
  getWeeklyDiagnosis,
  isPremiumUserFor,
  nextDiagnosisDate,
  pickCoachTargets,
  toDiagnosisBoard,
  type BoardConcept,
  type DiagnosisAggregate,
} from "../_shared/core.mjs";

// 웹 mypage/actions.ts·rules/diagnosis-request.ts 와 **같은 문장**(한 글자도 바꾸지 말 것).
const DIAGNOSIS_LOCKED = "AI 약점 진단은 멤버십 기능이에요.";

// 선택창 한 줄. 계약 타입은 core edge/contracts.ts 의 DiagnosisPickerConcept — 그쪽은 앱
// 번들용(index.ts)이라 core.mjs(server.ts 번들)에 없어서 같은 모양을 여기 적어 둔다.
type PickerConcept = {
  key: string;
  concept: string;
  conceptId: string | null;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number;
  accuracyPct: number | null;
  scoreGainPct: number | null;
  recommended: boolean;
};

// 그래프 기간. 웹 화면의 칩은 7·30·전체 셋뿐이지만(page.tsx RANGES) 여기서는 숫자를
// 그대로 받는다 — 규칙의 자동 확장 사다리가 "요청한 창보다 넓은 칸"만 이어 붙이므로
// 임의의 양수도 안전하다. 음수·NaN 만 기본값으로 떨어뜨린다.
function parseDays(raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return DIAGNOSIS_WINDOW_DAYS;
  return Math.floor(raw);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const days = parseDays(body?.days);
  const subjectSlug = typeof body?.subjectSlug === "string" && body.subjectSlug ? body.subjectSlug : null;

  const admin = coreAdmin();

  // 집계 **전에** 판정한다(웹 page.tsx 와 같은 순서) — 못 볼 화면을 위해 계정 전체 오답을
  // 훑지 않으려는 것이다.
  if (!(await isPremiumUserFor(admin, auth))) return json({ error: DIAGNOSIS_LOCKED }, 403);

  const graph: DiagnosisAggregate = await getDiagnosisAggregate(admin, userId, { days, subjectSlug });

  // 화면이 "지금 만들 수 있는가"를 판정하는 데 필요한 것들. 셋 다 가벼운 조회라 함께 던진다.
  const [generating, weekly, eligibility] = await Promise.all([
    getPendingDiagnosisBatch(admin, userId),
    getWeeklyDiagnosis(admin, userId),
    fetchDiagnosisEligibility(admin, userId),
  ]);

  // 선택창을 여는 조건(웹 page.tsx canGenerate 와 같다): 이번 주기에 아직 안 받았고,
  // 배치가 돌고 있지 않고, 최근 7일 오답이 있고, 자격이 열려 있을 때만.
  // 배치 중에 선택창을 그리면 같은 진단에 두 번 요금이 나간다.
  const cycleDone = weekly?.status === "ready";
  // 오답 말고 나머지 세 조건을 **먼저** 본다. 웹은 순서가 반대지만(집계 → canGenerate) 웹의
  // 두 번째 집계는 `'use cache'` 가 받아 주고 Edge 에는 그 계층이 없다 — 이번 주기를 이미 쓴
  // 사용자(요청 직후부터 7일 내내)가 화면에 들어올 때마다 아무도 안 쓸 60왕복을 한 번 더 도는
  // 셈이었다. 세 조건 중 하나라도 막혀 있으면 picker 는 어차피 null 이라 응답은 같다.
  const mayGenerate = !cycleDone && generating == null && eligibility.eligible;

  // 극복법이 분석할 집계는 기간 칩과 무관하게 언제나 최근 7일이다. 기본 칩이 그 7일이라
  // 대개는 위에서 만든 집계를 그대로 재사용한다(추가 왕복 없음). 다른 칩을 골랐을 때만
  // 7일치를 따로 집계한다 — 그래프에 보이는 개념과 고를 수 있는 개념이 어긋나면
  // "그래프에 있는데 왜 못 고르지"가 되므로, 선택창이 스스로 기간을 밝힌다.
  //
  // 자동 확장(widened)이 걸린 집계는 쓰지 않는다. widened 는 "그 기간에 틀린 게 없어
  // 기간을 넓혔다"는 뜻이라, 그 개념들을 골라 봐야 생성기가 "최근 7일 오답이 없어요"로 되돌린다.
  const analysisAgg: DiagnosisAggregate | null = !mayGenerate
    ? null
    : days === DIAGNOSIS_WINDOW_DAYS
      ? graph.window.widened
        ? null
        : graph
      : await getDiagnosisAggregate(admin, userId, { days: DIAGNOSIS_WINDOW_DAYS, widen: false });

  const canGenerate = mayGenerate && (analysisAgg?.concepts.length ?? 0) > 0;

  const board = toDiagnosisBoard(graph);

  let picker: PickerConcept[] | null = null;
  if (canGenerate && analysisAgg) {
    // 미리 체크해 둘 추천은 자동 선정(pickCoachTargets)과 **같은 규칙**으로 뽑는다 — 그대로
    // 눌렀을 때의 결과가 자동 선정과 같아야, 고르는 일이 "해도 되고 안 해도 되는" 것이 된다.
    // 기본 칩(7일)이면 위 보드가 곧 분석 집계다 — 같은 객체를 두 번 투영하지 않는다.
    const source = analysisAgg === graph ? board : toDiagnosisBoard(analysisAgg);
    const excluded = await getExcludedDiagnosisSubjectSlugs(admin, userId);
    const recommended = new Set(
      pickCoachTargets({ concepts: source.concepts }, excluded).map((c: BoardConcept) =>
        conceptSelectionKey(c),
      ),
    );
    picker = source.concepts.map((c: BoardConcept) => ({
      key: conceptSelectionKey(c),
      concept: c.concept,
      conceptId: c.conceptId,
      subject: c.subject,
      subjectSlug: c.subjectSlug,
      wrongCount: c.wrongCount,
      accuracyPct: c.accuracyPct,
      scoreGainPct: c.scoreGainPct,
      recommended: recommended.has(conceptSelectionKey(c)),
    }));
  }

  return json({
    window: board.window,
    subjects: board.subjects,
    concepts: board.concepts,
    bySubject: board.bySubject,
    analysisDays: DIAGNOSIS_WINDOW_DAYS,
    picker,
    cycle: {
      requestedThisCycle: weekly != null,
      status: weekly?.status ?? null,
      date: weekly?.date ?? null,
      // 주기가 풀리는 날. 웹은 nextDiagnosisDate(today.date) 로 같은 값을 만든다.
      nextDate: weekly ? nextDiagnosisDate(weekly.date) : null,
    },
    generating,
    eligibility: {
      eligible: eligibility.eligible,
      attemptCount: eligibility.attemptCount,
      wrongCount: eligibility.wrongCount,
    },
  });
});
