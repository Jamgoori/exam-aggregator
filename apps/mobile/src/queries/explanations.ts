import type { ExplanationsGetResponse, QuestionExplanationContent } from "@gongmoa/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { callEdge } from "../lib/edge";
import { useAuth } from "../providers/auth-provider";

// 해설 페이지(EF explanations-get **페이지 모드**) — 설계서 §6.3 해설 등급.
//
// 서버가 로그인 사용자의 **호출마다** explanation_access_log 에 view 를 insert 하고 40/h 를
// 넘기면 rate-limit 미리보기만 준다. 기본 정책(staleTime 0 + 포커스 재조회 + retry 3)이면
// 화면을 열어 둔 채 앱을 오가는 것만으로 정상 사용자가 잠금을 만난다. 그래서 화면 마운트 중
// 절대 다시 부르지 않고(staleTime Infinity, 포커스·재접속 재조회 off, retry 없음), 언마운트
// 시 즉시 폐기(gcTime 0)해 다음 진입 = 호출 1회 = 로그 1행 = 웹의 "페이지 진입 1회"가 된다.
// 해설 본문은 디스크에 남기지 않는다(meta.persist:false — AGENTS.md 금지선). 어떤 뮤테이션도
// 이 키를 무효화하지 않는다.
export function usePaperExplanations(paperId: string | null) {
  const { userId } = useAuth();
  return useQuery<ExplanationsGetResponse>({
    queryKey: ["edge", "explanations-get", paperId ?? "", userId ?? "anon"],
    queryFn: () => callEdge("explanations-get", { paperId: paperId! }),
    enabled: !!paperId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
    gcTime: 0,
    meta: { persist: false },
  });
}

// ── 오답노트 안의 해설(EF explanations-get `context:"wrong-note"`) ─────────────
//
// 오답노트·응시 상세·mix 기록 **안에서** 여는 해설(설계서 §6.2 "해설(오답노트·응시 상세·mix
// 기록 안)" 행, §6.7 #7). 페이지 모드와 규칙이 다르다: 서버가 explanation_access_log·
// explanation_daily_views 를 한 줄도 쓰지 않으므로(= 쿼터 미차감) 시간당 한도를 아끼려고
// 재조회를 막을 이유가 없다 — §6.3 해설 행의 마지막 문장("context:\"wrong-note\" 모드는 서버가
// 로그를 쓰지 않으므로 기본 정책 적용 가능").
//
// 다만 **본문은 디스크에 남기지 않는다**(meta.persist:false + gcTime 0 — §6.5 (2), AGENTS.md
// "정답·해설·멤버십을 디스크에 남기지 말 것"). 응답에는 정답(correctChoice)도 실린다.
//
// 프리미엄이 아니면 서버가 본문을 아예 보내지 않고(questions 빈 배열) 잠금 자리를 그릴
// 문항 번호만 lockedQuestionNumbers 로 준다 — 화면은 그 번호에 ExplanationLock 을 그린다.

// 한 요청에 담을 수 있는 문항 수(core WRONG_NOTE_QUESTION_LIMIT — 규칙 모듈은 server 전용이라
// 값만 옮겨 적는다. 넘치면 서버가 앞에서 잘라내므로 화면도 같은 기준으로 자른다).
export const WRONG_NOTE_EXPLANATION_LIMIT = 100;

export type WrongNoteExplanationMap = {
  // 문항 번호 → 해설 본문(프리미엄일 때만 채워진다).
  byNumber: Map<number, QuestionExplanationContent>;
  // 해설은 있지만 본문을 받지 못한 문항(무료 회원의 잠금 자리).
  locked: Set<number>;
};

const EMPTY_EXPLANATIONS: WrongNoteExplanationMap = { byNumber: new Map(), locked: new Set() };

function toMap(res: ExplanationsGetResponse): WrongNoteExplanationMap {
  return {
    byNumber: new Map(res.questions.map((q) => [q.questionNumber, q.explanation])),
    locked: new Set(res.lockedQuestionNumbers ?? []),
  };
}

// 호출마다 같은 문항 목록이면 같은 키가 되도록 정렬·중복 제거 후 잘라낸다.
function normalizeNumbers(questionNumbers: readonly number[]): number[] {
  return [...new Set(questionNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 300))]
    .sort((a, b) => a - b)
    .slice(0, WRONG_NOTE_EXPLANATION_LIMIT);
}

// 키에 문항 번호를 넣지 않는다. 과목 오답노트는 필터·정렬·삭제가 목록을 계속 바꾸는데,
// 번호를 키에 넣으면 그때마다 새 키가 되어(캐시는 gcTime 0 이라 바로 버려진다) 화면에 있는
// 문제지 수만큼 EF 를 다시 부른다. 그래서 키는 (문제지, 사용자)로만 잡고, 요청 본문에는
// **그 문제지의 문항 번호 전체**(지금 필터를 통과한 것뿐 아니라)를 보낸다 — 화면에서 무엇을
// 걸러도 요청이 같아진다. 개수는 아래 WRONG_NOTE_EXPLANATION_LIMIT 로 자른다(서버와 같은 한도).
const wrongNoteKey = (userId: string | null, paperId: string) =>
  ["edge", "explanations-get", "wrong-note", paperId, userId ?? "anon"] as const;

