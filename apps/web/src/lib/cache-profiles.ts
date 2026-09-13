import "server-only";

/**
 * 문제지 상세(/papers/[id]) 4,400장이 기대는 캐시들의 공통 수명.
 *
 * **왜 따로 뒀나(2026-09-13, Vercel 요금).** 이 캐시들이 전부 `revalidate: 3600`
 * 이었는데, 문제지 워밍(vercel.json 의 계단식 크론)은 하루 한 번 돈다. 즉 크론이
 * 올 때마다 4,400장이 예외 없이 stale 이라 전부 백그라운드 재생성됐다 — 하루
 * 4,400 페이지 렌더 × 30일이고, 페이지 한 장이 ISR 캐시에 엔트리를 여러 개 쓰므로
 * 8월 청구서에서 ISR Writes 295만 건($15.18)·Fast Origin Transfer 80.7GB($13.85)
 * 의 큰 몫이 여기였다. 수명이 워밍 주기보다 길면 같은 크론이 캐시 HIT 으로 끝난다
 * (워밍은 그대로 두는 것이 중요하다 — AGENTS.md 의 SEO 금지선).
 *
 * **왜 이 숫자인가.**
 * - `revalidate` 7일: 워밍 주기(하루)보다 확실히 길어야 재생성이 안 걸린다. 하루나
 *   이틀로 잡으면 크론 시각이 조금만 밀려도 도로 매일 재생성이다.
 * - `expire` 30일: `revalidate` 보다 길어야 한다(Next 가 검증한다). 트래픽이 없는
 *   문제지도 한 달이면 한 번은 동기 재생성으로 바닥을 다시 깐다.
 * - `stale` 300초: 기본 프로필과 같은 값이다. 이건 클라이언트 라우터 캐시라
 *   서버 재생성 비용과 무관하고, 30초 미만이면 프리렌더에서 빠진다.
 *
 * **내용이 그동안 안 바뀌나.** 문제지 행은 업로드 후 바뀌지 않는다(AGENTS.md:
 * `exam_papers.title` 을 UPDATE 로 고치지 말 것). 관리자가 화면에서 고치는 경로는
 * 서버 액션이 `revalidateTag("home-data", "max")` 로 즉시 만료시킨다
 * (app/admin/actions.ts). 남는 것은 CLI 업로드 스크립트(bulk-upload.mjs 등)인데,
 * 그쪽은 Next 밖에서 돌아 revalidateTag 를 부를 수 없다 — 그래서 하루 한 번
 * `/api/cron/warm` 이 DB 지문을 맞춰보고 어긋날 때만 태그를 만료시킨다
 * (lib/paper-fingerprint.ts).
 *
 * 이 값을 쓰는 캐시는 전부 `cacheTag("home-data")` 를 함께 달아야 한다. 태그가
 * 없으면 위의 만료 장치가 그 캐시를 못 건드려 최대 7일간 옛 값이 남는다.
 */
export const PAPER_CACHE_LIFE = {
  stale: 300,
  revalidate: 60 * 60 * 24 * 7,
  expire: 60 * 60 * 24 * 30,
};
