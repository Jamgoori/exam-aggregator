// "AI 약점 진단까지 얼마나 남았나" 계산은 @gongmoa/core 로 단일화(모바일과 공유).
// 이 파일은 기존 import 경로를 지키는 re-export 뿐.
export {
  computeDiagnosisProgress,
  type DiagnosisProgress,
  type DiagnosisProgressInput,
} from "@gongmoa/core";
