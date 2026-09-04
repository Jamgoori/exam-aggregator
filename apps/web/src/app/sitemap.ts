import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { fetchAllPages } from "@/lib/fetch-paged";
import { getExamIndex, examHref } from "@/lib/exam-index";
import { paperHref } from "@/lib/paper-href";
import { absoluteUrl } from "@/lib/site-url";

// 기출문제 목록(/papers)은 클라이언트 검색 UI라 문제지 3천여 장으로 가는 <a> 링크가
// HTML에 거의 없다. 즉 사이트맵이 사실상 유일한 색인 경로다 — 여기서 빠진 문제지는
// 검색에 안 뜬다. (홈은 소개 랜딩이라 시험별·과목별 허브로 가는 링크만 있다.)
//
// 중복 시험지(직류만 다른 같은 시험지)는 fetchAllExamPapers가 이미 대표 한 장으로
// 합쳐서 돌려준다. 합치기 전 목록을 그대로 실으면 같은 내용의 URL이 여러 개 올라가
// 중복 콘텐츠로 서로의 순위를 갉아먹는다.
//
// 해설 페이지(/papers/*/explanations)는 넣지 않는다 — 비로그인(=크롤러)에게는 앞
// 두 문항만 렌더링되는 미리보기라, 색인돼봐야 빈약한 페이지로 평가된다.
async function getSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  "use cache";
  // 사이트맵은 크롤러만 읽으므로 자주 다시 만들 이유가 없다. 새 업로드 즉시 반영은
  // 홈 데이터와 같은 태그를 달아 revalidateTag("home-data")에 묻어가게 한다.
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();

  const [{ papers }, { data: subjectRows }, { combos }, uploadedAtRows] =
    await Promise.all([
    fetchAllExamPapers(supabase),
    supabase.from("subjects").select("slug").order("name"),
    getExamIndex(),
    // 문제지는 업로드 후 내용이 바뀌지 않으므로 created_at이 곧 lastModified다.
    // 목록 조회(fetchAllExamPapers)는 전송량을 줄이려 이 컬럼을 빼고 받으므로
    // 여기서만 따로 받아 id로 붙인다.
    fetchAllPages<{ id: string; created_at: string }>(
      (from, to) =>
        supabase
          .from("exam_papers")
          .select("id, created_at")
          .order("id", { ascending: true })
          .range(from, to) as unknown as Promise<{
          data: { id: string; created_at: string }[] | null;
          error: { message: string } | null;
        }>,
      "사이트맵 업로드 시각",
    ),
  ]);

  const uploadedAt = new Map(uploadedAtRows.map((r) => [r.id, r.created_at]));
  const newest = uploadedAtRows.reduce<string | undefined>(
    (max, r) => (!max || r.created_at > max ? r.created_at : max),
    undefined,
  );

  return [
    {
      url: absoluteUrl("/"),
      lastModified: newest,
      changeFrequency: "daily",
      priority: 1,
    },
    // 기출문제 검색·목록(app/papers/page.tsx). 원래 홈이 이 화면이었고 "공무원
    // 기출문제" 류 검색어의 착지 지점이라 홈 바로 다음 우선순위로 둔다.
    {
      url: absoluteUrl("/papers"),
      lastModified: newest,
      changeFrequency: "daily",
      priority: 0.95,
    },
    // 요금제 안내(app/membership/page.tsx). 로그인 없이 서버 렌더되는 정적 문서라
    // 색인해도 문제가 없고, "공모아 요금제/가격"으로 찾는 사람의 착지 지점이다.
    {
      url: absoluteUrl("/membership"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    // 공지사항 목록(app/notices/page.tsx). suggestions와 달리 완전히 공개된
    // 게시판이라 색인을 막을 이유가 없다(robots.ts에도 별도 disallow가 없다).
    {
      url: absoluteUrl("/notices"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // 자유게시판 목록(app/board/page.tsx). 공지사항과 같은 이유로 공개다. 개별
    // 글까지 사이트맵에 싣지는 않는다 — 사람이 쓴 글은 수·품질이 들쭉날쭉해서
    // 목록 한 장을 크롤러의 입구로 두고 거기서 따라가게 하는 편이 낫다(목록은
    // 최신순이라 새 글이 언제나 첫 페이지에 있다).
    {
      url: absoluteUrl("/board"),
      changeFrequency: "daily",
      priority: 0.6,
    },
    // 과목 목록 허브(app/subjects/page.tsx). 개별 과목 페이지로 가는 링크를 전부
    // 담고 있어서, 크롤러가 여기 한 장만 읽어도 과목 수백 장을 발견한다.
    {
      url: absoluteUrl("/subjects"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...((subjectRows ?? []) as { slug: string }[]).map((s) => ({
      url: absoluteUrl(`/subjects/${s.slug}`),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    // 시험(시행처+급수)축 허브와 그 아래 시험 페이지. "국가직 9급 기출문제"처럼
    // 의도가 뚜렷한 검색어의 착지 지점이라 문제지 상세보다 위에 둔다. 연도는
    // 별도 주소가 아니라 시험 페이지의 ?year= 필터라 여기 실을 것이 없다.
    {
      url: absoluteUrl("/exams"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...combos.map((c) => ({
      url: absoluteUrl(examHref(c.slug)),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...papers.map((p) => ({
      url: absoluteUrl(paperHref(p)),
      lastModified: uploadedAt.get(p.id),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return getSitemapEntries();
}
