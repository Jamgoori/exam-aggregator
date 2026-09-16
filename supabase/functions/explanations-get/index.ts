// 문제지 해설. 웹 papers/[id]/explanations/page.tsx 와 같은 규칙. paper_answers(정답)와
// question_explanations 는 둘 다 admin 전용 RLS(일반 select 완전 차단)라 service_role
// 로만 읽는다 — CBT 채점과 같은 이유(정답 유출 방지).
//
// 접근 규칙은 packages/core/src/rules/explanation-access.ts#resolveExplanationAccess
// 하나가 웹·앱 공용으로 판정한다(예전엔 여기에 시간당 한도·무료 몫이 따로 구현돼 있었다):
//  - 비로그인: 미리보기 ANON_PREVIEW_CARDS 문항만.
//  - 로그인: 시간당 조회 40회 넘으면(explanation_access_log, admin 전용) 마찬가지로
//    미리보기만 — 계정 만들어 문제지 ID 순회 크롤링을 늦추는 목적, 정상 사용자는
//    걸릴 일 없음. 조회 자체는 막지 않고 "잠시 후" 로만 안내.
//  - 무료 회원: 위를 통과해도 하루 문제지 3개까지만(FREE_EXPLANATION_DAILY_PAPERS).
//    오늘 이미 연 문제지를 다시 여는 건 한도를 깎지 않는다.
//
// 막힌 이유(lockReason)를 응답에 실어 준다 — 앱이 "잠시 후 다시"와 결제 유도를 구분해서
// 보여줘야 하기 때문이다. 둘을 섞으면 수집 시도에 결제를 권하거나, 정상 사용자에게
// 결제하면 풀린다는 거짓말을 하게 된다. remainingToday(무료 회원의 오늘 남은 문제지 수,
// 유료·관리자·비로그인은 null)는 추가 필드(설계서 §6.7 #7).
//
// ── context:"wrong-note" 모드(§6.7 #7, Phase 2) ──────────────────────────────
// 오답노트·응시 상세·mix 기록 **안에서** 여는 해설. 위 페이지 모드와 규칙이 다르다:
// 쿼터·시간당 한도를 판정하지 않고(로그 행도 남기지 않는다) 대신 "프리미엄 + 본인이 답한
// 문항"으로만 본문을 내준다 — 웹 lib/wrong-notes.ts 가 admin 클라이언트로 해설을 조회하며
// explanation_access_log·explanation_daily_views 를 한 줄도 쓰지 않는 것과 같은 동작이다.
// 판정 본문은 core rules/explanations-wrong-note.ts(resolveWrongNoteExplanations) 하나이고
// 여기서는 입력 파싱과 직렬화만 한다. 응답은 기존 필드 + explanationLocked·
// lockedQuestionNumbers(추가 필드)이며 remainingToday·lockReason 은 null 로 둔다.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, getOptionalUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import {
  ANON_PREVIEW_CARDS,
  EXPLANATION_CONTENT_COLUMNS,
  fetchQuestionMedia,
  isPremiumUserFor,
  resolveExplanationAccess,
  resolveWrongNoteExplanations,
  toExplanationContent,
  type ExplanationAccess,
  type ExplanationRow,
  type QuestionExplanationContent,
  type QuestionMediaEntry,
} from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let paperId = "";
  let wrongNote = false;
  let questionNumbers: number[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    paperId = String(body?.paperId ?? "");
    wrongNote = body?.context === "wrong-note";
    questionNumbers = Array.isArray(body?.questionNumbers)
      ? body.questionNumbers.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
      : [];
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!isUuid(paperId)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = coreAdmin();
  const user = await getOptionalUser(req);
  const loggedIn = !!user;

  // ── 오답노트 모드 ─────────────────────────────────────────────────────────
  // 본인이 답한 문항만 대상이라 비로그인은 물을 것이 없다(미리보기도 주지 않는다 —
  // 해설 페이지 모드가 그 역할을 한다).
  if (wrongNote) {
    if (!user) return json({ error: "로그인 후 이용할 수 있어요." }, 401);
    const result = await resolveWrongNoteExplanations(admin, {
      userId: user.userId,
      paperId,
      questionNumbers,
      premium: await isPremiumUserFor(admin, user),
    });
    return json({
      questions: result.questions,
      totalCount: result.totalCount,
      hiddenCount: result.totalCount - result.questions.length,
      hasFullAccess: !result.locked,
      loggedIn: true,
      // 이 모드는 시간당 한도·무료 일일 몫을 판정하지 않는다(쿼터 미차감) — 잠금은
      // explanationLocked 로만 알린다.
      lockReason: null,
      remainingToday: null,
      explanationLocked: result.locked,
      lockedQuestionNumbers: result.lockedQuestionNumbers,
    });
  }

  // 로그인 사용자만 한도 판정 대상이다 — 비로그인은 어차피 미리보기만 보이므로
  // 별도로 셀 필요가 없다. 순서(시간당 한도 → 무료 몫)는 규칙 쪽이 지킨다.
  const access: ExplanationAccess | null = user
    ? await resolveExplanationAccess(admin, {
        userId: user.userId,
        paperId,
        action: "view",
        premium: await isPremiumUserFor(admin, user),
      })
    : null;
  const lockReason = access?.reason ?? null;
  const hasFullAccess = loggedIn && access !== null && access.full;

  // 정답.
  const { data: paperAnswers } = await admin
    .from("paper_answers")
    .select("answers")
    .eq("paper_id", paperId)
    .maybeSingle();
  const correctAnswers = ((paperAnswers as { answers: number[] | null } | null)?.answers ??
    []) as number[];

  // 문항 이미지·선지 수·문항 id(웹 fetchQuestionMedia 와 같은 함수).
  const media: Map<number, QuestionMediaEntry> =
    (await fetchQuestionMedia(admin, [paperId])).get(paperId) ?? new Map();
  const questionIds = [...media.values()].map((m) => m.questionId);

  // 해설(question_id → 문항). 같은 문항에 여러 번 생성됐으면 최신(created_at 오름차순
  // 마지막)으로 덮어쓴다.
  const explanationByQuestionId = new Map<string, QuestionExplanationContent>();
  if (questionIds.length > 0) {
    const { data: expRows } = await admin
      .from("question_explanations")
      .select(`question_id, created_at, ${EXPLANATION_CONTENT_COLUMNS}`)
      .in("question_id", questionIds)
      .order("created_at", { ascending: true });
    for (const row of (expRows ?? []) as (ExplanationRow & { question_id: string })[]) {
      const content = toExplanationContent(row);
      if (content) explanationByQuestionId.set(row.question_id, content);
    }
  }

  type QuestionOut = {
    questionNumber: number;
    correctChoice: number | null;
    choiceCount: number;
    images: string[];
    explanation: QuestionExplanationContent;
  };
  const questions: QuestionOut[] = [];
  for (const [questionNumber, m] of media) {
    const explanation = explanationByQuestionId.get(m.questionId);
    if (!explanation) continue; // 해설 없는 문항은 뺀다(웹과 동일).
    questions.push({
      questionNumber,
      correctChoice: correctAnswers[questionNumber - 1] ?? null,
      choiceCount: m.choiceCount ?? 4,
      images: m.images,
      explanation,
    });
  }
  questions.sort((a, b) => a.questionNumber - b.questionNumber);

  const totalCount = questions.length;
  const visible = hasFullAccess ? questions : questions.slice(0, ANON_PREVIEW_CARDS);
  const hiddenCount = totalCount - visible.length;

  return json({
    questions: visible,
    totalCount,
    hiddenCount,
    hasFullAccess,
    loggedIn,
    // null | "rate-limit" | "free-quota" — 앱이 안내 문구를 고르는 데 쓴다.
    lockReason,
    // 무료 회원의 오늘 남은 무료 해설 문제지 수(이번 요청 반영). 유료·관리자·비로그인은 null.
    remainingToday: access?.remainingToday ?? null,
  });
});
