// AI 약점 진단의 콜드 스타트 문턱. 값은 @gongmoa/core 의 diagnosis-progress.ts 가 정본
// (computeDiagnosisProgress 가 같은 값으로 "응시 2/3"를 그린다). 이 파일은 기존 import
// 경로를 지키는 re-export 뿐 — ai-diagnosis.ts 는 server-only 라 클라이언트 컴포넌트가
// 문턱 값을 여기서 가져간다. Edge Function(ai-diagnose)에도 같은 값이 복제돼 있으니
// 바꿀 때 함께 고칠 것.
export { DIAGNOSIS_MIN_WRONG, DIAGNOSIS_MIN_ATTEMPTS } from "@gongmoa/core";
