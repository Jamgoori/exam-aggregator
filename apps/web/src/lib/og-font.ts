import "server-only";

// OG 이미지(satori)에 한글을 그리려면 한글 글리프가 든 폰트를 직접 넣어줘야 한다.
// ImageResponse 기본 폰트는 라틴 전용이라 폰트를 안 주면 한글이 전부 두부(□)가 된다.
//
// 그렇다고 Noto Sans KR 전체(웨이트당 5MB 남짓)를 레포에 넣을 수는 없어서, Google
// Fonts 의 text= 파라미터로 "이 카드에 실제로 쓰이는 글자만" 담긴 수 KB짜리 서브셋을
// 받아 쓴다. 문제지 제목은 매번 달라지므로 빌드 시점에 미리 만들어 둘 수 없다.
const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";

// Google Fonts 는 UA 를 보고 포맷을 고른다 — 최신 브라우저에는 woff2, 아주 옛
// IE 에는 eot 를 주는데 satori 는 둘 다 못 읽는다(실측: MSIE UA 로 요청하면
// "Unsupported OpenType signature" 로 렌더링이 통째로 실패). 모르는 UA 에게는
// 가장 호환되는 truetype 을 주므로, 위장하지 말고 우리 이름을 그대로 보낸다.
const TRUETYPE_UA = "gongmoa-og-image";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

// 한 인스턴스가 이미지를 여러 장 그릴 때 같은 글자 조합을 다시 내려받지 않게 한다.
// 키는 정렬·중복 제거한 글자 집합이라 "2026 지방직"과 "지방직 2026"이 같은 항목이 된다.
const cache = new Map<string, Promise<OgFont[]>>();

async function fetchSubset(chars: string): Promise<OgFont[]> {
  const url = `${CSS_ENDPOINT}?family=Noto+Sans+KR:wght@400;700&text=${encodeURIComponent(chars)}`;
  const css = await fetch(url, { headers: { "User-Agent": TRUETYPE_UA } }).then(
    (r) => {
      if (!r.ok) throw new Error(`Google Fonts CSS ${r.status}`);
      return r.text();
    },
  );

  // @font-face 블록마다 font-weight 와 폰트 URL 을 짝지어 뽑는다. format 이
  // truetype 인 것만 받아, 포맷 협상이 바뀌면 조용히 깨지지 않고 폴백으로 가게 한다.
  const faces = [
    ...css.matchAll(
      /font-weight:\s*(\d+);[\s\S]*?src:\s*url\((.+?)\)\s*format\('truetype'\)/g,
    ),
  ];
  if (faces.length === 0) throw new Error("Google Fonts CSS에 truetype 없음");

  return Promise.all(
    faces.map(async ([, weight, fontUrl]) => {
      const res = await fetch(fontUrl);
      if (!res.ok) throw new Error(`폰트 파일 ${res.status}`);
      return {
        name: "Noto Sans KR",
        data: await res.arrayBuffer(),
        weight: Number(weight) === 700 ? (700 as const) : (400 as const),
        style: "normal" as const,
      };
    }),
  );
}

/**
 * 카드에 들어갈 글자들만 담은 폰트 서브셋을 받아온다.
 *
 * 실패하면 빈 배열을 돌려준다 — 폰트 CDN 이 죽었다고 OG 이미지 라우트가 500 을
 * 내면 공유 미리보기가 통째로 사라지므로, 라틴 기본 폰트로라도 그리는 편이 낫다.
 */
export function loadOgFonts(text: string): Promise<OgFont[]> {
  const chars = [...new Set(text)].sort().join("");
  const hit = cache.get(chars);
  if (hit) return hit;

  const pending = fetchSubset(chars).catch((e) => {
    console.error("OG 폰트 서브셋을 받지 못했습니다:", e);
    cache.delete(chars); // 일시적 장애였다면 다음 요청에서 다시 시도하게 한다
    return [] as OgFont[];
  });
  cache.set(chars, pending);
  return pending;
}
