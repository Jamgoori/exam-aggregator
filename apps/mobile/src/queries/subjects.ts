import { fetchSubjectFilters, fetchSubjectPapers, type ExamPaper, type ExamTypeOption } from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { dedupModeFor, signalsProviderFor } from "./catalog";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 과목 페이지(/subjects/[slug]) 조회 — 웹 app/subjects/[slug]/page.tsx 의 조회부. 과목 한 건과
// 과목 인덱스는 카탈로그에서 파생한다(queries/catalog.ts useSubjectBySlug·useSubjectIndex).
export { useSubjectBySlug, useSubjectIndex } from "./catalog";

// 이 과목에 실제 존재하는 급수·직렬(탭 후보).
export function useSubjectFilters(subjectId: string | null) {
  return useQuery<{ levels: string[]; examTypes: ExamTypeOption[]; hasAnyPaper: boolean }>({
    queryKey: ["catalog", "subject-filters", subjectId ?? ""],
    queryFn: () => fetchSubjectFilters(supabase, subjectId!),
    enabled: !!subjectId,
    staleTime: STALE.catalog,
  });
}

// 과목(+필터)의 문제지 전체 — 중복 통합 후. 페이지는 화면이 자른다.
export function useSubjectPapers(subjectId: string | null, level: string | undefined, examTypeIds: string[]) {
  const { userId } = useAuth();
  const examTypesKey = useMemo(() => [...examTypeIds].sort().join(","), [examTypeIds]);
  return useQuery<ExamPaper[]>({
    queryKey: ["catalog", "subject-papers", subjectId ?? "", level ?? "", examTypesKey, dedupModeFor(userId)],
    queryFn: () => fetchSubjectPapers(supabase, subjectId!, { level, examTypeIds }, signalsProviderFor(userId)),
    enabled: !!subjectId,
    staleTime: STALE.catalog,
  });
}
