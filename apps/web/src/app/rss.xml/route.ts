import { cacheLife, cacheTag } from "next/cache";
import {
  collapseDuplicatePapers,
  getPaperDisplayTitle,
  type DedupablePaper,
} from "@gongmoa/core";
import { createPublicClient } from "@/lib/supabase/public";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site-url";

// 네이버 서치어드바이저는 사이트맵과 별개로 RSS 를 받아 "새로 올라온 것"을 빨리
// 수집한다. 사이트맵은 3천여 장 전체 목록이라 무엇이 새 글인지 알려주지 못하므로,
// 여기서는 최근에 올라온 문제지만 시간순으로 싣는다.
const FEED_SIZE = 50;

// 중복(직류만 다른 같은 시험지)을 합치고 나면 개수가 줄기 때문에, 50개를 채우려면
// 합치기 전에 넉넉히 받아둬야 한다.
const FETCH_SIZE = FEED_SIZE * 4;

type FeedPaper = DedupablePaper & {
  created_at: string;
  subjects: { name: string } | null;
  exam_types: { name: string } | null;
};

// XML 에서 뜻을 갖는 문자들. 문제지 제목은 사람이 입력하는 값이라 & 나 < 가 섞이면
// 피드 전체가 파싱 실패한다(네이버는 "형식이 올바르지 않습니다"로 거절한다).
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildFeed(): Promise<string> {
  "use cache";
  // 새 업로드가 곧바로 피드에 뜨도록 홈 데이터와 같은 태그를 달아
  // revalidateTag("home-data") 에 묻어가게 한다.
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const { data } = await supabase
    .from("exam_papers")
    .select(
      "id, title, level, track, year, round, subject_id, exam_type_id, created_at, subjects(name), exam_types(name)",
    )
    .order("created_at", { ascending: false })
    .limit(FETCH_SIZE);

  // 내용 신호(정답 지문) 없이 메타데이터만으로 합친다 — 피드는 발견용이라
  // 상세페이지만큼 엄밀할 필요가 없고, 여기서 정답 조회까지 하면 왕복만 는다.
  const papers = collapseDuplicatePapers(
    (data ?? []) as unknown as FeedPaper[],
  ).slice(0, FEED_SIZE);

  const items = papers.map((paper) => {
    const title = `${getPaperDisplayTitle(paper.title, paper.track)} 기출문제`;
    const url = absoluteUrl(`/papers/${paper.id}`);
    const description =
      `${paper.exam_types?.name ?? ""} ${paper.level ?? ""} ${paper.year}년 ${paper.subjects?.name ?? ""} 기출문제를 정답과 함께 무료로 열람·다운로드하세요.`
        .replace(/\s+/g, " ")
        .trim();

    return [
      "<item>",
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `<pubDate>${new Date(paper.created_at).toUTCString()}</pubDate>`,
      `<description>${escapeXml(description)}</description>`,
      "</item>",
    ].join("");
  });

  const lastBuildDate = new Date(
    papers[0]?.created_at ?? Date.now(),
  ).toUTCString();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(`${SITE_NAME} - 공무원 기출문제`)}</title>`,
    `<link>${SITE_URL}</link>`,
    `<description>${escapeXml("국가직·지방직 등 공무원 기출문제를 정답·해설과 함께 무료로 제공합니다.")}</description>`,
    "<language>ko</language>",
    `<lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    // 피드 자신의 주소. RSS 검증기와 일부 수집기가 정본 확인에 쓴다.
    `<atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "</channel>",
    "</rss>",
  ].join("");
}

export async function GET() {
  return new Response(await buildFeed(), {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // 사이트맵과 마찬가지로 수집기만 읽는 문서라 CDN 이 한동안 들고 있어도 된다.
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
