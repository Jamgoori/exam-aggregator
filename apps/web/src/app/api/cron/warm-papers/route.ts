import { after, connection } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getSitemapData } from "@/lib/sitemap-data";

// 문제지 페이지 워밍. Vercel 크론(vercel.json)이 매일 한 번 부르고, 배포 직후에는
// 사람이 손으로 부른다.
//
// **왜 필요한가.** 문제지 4,400여 장 중 빌드에 미리 만드는 것은 최신 200장뿐이다
// (papers/[id]/page.tsx 의 PRERENDERED_PAPER_COUNT). 나머지는 next.config 의
// partialPrefetching 으로 "첫 요청 뒤 백그라운드에서 주소별 완성본(제목·정본이 <head>
// 에 박힌 HTML)으로 승격"된다. 그 첫 요청을 크롤러가 하면 크롤러는 승격 전의 공용
// 셸을 받는다 — 셸에는 <head> 에 <title> 도 canonical 도 없다(서치콘솔 색인
// ~650 → 83 붕괴의 한 축, AGENTS.md SEO 금지선 참고). 그래서 크롤러보다 먼저 우리가
// 한 번씩 두드려 승격을 일으킨다.
//
// 승격은 실측으로 확인됐다(2026-09-06, 프로덕션 /papers/2013-국가직-9급-재배학개론):
// 요청 전 x-vercel-cache=PRERENDER · headLen 1766 · <head> 안 title/canonical 0개
// → 요청 몇 번 뒤 수십 초 → x-vercel-cache=HIT · headLen 4084 · title/canonical 각 1개.
//
// **동작.** 사이트맵의 문제지 URL 을 시간 예산(TIME_BUDGET_MS) 안에서 동시성
// CONCURRENCY 로 GET 한다. 응답 본문을 끝까지 읽어야 서버 쪽 렌더가 완료된다.
// 처리를 **끝낸 뒤에 응답**하므로 응답의 processed/next 가 실제 진행 상황이다.
// 남은 것이 있으면 after() 로 다음 덩이를 이어 부르지만, 그 연쇄가 끊겨도 응답의
// next 부터 손으로 이어 부르면 된다 — 아래 "손으로 전부 돌리기" 참고.
//
// **왜 동기로 바꿨나(2026-09-06).** 예전에는 응답을 먼저 주고 작업 전체를 after()
// 안에서 했는데, 프로덕션에서 체인이 중간에 조용히 끊겼다(경찰·소방 문제지가 미승격
// 으로 남음). 응답에는 "scheduled: 300"만 있어서 실제로 몇 장을 처리했는지도 알 수
// 없었다. 지금은 응답이 곧 진행 상황이라 끊긴 지점이 드러난다.
//
// **비밀값 필수.** CRON_SECRET 이 없으면 아무 일도 하지 않는다 — 이 주소는 한 번에
// 수백 번의 페이지 렌더를 일으키므로, 무인증 공개면 누구나 밖에서 함수 비용을 태울 수
// 있다(warm/route.ts 의 "미설정도 허용" 판단과 다른 이유가 이것이다).
//
// 손으로 전부 돌리기(배포 직후, PowerShell):
//   $s = "<CRON_SECRET>"; $o = 0
//   do {
//     $r = curl.exe -s -H "Authorization: Bearer $s" `
//       "https://gongmoa.kr/api/cron/warm-papers?offset=$o&chain=0" | ConvertFrom-Json
//     "$($r.offset) + $($r.processed) / $($r.total)"
//     $o = $r.next
//   } while ($o -ne $null)
export const maxDuration = 300;

const CONCURRENCY = 5;
// maxDuration(300s) 보다 넉넉히 짧게. 남은 시간에 다음 덩이를 부르는 fetch 와 응답
// 직렬화가 들어가야 한다.
const TIME_BUDGET_MS = 240_000;
// 한 호출이 처리할 상한. 시간 예산이 먼저 끝나면 그보다 적게 처리하고 next 를 준다.
const MAX_PER_CALL = 1200;
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
  // 손으로 돌릴 때는 chain=0 을 붙여 자동 연쇄를 끄고 호출자가 next 로 이어 부른다.
  // 크론은 파라미터가 없으므로 연쇄가 켜진 채로 돈다.
  const chain = url.searchParams.get("chain") !== "0";

  const data = await getSitemapData();
  const targets = data.paperFiles.flatMap((f) => f.entries.map((e) => e.url));
  const slice = targets.slice(offset, offset + MAX_PER_CALL);

  if (slice.length === 0) {
    return Response.json({
      ok: true,
      done: true,
      offset,
      processed: 0,
      total: targets.length,
      next: null,
    });
  }

  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  let cursor = 0;
  let okCount = 0;
  let failCount = 0;

  async function worker() {
    while (cursor < slice.length && Date.now() < deadline) {
      const target = slice[cursor++];
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

  const processed = Math.min(cursor, slice.length);
  const nextOffset = offset + processed;
  const done = nextOffset >= targets.length;
  console.log(
    `[warm-papers] offset=${offset} processed=${processed} ok=${okCount} fail=${failCount} elapsed=${Date.now() - started}ms total=${targets.length}`,
  );

  // 남은 것이 있으면 다음 덩이를 이어 부른다. 응답을 이미 만들어 두고 after() 로
  // 보내므로 이 호출을 기다리느라 maxDuration 에 걸리지 않는다. 이 연쇄가 끊겨도
  // 손실은 없다 — 응답의 next 부터 다시 부르면 이어진다.
  if (chain && !done) {
    after(async () => {
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
    });
  }

  return Response.json({
    ok: true,
    done,
    offset,
    processed,
    okCount,
    failCount,
    elapsedMs: Date.now() - started,
    total: targets.length,
    next: done ? null : nextOffset,
  });
}
