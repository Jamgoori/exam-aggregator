// 개발 중 AI 약점 진단 기능을 특정 계정에만 열어두기 위한 임시 게이트.
// 웹 쪽 apps/web/src/lib/diagnosis-dev-gate.ts 와 값을 맞출 것 — 정식 오픈 시
// 이 파일과 호출부(mypage.tsx, diagnosis.tsx)를 함께 제거할 것.
const DIAGNOSIS_DEV_ALLOWED_EMAILS = new Set(["lks2354@gmail.com"]);

export function isDiagnosisDevAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return DIAGNOSIS_DEV_ALLOWED_EMAILS.has(email.toLowerCase());
}