function wrongNoteOptions(userId: string | null, paperId: string, numbers: number[], enabled = true) {
  return {
    queryKey: wrongNoteKey(userId, paperId),
    queryFn: async (): Promise<WrongNoteExplanationMap> =>
      toMap(await callEdge("explanations-get", { paperId, context: "wrong-note" as const, questionNumbers: numbers })),
    enabled: enabled && !!userId && !!paperId && numbers.length > 0,
    // 해설 본문은 세션 중에 바뀌지 않는 정적 내용이라 마운트 중에는 다시 묻지 않는다.
    // (쿼터는 차감되지 않으니 재조회가 "잠금"을 부르지는 않지만, 과목 모아보기는 문제지마다
    // 요청이 하나라 포커스 복귀마다 수십 번 부르게 된다 — 화면 진입 1회로 묶는다.)
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    // 400·404 는 다시 물어도 같은 답(없는 문제지·해설 없음) — 네트워크 실패만 한 번 더.
    retry: 1,
    // 언마운트 즉시 폐기(§6.5 해설 본문은 메모리에도 화면을 벗어나면 남기지 않는다).
    gcTime: 0,
    meta: { persist: false },
  };
}

// 문제지 한 장(문제지 오답노트·응시 상세·mix 기록).
export function useWrongNoteExplanations(paperId: string | null, questionNumbers: readonly number[]) {
  const { userId } = useAuth();
  const numbers = useMemo(() => normalizeNumbers(questionNumbers), [questionNumbers]);
  const query = useQuery(wrongNoteOptions(userId, paperId ?? "", numbers));
  return { query, data: query.data ?? EMPTY_EXPLANATIONS };
}

// 한 번에 열어 두는 문제지 요청 수. EF explanations-get 은 **문제지 하나가 요청 하나**라,
// 응시가 쌓인 과목의 "문제만 모아보기"를 열면 문제지 수(20~30장)만큼의 호출이 한꺼번에 나간다.
// §6.2 가 이미지 프리페치에 정한 "화면에 보이는 그룹만 · 동시 4"와 같은 생각으로, 목록 위에서부터
// 이만큼씩만 열고 앞 묶음이 끝나면 다음 묶음을 연다(첫 화면에 보이는 카드가 먼저 채워진다).
//
// 목록이 평범한 ScrollView 라 FlatList 의 onViewableItemsChanged 를 쓸 수 없고, 웹의
// ExplanationDisclosure 를 흉내내 "펼칠 때 부르기"로 바꿀 수도 없다 — 웹은 서버 렌더가 해설을
// 이미 붙여 내려주므로 그 토글은 **그리기**만 미루지만, 앱은 받아 보기 전에는 그 문항에 해설이
// 있는지조차 모른다(있을 때만 토글을 그린다). 그래서 "보이는 것부터, 조금씩"으로 구현한다.
export const EXPLANATION_PAPER_BATCH = 4;

// 여러 문제지(과목 오답노트 "문제만 모아보기" — 카드마다 출처 문제지가 다르다). 목록 순서
// (= 화면에 그려지는 순서)대로 넘길 것.
export function useWrongNoteExplanationsByPaper(
  requests: readonly { paperId: string; questionNumbers: number[] }[],
) {
  const { userId } = useAuth();
  const normalized = useMemo(
    () => requests.map((r) => ({ paperId: r.paperId, numbers: normalizeNumbers(r.questionNumbers) })),
    [requests],
  );
  // 몇 개까지 열어 둘지는 **상태 없이** 캐시에서 읽어 센다. 끝난 요청 + BATCH 가 창이고,
  // 아래 useQueries 가 그 쿼리들을 구독하고 있어 하나가 끝날 때마다 이 컴포넌트가 다시 그려져
  // 창이 저절로 넓어진다(useState+useEffect 로 밀어 올리면 렌더가 한 번 더 도는 것 말고는
  // 같은 결과라, 읽기만 하는 쪽을 고른다).
  const queryClient = useQueryClient();
  const settledCount = normalized.reduce((n, r) => {
    const status = queryClient.getQueryState(wrongNoteKey(userId, r.paperId))?.status;
    return status === "success" || status === "error" ? n + 1 : n;
  }, 0);
  const open = settledCount + EXPLANATION_PAPER_BATCH;
  const results = useQueries({
    queries: normalized.map((r, i) => wrongNoteOptions(userId, r.paperId, r.numbers, i < open)),
  });

  // results 는 매 렌더 새 배열이라 의존성으로 쓸 수 없다 — 문제지와 마지막 갱신 시각의
  // 서명으로 메모한다(데이터가 실제로 바뀔 때만 새 Map).
  const signature = results.map((r, i) => `${normalized[i].paperId}:${r.dataUpdatedAt}`).join("|");
  return useMemo(() => {
    const byPaper = new Map<string, WrongNoteExplanationMap>();
    normalized.forEach((r, i) => {
      const data = results[i]?.data;
      if (data) byPaper.set(r.paperId, data);
    });
    return byPaper;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
