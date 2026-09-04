import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { isFreeForAll } from "@gongmoa/core";
import { getExamIndex } from "@/lib/exam-index";
import { getHomeStats } from "@/lib/home-stats";
import { getSubjectIndex } from "@/lib/subject-index";

// 홈(랜딩)이 정적 셸에 그대로 구울 수 있는 값들.
//
// 홈은 로그인 여부와 무관한 소개 페이지라 본문 전체가 정적 셸에 들어가야 한다(첫
// 페인트가 즉시고, 크롤러가 받는 HTML 에 본문·제목·정본이 다 실린다). 그래서 여기서는
// 요청 데이터(cookies)를 읽지 않고, 전부 'use cache' 로 묶어 빌드·재검증 시점에 계산한다.
//
// isFreeForAll() 도 여기 안에서 부른다 — Cache Components 에서는 서버 컴포넌트가
// 요청 데이터를 읽기 전에 new Date() 를 만지면 정적 셸이 깨지는데, 'use cache' 안에서는
// 그 값이 캐시 수명 동안 고정된 값으로 취급돼 안전하다. 이벤트 종료일(FREE_UNTIL) 을
// 넘긴 뒤 최대 한 시간 안에 화면이 저절로 바뀐다.
export async function getLandingData() {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const [{ combos, totalCount }, stats, { entries: subjectEntries }] =
    await Promise.all([getExamIndex(), getHomeStats(), getSubjectIndex()]);
  // 시험별 최신 연도 중 가장 큰 값 = 사이트에 올라온 가장 최근 시험 연도.
  const latestYear = combos.reduce<number | null>(
    (max, c) => (c.years[0] != null && (max == null || c.years[0] > max) ? c.years[0] : max),
    null,
  );
  return {
    combos,
    totalCount,
    // 홈 검색창의 과목 추천에 쓸 목록. 이름·주소만 있으면 되고, 자료가 없는 과목은
    // 애초에 인덱스에 없다(빈 과목을 추천하면 헛걸음이 된다).
    subjects: subjectEntries.map(({ slug, name }) => ({ slug, name })),
    latestYear,
    totalDownloads: stats.totalDownloads ?? 0,
    totalAttempts: stats.totalAttempts ?? 0,
    freeForAll: isFreeForAll(),
  };
}
