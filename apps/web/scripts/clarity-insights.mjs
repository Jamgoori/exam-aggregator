// Microsoft Clarity 대시보드 수치를 터미널로 뽑아 온다 (Data Export API).
//
//   npm run clarity -- [일수]        # 기본 3일
//
// 토큰: Clarity 대시보드 → Settings → Data Export → Generate new API token 에서
// 만들어 .env.local 에 CLARITY_API_TOKEN 으로 넣는다. 프로젝트 단위 토큰이라
// NEXT_PUBLIC_CLARITY_ID 와는 별개다.
//
// API 의 제약(우리가 정한 게 아니라 Clarity 쪽 한계):
//   - 최근 1~3일치만 조회된다. 그보다 긴 추세는 대시보드에서 봐야 한다.
//   - 프로젝트당 하루 10회. 그래서 한 번 호출로 여러 차원을 훑지 않고, 필요한
//     차원 조합만 인자로 받는다.
//   - 차원은 한 번에 최대 3개.
//   - 세션 리플레이 영상은 API 로 안 나온다(대시보드에서만 본다).

const TOKEN = process.env.CLARITY_API_TOKEN;
if (!TOKEN) {
  console.error(
    "CLARITY_API_TOKEN 이 없습니다. Clarity 대시보드 Settings > Data Export 에서 발급해 .env.local 에 넣어주세요.",
  );
  process.exit(1);
}

const numOfDays = Number(process.argv[2] ?? 3);
if (!Number.isInteger(numOfDays) || numOfDays < 1 || numOfDays > 3) {
  console.error("일수는 1~3 만 됩니다 (Clarity API 제한).");
  process.exit(1);
}

// 우리가 실제로 답을 얻고 싶은 질문별 차원 조합. 호출 횟수가 하루 10회뿐이라
// 아무 조합이나 던지지 않고, 볼 이유가 분명한 것만 둔다.
const QUERIES = [
  { label: "전체 요약", dimensions: [] },
  { label: "URL 별", dimensions: ["Page"] },
  { label: "기기 별", dimensions: ["Device"] },
  { label: "유입 경로 별", dimensions: ["Source"] },
  // 코드에서 심은 커스텀 태그. lib/clarity.ts 참고.
  { label: "회원 등급 별", dimensions: ["membership"] },
];

async function fetchInsights(dimensions) {
  const url = new URL("https://www.clarity.ms/export-data/api/v1/project-live-insights");
  url.searchParams.set("numOfDays", String(numOfDays));
  dimensions.forEach((d, i) => url.searchParams.set(`dimension${i + 1}`, d));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    // 429 는 하루 10회 한도다 — 재시도해도 소용없으니 그대로 말해준다.
    throw new Error(
      `${res.status} ${res.statusText}${res.status === 429 ? " (하루 10회 호출 한도 소진)" : ""}: ${await res.text()}`,
    );
  }
  return res.json();
}

for (const { label, dimensions } of QUERIES) {
  console.log(`\n=== ${label} (최근 ${numOfDays}일) ===`);
  try {
    const data = await fetchInsights(dimensions);
    // 응답은 [{ metricName, information: [{...}] }] 모양이다. 지표 이름과 정보를
    // 그대로 찍는다 — Clarity 가 지표를 늘려도 스크립트를 고칠 일이 없게.
    for (const metric of data) {
      console.log(`\n[${metric.metricName}]`);
      console.table(metric.information);
    }
  } catch (e) {
    console.error(`  실패: ${e.message}`);
  }
}
