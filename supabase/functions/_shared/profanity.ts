// ⚠ 이 파일은 이제 _shared/core.mjs(packages/core/src/profanity.ts 의 esbuild 번들)의
// re-export 다. 단어 목록·판정의 정본은 core 하나뿐이고, 여기엔 코드가 없다. 파일을 남겨
// 둔 이유는 _shared/srs.ts 머리말과 같다(AGENTS.md 문구 갱신·소유자 승인 후 같은 PR 에서 삭제).
// @ts-types="./core.d.ts"
export {
  containsProfanity,
  findProfanity,
  normalizeForProfanityCheck,
  PROFANITY_ALLOWED_PHRASES,
  PROFANITY_ERROR,
  PROFANITY_WORDS,
  profanityError,
} from "./core.mjs";
