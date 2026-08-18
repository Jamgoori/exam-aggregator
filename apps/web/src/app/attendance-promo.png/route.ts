import {
  renderAttendancePromoCard,
  PROMO_CONTENT_TYPE,
} from "@/lib/attendance-promo-card";

// 홈 팝업이 <img src="/attendance-promo.png"> 로 불러가는 광고 이미지.
//
// 라우트로 두는 이유: public/ 에 PNG 를 넣으면 단계(5·10·15·20·25)나 지급 일수를
// 고칠 때 이미지 편집기를 열어 같은 숫자를 두 번 고쳐야 하고, 한 번 잊으면 광고만
// 옛 규칙을 떠든다. 여기서 그리면 core 의 ATTENDANCE_MILESTONES 하나만 고치면 된다.
//
// 캐시는 라우트 설정이 아니라 응답 헤더로만 건다. 이 레포는 Cache Components 를
// 켜 둔 상태라 `export const dynamic` 을 쓸 수 없고(빌드가 거부한다), OG 카드
// 라우트들도 같은 방식으로 CDN 에 오래 붙들어 둔다(lib/og-card.tsx 참고).

export async function GET() {
  const image = await renderAttendancePromoCard();
  return new Response(image.body, {
    headers: {
      "content-type": PROMO_CONTENT_TYPE,
      // 배포 사이에는 절대 바뀌지 않는 파일이다. 홈에 들어올 때마다 다시 받으면
      // 팝업이 한 박자 늦게 그려져 광고가 깜빡인다.
      "cache-control": "public, max-age=0, s-maxage=2592000, stale-while-revalidate=31536000",
    },
  });
}
