import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { fetchAllPages } from "@/lib/fetch-paged";
import { comboSlug, examHref, getExamIndex } from "@/lib/exam-index";
import { paperHref } from "@/lib/paper-href";
import { absoluteUrl } from "@/lib/site-url";

// 사이트맵 데이터. 파일은 둘로 나뉜다 — 허브(홈·목록·과목·시험) 한 장과 시험(시행처
// +급수)별 문제지 파일 열여덟 장, 그리고 그 목록을 담은 인덱스(/sitemap.xml).
//
// 왜 나누나: 한 파일에 4,300 URL 을 담으면 서치콘솔이 "색인 83 / 미색인 5,230"이라는
// 합계만 보여 준다. 시험별로 나누면 사이트맵 보고서에서 어느 시험의 문제지가 색인되고
// 어느 시험이 막혀 있는지가 파일 단위로 보인다.
//
// 기출문제 목록(/papers)은 클라이언트 검색 UI라 문제지로 가는 <a> 링크가 HTML에 거의
// 없고, 시험 허브의 "연도별 전체 목록"이 그 다음 발견 경로다. 여기서 빠진 문제지는
// 검색에 안 뜬다.
//
// 중복 시험지(직류만 다른 같은 시험지)는 fetchAllExamPapers가 이미 대표 한 장으로
// 합쳐서 돌려준다. 합치기 전 목록을 그대로 실으면 같은 내용의 URL이 여러 개 올라가
// 중복 콘텐츠로 서로의 순위를 갉아먹는다.
//
// 해설 페이지(/papers/*/explanations)는 넣지 않는다 — 비로그인(=크롤러)에게는 앞
// 두 문항만 렌더링되는 미리보기라, 색인돼봐야 빈약한 페이지로 평가된다.

export type SitemapChangeFrequency = "daily" | "weekly" | "monthly";

export type SitemapEntry = {
  url: string;
  /** ISO 8601. 없으면 <lastmod> 를 생략한다. */
  lastModified?: string;
  changeFrequency?: SitemapChangeFrequency;
  priority?: number;
};

export type SitemapPaperFile = {
  /** 시험 슬러그("국가직-9급"). 파일 이름 papers-<slug>.xml 의 재료. */
  slug: string;
  label: string;
  entries: SitemapEntry[];
};

export type SitemapData = {
  hubs: SitemapEntry[];
  paperFiles: SitemapPaperFile[];
  /** 전체에서 가장 최근 업로드 시각. 인덱스의 lastmod. */
  newest?: string;
};

// 문제지 lastmod 의 하한. 문제지 내용은 업로드 뒤 바뀌지 않지만, 2026-09-02 에 Googlebot
// 이 받던 빈 <head> 를 고쳤다(커밋 adf411f). 크롤러에게 "이 주소들의 HTML 이 그날
// 바뀌었다"를 알릴 신호가 lastmod 밖에 없어서 한 번 올린다. 그 뒤로 실제 변경이
// 없는데 이 값을 매번 올리면 lastmod 자체를 무시당하므로, 정말 <head> 가 바뀐 날에만
// 고칠 것.
export const PAPER_LASTMOD_FLOOR = "2026-09-02T00:00:00+09:00";

export const HUBS_FILE = "hubs.xml";

export function paperFileName(slug: string): string {
  return `papers-${slug}.xml`;
}

/** 시험별 파일 이름에서 슬러그를 되돌린다. 형식이 아니면 null. */
export function slugFromPaperFileName(file: string): string | null {
  const m = /^papers-(.+)\.xml$/.exec(file);
  return m ? m[1] : null;
}

/**
 * 두 시각 문자열 중 늦은 쪽. **문자열 비교로 하지 말 것** — 여기 들어오는 값은 형식이
 * 섞여 있다(Postgres 원본 `2026-09-01T15:54:52.075486+00:00` 과 상수
 * `2026-09-02T00:00:00+09:00`). 사전순으로 비교하면 `+09:00` 로 적힌 쪽이 날짜 문자만으로
 * 이겨서, 실제로는 더 이른 시각이 "최신"으로 올라간다(실측: 인덱스의 문제지 파일 lastmod 가
 * 최신 업로드 15:54Z 대신 하한 15:00Z 로 나갔다).
 */
export function laterOf(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() > new Date(b).getTime() ? a : b;
}

