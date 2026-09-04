// AI 약점 진단의 콜드 스타트 문턱. 데이터가 빈약하면 진단이 뻔해져 신뢰를 깎으므로,
// 둘 중 하나를 넘겨야 진단을 열어준다(lib/ai-diagnosis.ts getDiagnosisEligibility).
//
// 이 파일이 따로 있는 이유: ai-diagnosis.ts 는 server-only 라(관리자 클라이언트를
// 만진다) 클라이언트 컴포넌트가 import 할 수 없는데, 채점 결과 모달처럼 브라우저에서
// "진단까지 응시 2/3"를 그려야 하는 자리가 있다. Edge Function(ai-diagnose)에도 같은
// 값이 복제돼 있으니 바꿀 때 함께 고칠 것.
export const DIAGNOSIS_MIN_WRONG = 15;
export const DIAGNOSIS_MIN_ATTEMPTS = 3;
