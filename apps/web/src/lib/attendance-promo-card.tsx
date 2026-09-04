import { ImageResponse } from "next/og";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
} from "@gongmoa/core";
import { loadOgFonts } from "@/lib/og-font";
import { PROMO_SIZE } from "@/lib/attendance-promo-size";

// 홈 팝업에 뜨는 출석 이벤트 광고 — HTML 이 아니라 **PNG 한 장**이다.
//
// 왜 이미지인가: 기업 이벤트 팝업처럼 보이길 원했고, 그건 글자·색·간격이 화면 폭이나
// 다크모드에 따라 흔들리지 않는다는 뜻이다. HTML 로 짜면 폰트 크기 설정·좁은 기기·
// 테마마다 조금씩 다른 그림이 나오고, 그 변형을 다 맞추려면 팝업 하나에 반응형
// 규칙이 잔뜩 붙는다. 한 장으로 그려 두면 어디서든 같은 광고가 뜬다.
//
// 대신 이미지는 검색·번역·화면낭독기가 못 읽으므로, 팝업 쪽(attendance-promo-slide)이
// 같은 내용을 alt 로 들고 있어야 한다.
//
// 숫자(단계·최소 문항 수·월 최대 일수)는 여기서도 직접 적지 않는다. 광고가 옛 규칙을
// 떠들면 그게 제일 나쁜 종류의 거짓말이다 — core 의 attendance.ts 에서 그대로 받는다.
//
// 그리는 방식은 OG 카드(lib/og-card.tsx)와 같다: satori 라 flexbox 만 쓰고(grid 없음),
// 한글은 Google Fonts 서브셋을 받아 넣는다.

// 크기는 팝업 쪽과 나눠 쓰는 값이라 별도 모듈에 있다(lib/attendance-promo-size.ts).
export { PROMO_SIZE };
export const PROMO_CONTENT_TYPE = "image/png";

const INK = "#0f172a";
const MUTED = "#64748b";
const BRAND = "#12b382";
const REWARD = "#f59e0b";

export async function renderAttendancePromoCard() {
  const badge = "출석체크 이벤트";
  const title1 = "매일 풀면,";
  const title2 = "멤버십이 늘어나요";
  const lead = `하루 ${ATTENDANCE_MIN_QUESTIONS}문항만 풀면 그날 출석`;
  const maxLine = `한 달이면 멤버십 최대 ${ATTENDANCE_MONTHLY_MAX_DAYS}일`;
  const free = "무료";
  const membership = "멤버십";

  const fonts = await loadOgFonts(
    [
      badge,
      title1,
      title2,
      lead,
      maxLine,
      free,
      membership,
      // 단계 칸에 실제로 그려지는 글자("5일", "+1일" …)
      ATTENDANCE_MILESTONES.map((m) => `${m.days}일+${m.grantDays}일`).join(""),
    ].join(""),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // 위쪽 파란 머리 / 아래쪽 흰 몸통. 배경 한 장으로 두면 광고라기보다
          // 안내문처럼 보인다 — 색 면적이 커야 팝업으로 읽힌다.
          backgroundColor: "#ffffff",
        }}
      >
        {/* ── 머리: 색 면 위에 용건만 ─────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "56px 56px 40px",
            backgroundImage: "linear-gradient(135deg, #06664a 0%, #12b382 100%)",
          }}
        >
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                fontSize: 26,
                fontWeight: 700,
                color: "#06664a",
                backgroundColor: "#ffffff",
                borderRadius: 999,
                padding: "10px 24px",
              }}
            >
              {badge}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 28,
              fontSize: 60,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.28,
            }}
          >
            <span>{title1}</span>
            <span>{title2}</span>
          </div>

          <div style={{ display: "flex", marginTop: 18, fontSize: 28, color: "#d1fae5" }}>
            {lead}
          </div>
        </div>

        {/* ── 몸통: 단계표가 이 광고의 전부다 ─────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "44px 44px 40px",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            {ATTENDANCE_MILESTONES.map((m, i) => {
              // 마지막 단계만 색을 바꾼다. 다섯 칸이 전부 같은 색이면 "끝까지 가면
              // 두 배"라는 이 표의 결론이 안 보인다.
              const last = i === ATTENDANCE_MILESTONES.length - 1;
              return (
                <div
                  key={m.days}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flex: 1,
                    padding: "22px 0 20px",
                    borderRadius: 22,
                    backgroundColor: last ? "#fff7ed" : "#f1f5f9",
                    border: `2px solid ${last ? "#fdba74" : "#e2e8f0"}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontSize: 30,
                      fontWeight: 700,
                      color: last ? "#b45309" : INK,
                    }}
                  >
                    {m.days}일
                  </div>
                  {/* "+1일"만 적으면 무엇이 늘어나는지가 빠진다. 좁은 칸이라
                      "멤버십"과 "+1일"을 두 줄로 나눠 적는다(화면 카드와 같은 처리). */}
                  <div
                    style={{
                      display: "flex",
                      marginTop: 12,
                      fontSize: 19,
                      color: MUTED,
                    }}
                  >
                    {membership}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 27,
                      fontWeight: 700,
                      color: last ? REWARD : BRAND,
                    }}
                  >
                    +{m.grantDays}일
                  </div>
                </div>
              );
            })}
          </div>

          {/* 결론 한 줄. 위 표를 안 읽고 닫는 사람도 이 문장은 본다. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginTop: 34,
              marginBottom: 8,
              padding: "26px 20px",
              borderRadius: 24,
              backgroundColor: "#ecfdf5",
            }}
          >
            <span style={{ fontSize: 34, fontWeight: 700, color: INK }}>{maxLine}</span>
            <span
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: "#ffffff",
                backgroundColor: BRAND,
                borderRadius: 12,
                padding: "6px 18px",
              }}
            >
              {free}
            </span>
          </div>

        </div>
      </div>
    ),
    {
      ...PROMO_SIZE,
      ...(fonts.length > 0 ? { fonts } : {}),
    },
  );
}
