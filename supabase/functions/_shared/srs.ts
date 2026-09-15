// ⚠ 이 파일은 이제 _shared/core.mjs(packages/core/src/srs.ts 의 esbuild 번들)의 re-export 다.
// 규칙 본문은 packages/core/src/srs.ts 하나뿐이고, 여기엔 코드가 없다.
//
// 파일을 지우지 않고 남겨 둔 이유: apps/web/AGENTS.md 의 SRS 금지선이 이 파일명을 지목해
// "packages/core/src/srs.ts 와 반드시 함께 고칠 것"이라고 적고 있다. 번들이 그 규칙을
// 기계적으로 보장하게 됐지만(같은 원본 → 생성물), AGENTS.md 문구 갱신은 소유자 승인
// 사항(설계서 §13 질문 9)이라 그 승인·문구 수정과 같은 PR 에서만 이 파일을 지운다.
// 그 전까지 두 경로(../_shared/srs.ts, ../_shared/core.mjs)는 같은 코드를 가리킨다.
// @ts-types="./core.d.ts"
export {
  fuzzInterval,
  isLeechTrigger,
  isSameSrsDay,
  nextSrs,
  SRS_EARLY_LAPSE_FACTOR,
  SRS_EARLY_LAPSE_RATIO,
  SRS_EASE_BONUS,
  SRS_EASE_PENALTY,
  SRS_FIRST_INTERVAL_DAYS,
  SRS_FUZZ_MIN_DAYS,
  SRS_FUZZ_RATIO,
  SRS_INITIAL,
  SRS_LEECH_REPEAT,
  SRS_LEECH_THRESHOLD,
  SRS_MAX_EASE,
  SRS_MAX_INTERVAL_DAYS,
  SRS_MIN_EASE,
  SRS_RELEARN_DELAY_HOURS,
  SRS_SECOND_INTERVAL_DAYS,
  srsDayIndex,
  srsDayStart,
  srsDueAt,
  srsGuessed,
  srsRelearnDueAt,
  srsStateFromRow,
  type NextSrsOptions,
  type SrsResult,
  type SrsState,
} from "./core.mjs";
