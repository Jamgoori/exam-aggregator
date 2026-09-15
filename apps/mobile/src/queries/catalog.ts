import {
  buildSubjectIndex,
  decodePapers,
  fetchCatalog,
  fetchPaperIdentitySignalsRpc,
  fetchQuestionCountSignals,
  type Catalog,
  type LightPaper,
  type SignalsProvider,
  type Subject,
} from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CATALOG_GC_MS, STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 카탈로그(문제지 전체 목록 PaperWire + cbtMask + 과목 + 슬러그 맵) — 웹 getCachedHomeData
// 와 같은 공개 데이터를 통째로 받아 클라이언트에서 거른다(설계서 §6.2 카탈로그 행, §6.3
// 카탈로그 등급: staleTime 5분·디스크 퍼시스트·gcTime 7일).
//
// **중복 통합(dedup)은 로그인 여부에 따라 신호가 다르다**(core dedup-papers.ts 머리말):
//   - 로그인: RPC paper_identity_signals(authenticated 전용) — 문항 수 + 정답 클러스터 번호로
//     웹 fetchPaperIdentitySignals 와 같은 판정(정답이 다르게 등록된 문제지는 분리).
//   - 비로그인: questions 공개 읽기로 문항 수만 — 메타데이터가 같으면 합친다(정답 대조 없음).
//     그래서 정답이 서로 다른 같은 메타의 문제지가 비로그인에게는 한 카드로 보일 수 있다.
// 결과가 달라질 수 있으므로 쿼리 키에 모드를 넣어 두 캐시가 섞이지 않게 한다.
export type DedupMode = "signals" | "meta";

export function dedupModeFor(userId: string | null): DedupMode {
  return userId ? "signals" : "meta";
}

export function signalsProviderFor(userId: string | null): SignalsProvider {
  return userId ? fetchPaperIdentitySignalsRpc : fetchQuestionCountSignals;
}

export const catalogKey = (mode: DedupMode) => ["catalog", "home-data", mode] as const;

export function useCatalog() {
  const { userId } = useAuth();
  const mode = dedupModeFor(userId);
  return useQuery<Catalog>({
    queryKey: catalogKey(mode),
    queryFn: () => fetchCatalog(supabase, signalsProviderFor(userId)),
    staleTime: STALE.catalog,
    gcTime: CATALOG_GC_MS,
  });
}

// 압축 표현 → 화면용 목록. 과목·시행처 객체는 문제지끼리 공유하므로 배열 한 번 순회 비용.
export function useDecodedPapers(catalog: Catalog | undefined): LightPaper[] {
  return useMemo(() => (catalog ? decodePapers(catalog) : []), [catalog]);
}

// 과목 인덱스(/subjects) — 카탈로그에서 파생(웹 getSubjectIndex 와 같은 집계).
export function useSubjectIndex() {
  const query = useCatalog();
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const papers = decodePapers(query.data);
    return buildSubjectIndex(query.data.subjects, papers);
  }, [query.data]);
  return { query, data };
}

// slug 로 과목 한 건 — 카탈로그 안의 subjects 에서 찾는다(별도 왕복 없음).
export function useSubjectBySlug(slug: string | undefined) {
  const query = useCatalog();
  const subject = useMemo<Subject | null | undefined>(() => {
    if (!query.data) return undefined;
    if (!slug) return null;
    return query.data.subjects.find((s) => s.slug === slug) ?? null;
  }, [query.data, slug]);
  return { query, subject };
}
