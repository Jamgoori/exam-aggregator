import "server-only";

// 1000행씩 병렬로 이어받는 전체 조회. 본문은 packages/core/src/data/query-utils.ts 로
// 옮겼다(기출 섞어풀기 출제 풀 규칙이 Edge 에서도 같은 함수를 쓴다) — 기존 import 경로를
// 그대로 쓰도록 재노출한다.
export { fetchAllPages, type PagedResult } from "@gongmoa/core/server";
