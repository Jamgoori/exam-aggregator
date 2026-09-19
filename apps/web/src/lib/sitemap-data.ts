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
  /** 시험 슬러그("국가직-9급"). 파일 이름의 재료다. */
  slug: string;
  /**
   * 사이트맵 파일 이름("sitemap-papers-gukgajik-9geup.xml"). 파일은 루트에 놓이므로
   * 이것이 곧 주소다. **이름은 getSitemapData 에서 한 번만 정한다** — 이름을 쓰는
   * 곳(robots.txt·인덱스·파일 라우트)이 제각기 다시 만들면 한 곳만 어긋나도 구글이
   * 404 를 받는다.
   */
  file: string;
  label: string;
  entries: SitemapEntry[];
};

export type SitemapData = {
  hubs: SitemapEntry[];
  paperFiles: SitemapPaperFile[];
  /** 전체에서 가장 최근 업로드 시각. 인덱스의 lastmod. */
  newest?: string;
};

// 문제지 lastmod 의 하한. 문제지 내용은 업로드 뒤 바뀌지 않지만, 크롤러에게 "이 주소들의
// HTML 이 그날 바뀌었다"를 알릴 신호가 lastmod 밖에 없어서 한 번 올린다. 그 뒤로 실제
// 변경이 없는데 이 값을 매번 올리면 lastmod 자체를 무시당하므로, 정말 <head> 가 바뀐
// 날에만 고칠 것.
//
// 2026-09-16 에 09-02 → 09-09 로 한 번 올렸다. 두 가지가 근거다.
//
// 1) 09-02 는 틀린 날짜였다. 빈 <head> 를 고친 것은 adf411f(2026-09-02)가 맞지만 그날
//    프리렌더에 실린 것은 최신 200장뿐이고(papers/[id] 의 PRERENDERED_PAPER_COUNT),
//    나머지 4,200여 장이 크롤러에게 제대로 된 <head> 를 주기 시작한 것은 워밍이 전량을
//    끝까지 돌게 된 2026-09-08 의 장당 타임아웃 수정(30494bc) 뒤다. 하한 09-02 는
//    "대부분의 문제지가 아직 공용 셸이던 날"을 가리키고 있었다 — 고쳤다고 알리려던
//    신호가 고치기 전 날짜를 가리킨 셈이다.
//
// 2) 구글이 사이트맵에서 문제지를 다시 집어넣지 않고 있다. 서치콘솔 실측(리포트
//    최종 업데이트 2026-09-14): 사이트맵이 내주는 4,727 URL 중 구글이 아는 것은 1,559
//    (색인 83 + 미색인 1,476)뿐이고, 사이트맵에서 받은 주소가 크롤링을 기다리는 자리인
//    "발견됨 - 현재 색인이 생성되지 않음"이 3,776 → 0 으로 비었다. 문제지 전부의
//    lastmod 가 09-01 로 굳어 있어 "9/1 이후 바뀐 것이 없다"로 읽힌 것이 한 축이다.
//    이 값을 움직이면 인덱스와 하위 파일 스물한 장의 lastmod 가 함께 올라가, 재수집
//    요청이 파일 단위로 나간다.
export const PAPER_LASTMOD_FLOOR = "2026-09-09T00:00:00+09:00";

// 사이트맵 파일은 **반드시 사이트 루트에 둔다**(/sitemap-hubs.xml). 디렉터리 밑으로
// 내리지 말 것 — 2026-09-06 에 그렇게 했다가 색인 발견 경로가 통째로 끊겼다.
//
// 사이트맵 규약에는 "파일이 놓인 경로가 그 파일이 담을 수 있는 주소 범위를 정한다"는
// 규칙이 있다. /sitemaps/ 밑의 파일은 /sitemaps/ 로 시작하는 주소만 담을 수 있는데,
// 우리 하위 파일이 담는 것은 / · /papers/ · /subjects/ · /exams/ 뿐이라 전부 범위
// 밖이었다. 구글 공식 문서는 이 제한을 **서치콘솔 직접 제출로만** 면제한다 —
// robots.txt 에 적는 것으로는 풀리지 않는다(2026-09-18 에 robots.txt 에 22장을 직접
// 적어 본 것은 이 점에서 근거가 틀렸다).
//
// 실측(서치콘솔 리포트 최종 업데이트 2026-09-14): 사이트맵이 내주는 4,760 URL 중
// 구글이 아는 것은 1,559(색인 83 + 미색인 1,476)뿐이고, 사이트맵에서 받은 주소가
// 크롤링을 기다리는 자리인 "발견됨 - 현재 색인이 생성되지 않음"이 3,776 → 0 으로
// 비었다. 분할 전(루트의 단일 /sitemap.xml)에 구글이 알던 주소는 6,000 가까이였다.
export const HUBS_FILE = "sitemap-hubs.xml";

