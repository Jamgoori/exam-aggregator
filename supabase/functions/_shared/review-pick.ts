// ⚠ 이 파일은 이제 _shared/core.mjs(packages/core/src/review-pick.ts 의 esbuild 번들)의
// re-export 다. 규칙 본문은 core 하나뿐이고, 여기엔 코드가 없다. 파일을 남겨 둔 이유는
// _shared/srs.ts 머리말과 같다(AGENTS.md 문구 갱신·소유자 승인 후 같은 PR 에서 삭제).
// @ts-types="./core.d.ts"
export {
  pickRandomReviewCandidates,
  pickReviewCandidates,
  pickWeightedReviewCandidates,
  REVIEW_PICK_RECENT_DAYS,
  REVIEW_PICK_REPEAT_THRESHOLD,
  REVIEW_PICK_TIER_WEIGHTS,
  reviewPickTier,
  type ReviewPickCandidate,
  type ReviewPickStrategy,
} from "./core.mjs";
