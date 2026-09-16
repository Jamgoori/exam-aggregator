import { buildExamIndex, decodePapers, type ExamCombo } from "@gongmoa/core";
import { useMemo } from "react";
import { useCatalog } from "./catalog";
import { collectComboPapers, type ExamComboPaper } from "../lib/exam-index";

// 시험 허브(`/exams`, `/exams/[exam]?year=`) 조회 — 웹 lib/exam-index.ts getExamIndex·
// getExamCombo·getExamAllPapers 대응.
//
// **새 네트워크 왕복이 없다.** 웹은 `'use cache'` 로 문제지 전체를 다시 읽지만 앱은 이미
// 카탈로그 쿼리(['catalog','home-data',mode], 디스크 퍼시스트 7일)가 같은 공개 데이터를
// 들고 있다(설계서 §6.3 카탈로그 등급). 집계는 core buildExamIndex, 문제지 수집·정렬은
// lib/exam-index.ts 의 순수 함수다.
//
// 중복 통합 모드(로그인=signals / 비로그인=meta)가 다르면 건수가 달라질 수 있는데, 그건
// 카탈로그 쿼리 키가 이미 갈라 두었다 — 여기서 다시 신경 쓸 것이 없다.

export function useExamCombos() {
  const query = useCatalog();
  const combos = useMemo<ExamCombo[] | undefined>(() => {
    if (!query.data) return undefined;
    return buildExamIndex(decodePapers(query.data), query.data.examTypes);
  }, [query.data]);
  return { query, combos };
}

// slug 로 조합 한 건. 카탈로그가 도착하기 전에는 undefined, 없는 슬러그면 null(→ 404).
export function useExamCombo(slug: string | undefined) {
  const { query, combos } = useExamCombos();
  const combo = useMemo<ExamCombo | null | undefined>(() => {
    if (!combos) return undefined;
    if (!slug) return null;
    return combos.find((c) => c.slug === slug) ?? null;
  }, [combos, slug]);
  return { query, combo };
}

// 한 시험의 문제지 전체(연도 필터는 화면이 건다 — 웹 getExamYearPapers 도 같은 값을 거른다).
export function useExamPapers(slug: string | undefined) {
  const query = useCatalog();
  const papers = useMemo<ExamComboPaper[] | undefined>(() => {
    if (!query.data || !slug) return undefined;
    return collectComboPapers(decodePapers(query.data), query.data.cbtMask, slug);
  }, [query.data, slug]);
  return { query, papers };
}
