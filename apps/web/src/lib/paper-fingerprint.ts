import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { PAPER_CACHE_LIFE } from "@/lib/cache-profiles";

/**
 * "문제지 집합이 그동안 바뀌었나"를 두 숫자로 요약한 것.
 *
 * 행 수만 보면 같은 수만큼 지우고 넣은 경우를 놓치고, 최신 업로드 시각만 보면
 * 옛 문제지를 지운 경우를 놓친다. 둘을 같이 보면 CLI 스크립트가 낼 수 있는 변화
 * (insert / delete)는 모두 잡힌다. 내용만 바뀌는 UPDATE 는 잡지 못하지만,
 * `exam_papers` 행은 업로드 후 고치지 않는 것이 금지선이고(AGENTS.md) 화면에서
 * 고치는 경로는 서버 액션이 직접 태그를 만료시킨다.
 */
export type PaperFingerprint = {
  /** `exam_papers` 전체 행 수. 중복 통합 전 원본 기준이다. */
  count: number;
  /** 가장 최근 업로드의 `created_at`. 행이 없으면 null. */
  latest: string | null;
};

/** 캐시를 거치지 않고 지금 이 순간의 DB 를 읽는다. */
export async function fetchPaperFingerprint(): Promise<PaperFingerprint> {
  const supabase = createPublicClient();
  const [{ count }, { data }] = await Promise.all([
    supabase.from("exam_papers").select("id", { count: "exact", head: true }),
    supabase
      .from("exam_papers")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    count: count ?? 0,
    latest: (data?.created_at as string | undefined) ?? null,
  };
}

/**
 * 같은 지문을 문제지 캐시들과 **같은 수명·같은 태그**로 캐싱한 것. 이 값이 곧
 * "지금 캐시에 담긴 문제지 집합이 어느 시점 것인가"다 — 수명과 태그가 같으니
 * 캐시가 낡았으면 이 지문도 똑같이 낡아 있다.
 */
export async function getCachedPaperFingerprint(): Promise<PaperFingerprint> {
  "use cache";
  cacheLife(PAPER_CACHE_LIFE);
  cacheTag("home-data");

  return fetchPaperFingerprint();
}

/**
 * 실시간 지문과 캐시된 지문이 어긋나는가 = 캐시를 만료시켜야 하는가.
 *
 * 한쪽이라도 읽기에 실패하면(예: count 가 null 로 와서 0) 굳이 만료시키지 않는다 —
 * 조회 실패로 매일 4,400장을 재생성하는 쪽이 하루 늦게 반영되는 것보다 나쁘다.
 * 그래서 "실시간 행 수가 0"은 비교 대상에서 뺀다(문제지가 정말 0장인 배포는
 * 워밍할 것도 없다).
 */
export function paperFingerprintsDiffer(
  live: PaperFingerprint,
  cached: PaperFingerprint,
): boolean {
  if (live.count === 0) return false;
  return live.count !== cached.count || live.latest !== cached.latest;
}
