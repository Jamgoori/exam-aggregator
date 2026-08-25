// 개발 중 AI 약점 진단 기능을 특정 계정에만 열어두기 위한 임시 게이트.
// 정식 오픈 시 이 파일과 호출부(diagnosis/page.tsx, mypage/actions.ts)를 제거할 것.
const DIAGNOSIS_DEV_ALLOWED_EMAILS = new Set(["lks2354@gmail.com"]);

export function isDiagnosisDevAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return DIAGNOSIS_DEV_ALLOWED_EMAILS.has(email.toLowerCase());
}
