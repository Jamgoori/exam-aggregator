import { isChoseongQuery, matchesChoseong } from "./hangul";
import type { Subject } from "./types";

// 검색어 파싱/과목 매칭 — 웹·모바일 공유(순수 함수). 웹 src/lib/paper-search.ts 가
// 정본이고, 모바일 src/lib/search.ts 가 "웹 규칙 그대로 포팅"이라 중복이었다.

// 검색어와 매치되는 과목 id 목록을 계산한다. 서버(page.tsx)와 클라이언트
// (home-exam-browser.tsx) 양쪽에서 똑같은 로직을 써야 첫 렌더(SSR)와 이후
// 클라이언트 필터링 결과가 어긋나지 않는다.
export function matchSubjectIds(subjects: Subject[], rawQuery: string): string[] {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery) return [];

  if (isChoseongQuery(trimmedQuery)) {
    return subjects
      .filter((s) => matchesChoseong(s.name, trimmedQuery))
      .map((s) => s.id);
  }

  const lowerQuery = trimmedQuery.toLowerCase();
  // 단어 중간에 우연히 검색어가 들어가는 과목까지 그냥 다 보여주면("국어" 검색 시
  // "중국어"까지 나오는 식) 헷갈리니, 이름이 검색어로 시작하는 과목이 하나라도
  // 있으면 그것만 보여준다. 그런 과목이 하나도 없을 때만("법"으로 형법·민법을
  // 찾는 경우처럼 검색어가 단어 뒷부분에 있는 경우) 단어 중간 포함까지 넓힌다.
  const prefixMatches = subjects.filter((s) =>
    s.name.toLowerCase().startsWith(lowerQuery),
  );
  return (
    prefixMatches.length > 0
      ? prefixMatches
      : subjects.filter((s) => s.name.toLowerCase().includes(lowerQuery))
  ).map((s) => s.id);
}

const YEAR_TOKEN_RE = /^(19|20)\d{2}$/;

// 검색어에 "7급 컴퓨터일반" / "컴퓨터일반 7급" / "7급컴퓨터일반"처럼 급수·연도·
// 시행처가 섞여 있으면 위치·순서와 무관하게 뽑아내고, 나머지를 과목명 검색어로
// 돌려준다. 급수는 붙여 써도("7급컴퓨터일반") 인식하도록 문자열 어디서나
// \d+급 패턴을 찾지만, 연도·시행처는 "경찰학"처럼 시행처 이름을 포함하는 과목명과
// 헷갈리지 않도록 공백으로 구분된 토큰이 정확히 일치할 때만 뽑아낸다.
export function parseSearchQuery(
  rawQuery: string,
  examTypeNames: string[] = [],
): {
  level?: string;
  year?: number;
  examType?: string;
  subjectQuery: string;
} {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { subjectQuery: "" };

  const levelMatch = trimmed.match(/\d+급/);
  const afterLevel =
    levelMatch && levelMatch.index !== undefined
      ? (
          trimmed.slice(0, levelMatch.index) +
          trimmed.slice(levelMatch.index + levelMatch[0].length)
        )
          .replace(/\s+/g, " ")
          .trim()
      : trimmed;

  const examTypeSet = new Set(examTypeNames);
  let year: number | undefined;
  let examType: string | undefined;
  const rest: string[] = [];
  for (const token of afterLevel.split(/\s+/).filter(Boolean)) {
    if (year === undefined && YEAR_TOKEN_RE.test(token)) {
      year = Number(token);
    } else if (examType === undefined && examTypeSet.has(token)) {
      examType = token;
    } else {
      rest.push(token);
    }
  }

  return {
    level: levelMatch?.[0],
    year,
    examType,
    subjectQuery: rest.join(" "),
  };
}
