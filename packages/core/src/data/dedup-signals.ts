import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperIdentitySignal } from "../dedup-papers";

// 겹칠 수 있는 문제지들의 내용 신호(문항 수 + 정답 지문)를 모은다. 정답 "내용"은
// 클라이언트로 나가지 않고, 서버에서 두 문제지가 같은지 비교하는 데만 쓴다.
// 합치는 계산(키·그룹핑·대표 선정)은 ../dedup-papers.ts 의 순수 함수가 한다.
//
// client   — questions 를 읽는다(공개 읽기라 사용자 세션·anon 으로 충분).
// answers  — paper_answers 를 읽을 수 있는 클라이언트(service_role). RLS 로 일반 사용자
//            SELECT 가 막혀 있어 서버에서만 읽을 수 있다(docs/agents/dedup-papers.md).
//            null 이면(service_role 키가 없는 환경) 정답 대조를 조용히 건너뛰고 문항
//            수만 쓴다.
export async function fetchPaperIdentitySignals(
  client: SupabaseClient,
  paperIds: string[],
  answers: SupabaseClient | null = null,
): Promise<Map<string, PaperIdentitySignal>> {
  const signals = new Map<string, PaperIdentitySignal>();
  if (paperIds.length === 0) return signals;
  for (const id of paperIds) {
    signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  }

  // 문항 수(공개 읽기)와 정답 지문(service_role 전용)은 서로 의존이 없으므로
  // 동시에 조회한다 — 이 함수는 목록 조회 뒤에 이어지는 직렬 구간이라 왕복을
  // 하나라도 줄이는 게 체감 속도에 그대로 반영된다.
  const questionRowsPromise = client
    .from("questions")
    .select("paper_id")
    .in("paper_id", paperIds);
  // (여기서 null을 돌려줘야 아래 await 전에 거절된 프로미스가 생기지 않는다.)
  const answerRowsPromise = (async () => {
    if (!answers) return null;
    try {
      return await answers
        .from("paper_answers")
        .select("paper_id, answers, voided_questions")
        .in("paper_id", paperIds);
    } catch {
      return null;
    }
  })();

  const { data: questionRows } = await questionRowsPromise;
  for (const row of questionRows ?? []) {
    const s = signals.get((row as { paper_id: string }).paper_id);
    if (s) s.questionCount += 1;
  }

  const answerResult = await answerRowsPromise;
  if (answerResult && !answerResult.error) {
    for (const row of answerResult.data ?? []) {
      const r = row as {
        paper_id: string;
        answers: number[] | null;
        voided_questions: number[] | null;
      };
      const s = signals.get(r.paper_id);
      if (!s) continue;
      const answersArr = r.answers ?? [];
      s.answerSignature = JSON.stringify([answersArr, r.voided_questions ?? []]);
      s.answerLength = answersArr.length;
    }
  }

  return signals;
}
