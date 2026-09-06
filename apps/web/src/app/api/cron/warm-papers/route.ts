import { after, connection } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getSitemapData } from "@/lib/sitemap-data";

// 문제지 페이지 워밍. Vercel 크론(vercel.json)이 매일 한 번 부르고, 배포 직후에는
// 사람이 손으로 부른다.
//
// **왜 필요한가.** 문제지 4,300장 중 빌드에 미리 만드는 것은 최신 200장뿐이다
// (papers/[id]/page.tsx 의 PRERENDERED_PAPER_COUNT). 나머지는 next.config 의
// partialPrefetching 으로 "첫 요청 뒤 백그라운드에서 주소별 완성본(제목·정본이 <head>
// 에 박힌 HTML)으로 승격"된다. 그 첫 요청을 크롤러가 하면 크롤러는 승격 전의 공용
// 셸을 받는다 — 셸에는 <head> 에 <title> 도 canonical 도 없다(서치콘솔 색인
// ~650 → 83 붕괴의 한 축, AGENTS.md SEO 금지선 참고). 게다가 그 승격본은 재배포되면
// 비워지는 것으로 보이는데(Next Full Route Cache 는 배포 단위), 이 저장소는 하루에도
// 여러 번 배포한다. 그래서 크롤러보다 먼저 우리가 한 번씩 두드려 승격을 일으킨다.
//
// **동작.** 사이트맵의 문제지 URL 을 CHUNK 개씩 잘라 동시성 CONCURRENCY 로 GET 한다.
// 응답 본문을 끝까지 읽어야 서버 쪽 렌더가 완료된다. 한 호출은 응답을 바로 돌려주고
// 실제 작업은 after() 안에서 하며, 한 덩이가 끝나면 다음 offset 으로 자기 자신을 다시
// 부른다(연쇄). 그래서 함수 실행 시간 상한(maxDuration)에 걸리지 않고 4,300장을 다
// 돈다. 시간 예산(TIME_BUDGET_MS)을 넘기면 덜 돈 자리부터 이어 부른다.
//
// **비밀값 필수.** CRON_SECRET 이 없으면 아무 일도 하지 않는다 — 이 주소는 한 번에
// 수백 번의 페이지 렌더를 일으키므로, 무인증 공개면 누구나 밖에서 함수 비용을 태울 수
// 있다(warm/route.ts 의 "미설정도 허용" 판단과 다른 이유가 이것이다).
//
// 손으로 부르기(배포 직후):
//   curl -H "Authorization: Bearer $CRON_SECRET" https://gongmoa.kr/api/cron/warm-papers
export const maxDuration = 300;

const CHUNK = 300;
const CONCURRENCY = 3;
// maxDuration 보다 넉넉히 짧게. 남은 시간에 다음 덩이를 부르는 fetch 가 들어가야 한다.
const TIME_BUDGET_MS = 200_000;
const USER_AGENT = "gongmoa-warm/1.0 (+https://gongmoa.kr)";

export async function GET(request: Request) {
  await connection();

  const auth = checkCronAuth(request);
  if (auth === "unset") {
    return Response.json(
      { ok: false, reason: "CRON_SECRET 이 설정되지 않아 워밍을 돌리지 않는다." },
      { status: 503 },
    );
  }
  if (auth === "unauthorized") {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const data = await getSitemapData();
  const targets = data.paperFiles.flatMap((f) => f.entries.map((e) => e.url));
  const slice = targets.slice(offset, offset + CHUNK);

  if (slice.length === 0) {
    return Response.json({ ok: true, done: true, total: targets.length, offset });
  }

  // 응답은 바로 돌려주고 작업은 뒤에서. Vercel 은 after() 콜백이 끝날 때까지 함수를
  // 살려 둔다. 다음 덩이 호출도 여기서 하되, 그 호출 역시 응답을 바로 돌려주므로
  // 기다리는 시간은 짧다 — 호출이 호출을 물고 늘어져 첫 함수가 maxDuration 에 걸리는
  // 일이 없다.
  after(async () => {
    const started = Date.now();
    const deadline = started + TIME_BUDGET_MS;
    let next = 0;
    let okCount = 0;
    let failCount = 0;

    async function worker() {
      while (next < slice.length && Date.now() < deadline) {
        const target = slice[next++];
        try {
          const res = await fetch(target, {
            headers: { "user-agent": USER_AGENT },
            cache: "no-store",
          });
          // 본문을 끝까지 읽어야 렌더가 완료된다(중간에 끊으면 승격이 일어나지 않을
          // 수 있다). 내용은 쓰지 않는다.
          await res.arrayBuffer();
          if (res.ok) okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const processed = Math.min(next, slice.length);
    const nextOffset = offset + processed;
    console.log(
      `[warm-papers] offset=${offset} processed=${processed} ok=${okCount} fail=${failCount} elapsed=${Date.now() - started}ms total=${targets.length}`,
    );

    if (nextOffset < targets.length) {
      const nextUrl = new URL(url.pathname, url.origin);
      nextUrl.searchParams.set("offset", String(nextOffset));
      try {
        const res = await fetch(nextUrl, {
          headers: { authorization: request.headers.get("authorization") ?? "" },
          cache: "no-store",
        });
        await res.arrayBuffer();
      } catch (e) {
        console.error(`[warm-papers] 다음 덩이 호출 실패 offset=${nextOffset}`, e);
      }
    }
  });

  return Response.json({
    ok: true,
    offset,
    scheduled: slice.length,
    total: targets.length,
    next: offset + slice.length < targets.length ? offset + slice.length : null,
  });
}
