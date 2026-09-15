// 문항 이미지 미리받기 큐는 @gongmoa/core 로 단일화(모바일과 공유). 이 파일은 기존
// import 경로를 지키는 re-export 뿐.
export {
  createImagePreloadQueue,
  orderPreloadTargets,
  type PreloadTarget,
} from "@gongmoa/core";
