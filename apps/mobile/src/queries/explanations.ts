import type { ExplanationsGetResponse } from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
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
