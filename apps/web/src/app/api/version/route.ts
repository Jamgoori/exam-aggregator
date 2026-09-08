import { connection } from "next/server";

// 지금 이 도메인에 붙어 있는 배포가 어느 커밋인지 밖에서 확인하는 주소.
//
// **왜 필요한가.** 배포가 새로 뜨면 문제지 승격본이 전부 날아간다 — 그 사이 크롤러가
// 오면 <head> 가 빈 공용 셸을 받는다(apps/web/AGENTS.md 의 SEO 금지선). 그래서 배포
// 직후 워밍(/api/cron/warm-papers)을 돌려야 하는데, "배포가 끝났는지"를 밖에서 알
// 방법이 없으면 워밍을 언제 시작할지 알 수 없다. master 에 push 한 커밋이 여기
// 나타나는 순간이 곧 그 배포가 프로덕션에 붙은 시점이다
// (.github/workflows/warm-papers.yml 이 이 값을 폴링한다).
//
// VERCEL_GIT_COMMIT_SHA·VERCEL_ENV 는 Vercel 이 배포마다 자동으로 넣는 시스템
// 환경변수다. 로컬에서는 둘 다 없어서 null 이 나간다.
//
// **공개해도 되는 값인가.** 커밋 해시와 환경 이름뿐이다. 저장소가 비공개라 해시만으로
// 내용을 볼 수는 없고, 이미 응답 헤더(x-vercel-id)로 배포를 구분할 수 있다. 대신
// 이보다 더(브랜치명·배포 URL·환경변수) 실어 보내지 말 것.
export async function GET() {
  // 배포마다 값이 달라야 하므로 캐시에 들어가면 안 된다. connection() 으로 요청
  // 시점에 도는 것을 보장하고, no-store 로 CDN 도 못 잡게 한다.
  await connection();

  return Response.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