// 한글 슬러그("국가직-9급")를 파일 이름에 쓸 ASCII 로 옮긴다 → "gukgajik-9geup".
//
// 왜 옮기나: 한글을 그대로 쓰면 파일 이름이
// `sitemap-papers-%EA%B5%AD%EA%B0%80%EC%A7%81-9%EA%B8%89.xml` 이 된다. 주소로는
// 적법하지만 **사이트맵 파일 이름**으로는 이 사이트에서 검증된 적이 없는 형태고
// (분할 전 robots.txt 에 적혀 있던 사이트맵은 ASCII 인 /sitemap.xml 하나뿐이었다),
// 서치콘솔 사이트맵 보고서에서 어느 시험인지 읽기도 어렵다. 색인이 돌아오는지를
// 파일 단위로 지켜봐야 하는 판이라 변수를 하나라도 줄인다.
//
// 표기법은 국어의 로마자 표기법에서 음운 변화(자음 동화 등)를 뺀 것이다. 표에 없는
// 글자는 버리고 영숫자는 그대로, 공백·밑줄은 하이픈으로 둔다. 되돌릴 필요는 없다 —
// 주소에서 시험을 찾을 때는 이 함수로 만든 이름끼리 맞춰 본다.
const HANGUL_CHO = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
const HANGUL_JUNG = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
const HANGUL_JONG = ["","k","k","k","n","n","n","t","l","k","m","l","l","l","p","l","m","p","p","t","t","ng","t","t","k","t","p","t"];

export function romanizeSlug(slug: string): string {
  let out = "";
  for (const ch of slug) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      out +=
        HANGUL_CHO[Math.floor(i / 588)] +
        HANGUL_JUNG[Math.floor((i % 588) / 28)] +
        HANGUL_JONG[i % 28];
    } else if (/[a-z0-9]/i.test(ch)) {
      out += ch.toLowerCase();
    } else if (/[\s\-_]/.test(ch)) {
      out += "-";
    }
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  // 한글도 영숫자도 없는 슬러그(기호뿐)는 이름이 빈 문자열이 된다. 그대로 두면
  // "sitemap-papers-.xml" 이 되어 서로 구분되지 않으므로 바이트에서 뽑은 고정 길이
  // 이름으로 물러선다. 읽을 수는 없지만 주소는 유일하고 안정적이다.
  if (out) return out;
  let hash = 0x811c9dc5;
  for (const ch of slug) {
    hash = ((hash ^ ch.codePointAt(0)!) * 0x01000193) >>> 0;
  }
  return `exam-${hash.toString(16).padStart(8, "0")}`;
}

export function paperFileName(slug: string): string {
  return `sitemap-papers-${romanizeSlug(slug)}.xml`;
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

  const drafts: Omit<SitemapPaperFile, "file">[] = combos
    .filter((c) => bySlug.has(c.slug))
    .map((c) => ({ slug: c.slug, label: c.label, entries: bySlug.get(c.slug)! }));
  // 시험 인덱스에 없는 조합(시행처 행이 없는 문제지 등)이 있으면 버리지 않고 한 파일에
  // 모은다 — 사이트맵에서 빠지면 그 문제지는 검색에 안 뜬다.
  for (const [slug, entries] of bySlug) {
    if (!combos.some((c) => c.slug === slug)) {
      drafts.push({ slug, label: slug, entries });
    }
  }

  // 파일 이름을 확정한다. 로마자 표기는 음운 변화를 반영하지 않으므로 서로 다른 시험이
  // 같은 이름으로 떨어질 여지가 이론상 남아 있다(지금 22개는 전부 다르다). 겹치면 한
  // 파일이 다른 파일을 가려 그 시험의 문제지가 통째로 사이트맵에서 사라지므로 —
  // 조용히 사라지는 것이 여기서 가장 비싼 사고다 — 뒤에 오는 쪽에 번호를 붙여 가른다.
  const taken = new Set<string>();
  const paperFiles: SitemapPaperFile[] = drafts.map((d) => {
    const base = paperFileName(d.slug);
    let file = base;
    for (let n = 2; taken.has(file); n += 1) {
      file = base.replace(/\.xml$/, `-${n}.xml`);
    }
    taken.add(file);
    return { ...d, file };
  });

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

/**
 * 사이트맵 파일의 절대 주소. **루트에 놓는다** — 이유는 HUBS_FILE 위 주석(경로가
 * 담을 수 있는 주소 범위를 정한다는 규약)에 적어 두었다.
 *
 * 이름은 romanizeSlug 를 거쳐 ASCII 만 남지만, 표에 없는 글자가 섞인 이름이 언젠가
 * 들어오더라도 주소가 깨지지 않게 인코딩은 그대로 통과시킨다.
 */
export function sitemapFileUrl(file: string): string {
  return absoluteUrl(`/${encodeURIComponent(file)}`);
}

export const SITEMAP_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  // 크롤러만 읽는 문서라 CDN 이 한동안 들고 있어도 된다(rss.xml 과 같은 정책).
  "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
} as const;