export async function getSitemapData(): Promise<SitemapData> {
  "use cache";
  // 사이트맵은 크롤러만 읽으므로 자주 다시 만들 이유가 없다. 새 업로드 즉시 반영은
  // 홈 데이터와 같은 태그를 달아 revalidateTag("home-data")에 묻어가게 한다.
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();

  const [{ papers, examTypes }, { data: subjectRows }, { combos }, uploadedAtRows] =
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

  const hubs: SitemapEntry[] = [
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
    { url: absoluteUrl("/membership"), changeFrequency: "monthly", priority: 0.6 },
    // 공지사항 목록(app/notices/page.tsx). suggestions와 달리 완전히 공개된
    // 게시판이라 색인을 막을 이유가 없다(robots.ts에도 별도 disallow가 없다).
    { url: absoluteUrl("/notices"), changeFrequency: "weekly", priority: 0.5 },
    // 자유게시판 목록(app/board/page.tsx). 개별 글까지 사이트맵에 싣지는 않는다 —
    // 목록 한 장을 크롤러의 입구로 두고 거기서 따라가게 한다(목록은 최신순).
    { url: absoluteUrl("/board"), changeFrequency: "daily", priority: 0.6 },
    // 과목 목록 허브(app/subjects/page.tsx). 개별 과목 페이지로 가는 링크를 전부
    // 담고 있어서, 크롤러가 여기 한 장만 읽어도 과목 수백 장을 발견한다.
    {
      url: absoluteUrl("/subjects"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...((subjectRows ?? []) as { slug: string }[]).map<SitemapEntry>((s) => ({
      url: absoluteUrl(`/subjects/${s.slug}`),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.8,
    })),
    // 시험(시행처+급수)축 허브와 그 아래 시험 페이지. "국가직 9급 기출문제"처럼
    // 의도가 뚜렷한 검색어의 착지 지점이라 문제지 상세보다 위에 둔다.
    {
      url: absoluteUrl("/exams"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...combos.map<SitemapEntry>((c) => ({
      url: absoluteUrl(examHref(c.slug)),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.85,
    })),
  ];

  // 문제지를 시험(시행처+급수)별로 나눈다. 시험 인덱스와 같은 규칙(comboSlug)이라
  // 파일 목록이 /exams 의 시험 목록과 1:1 로 맞는다.
  const examTypeNameById = new Map(examTypes.map((t) => [t.id, t.name]));
  const bySlug = new Map<string, SitemapEntry[]>();
  for (const p of papers) {
    const name = examTypeNameById.get(p.exam_type_id);
    const slug = name ? comboSlug(name, p.level) : "기타";
    const list = bySlug.get(slug) ?? [];
    list.push({
      url: absoluteUrl(paperHref(p)),
      lastModified: laterOf(uploadedAt.get(p.id), PAPER_LASTMOD_FLOOR)!,
      changeFrequency: "monthly",
      priority: 0.7,
    });
    bySlug.set(slug, list);
  }

  const paperFiles: SitemapPaperFile[] = combos
    .filter((c) => bySlug.has(c.slug))
    .map((c) => ({ slug: c.slug, label: c.label, entries: bySlug.get(c.slug)! }));
  // 시험 인덱스에 없는 조합(시행처 행이 없는 문제지 등)이 있으면 버리지 않고 한 파일에
  // 모은다 — 사이트맵에서 빠지면 그 문제지는 검색에 안 뜬다.
  for (const [slug, entries] of bySlug) {
    if (!combos.some((c) => c.slug === slug)) {
      paperFiles.push({ slug, label: slug, entries });
    }
  }

  return { hubs, paperFiles, newest };
}

// ── XML 직렬화 ────────────────────────────────────────────────────────────

// XML 에서 뜻을 갖는 문자들. 주소는 encodeURIComponent 를 거쳐 오지만 & 가 섞일 수
// 있는 값(쿼리)을 언젠가 실을 수도 있어 방어적으로 이스케이프한다.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lastmodTag(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `<lastmod>${d.toISOString()}</lastmod>`;
}

export function renderUrlset(entries: SitemapEntry[]): string {
  const items = entries.map((e) =>
    [
      "<url>",
      `<loc>${escapeXml(e.url)}</loc>`,
      lastmodTag(e.lastModified),
      e.changeFrequency ? `<changefreq>${e.changeFrequency}</changefreq>` : "",
      e.priority != null ? `<priority>${e.priority}</priority>` : "",
      "</url>",
    ].join(""),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    "</urlset>",
  ].join("");
}

export function renderSitemapIndex(
  files: { url: string; lastModified?: string }[],
): string {
  const items = files.map((f) =>
    ["<sitemap>", `<loc>${escapeXml(f.url)}</loc>`, lastmodTag(f.lastModified), "</sitemap>"].join(""),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    "</sitemapindex>",
  ].join("");
}

/** 시험별 파일의 절대 주소. 슬러그에 한글이 섞이므로 반드시 인코딩한다. */
export function sitemapFileUrl(file: string): string {
  return absoluteUrl(`/sitemaps/${encodeURIComponent(file)}`);
}

export const SITEMAP_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  // 크롤러만 읽는 문서라 CDN 이 한동안 들고 있어도 된다(rss.xml 과 같은 정책).
  "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
} as const;
