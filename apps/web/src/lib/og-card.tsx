import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/lib/og-font";
import { SITE_NAME } from "@/lib/site-url";

// 카카오톡·트위터·디스코드가 링크 미리보기에 쓰는 카드 이미지. 1200×630 은
// 세 곳 모두가 잘라내지 않고 그대로 보여주는 표준 크기다.
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const BRAND = "#12b382";
const INK = "#0f172a";
const MUTED = "#64748b";
const CHIP_BG = "#ecfdf5";
const CHIP_INK = "#06664a";

// 제목이 길면 두 줄을 넘겨 카드 밖으로 흘러나간다. satori 에는 줄 수를 세어
// 줄여주는 기능이 없으므로 글자 수로 잘라내고, 길이에 따라 크기도 낮춘다.
// 문제지 제목은 가장 긴 것이 33자("2025 국가직 7급 (근로감독 및 산업안전분야)
// 건축계획학")라, 이 값이면 실제 제목은 잘리지 않고 두 줄로 들어간다.
const MAX_TITLE_CHARS = 38;

function fitTitle(title: string) {
  const text =
    title.length > MAX_TITLE_CHARS
      ? `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
      : title;
  const fontSize = text.length <= 14 ? 76 : text.length <= 22 ? 64 : 56;
  return { text, fontSize };
}

export async function renderOgCard({
  title,
  subtitle,
  chips = [],
}: {
  title: string;
  subtitle: string;
  chips?: string[];
}) {
  const { text, fontSize } = fitTitle(title);
  const footer = "gongmoa.kr";

  // 폰트 서브셋은 "이 카드에 실제로 그려지는 글자"만 담으므로 여기서 한 번에 모은다.
  const fonts = await loadOgFonts(
    [SITE_NAME, text, subtitle, footer, ...chips].join(""),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#ffffff",
        }}
      >
        {/* 흰 배경만으로는 메신저의 흰 말풍선에 묻히므로 왼쪽에 브랜드 색 띠를 둔다 */}
        <div style={{ width: 20, height: "100%", backgroundColor: BRAND }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            flex: 1,
            padding: "64px 72px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 40, fontWeight: 700, color: BRAND }}>
              {SITE_NAME}
            </span>
            <span style={{ fontSize: 30, color: MUTED }}>{subtitle}</span>
          </div>

          {/* 제목은 남는 공간을 다 차지하고 그 안에서 세로 중앙에 놓는다 — 제목이
              한 줄이든 두 줄이든 카드 무게중심이 흔들리지 않는다. */}
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              fontSize,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.25,
            }}
          >
            {text}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              {chips.map((chip) => (
                <div
                  key={chip}
                  style={{
                    display: "flex",
                    fontSize: 28,
                    fontWeight: 700,
                    color: CHIP_INK,
                    backgroundColor: CHIP_BG,
                    borderRadius: 999,
                    padding: "12px 26px",
                  }}
                >
                  {chip}
                </div>
              ))}
            </div>
            <span style={{ fontSize: 28, color: MUTED }}>{footer}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      ...(fonts.length > 0 ? { fonts } : {}),
      // 이 라우트들은 데이터를 그때그때 읽어 오느라 빌드 때 미리 그려지지 않는다
      // (빌드 결과에서 ƒ). 링크가 퍼질 때마다 폰트 내려받기 + DB 조회 + satori
      // 렌더가 반복되지 않게 CDN 이 오래 붙들고 있게 한다.
      //
      // 30일은 짧지 않은데, 카드에 그리는 값(문제지 제목·과목명)은 업로드 시점 기록이라
      // 사실상 바뀌지 않는다 (`exam_papers.title` 을 UPDATE 하지 않는 것이 레포 규칙).
      // 하루였을 때는 문제지 3,800장 × 크롤러 순회가 매일 새 렌더를 유발했고, 이
      // 라우트가 요청당 CPU·메모리를 가장 많이 먹는 경로다.
      headers: {
        "cache-control":
          "public, max-age=0, s-maxage=2592000, stale-while-revalidate=31536000",
      },
    },
  );
}
