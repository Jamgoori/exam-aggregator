// AI 약점 진단의 콜드 스타트 문턱. 데이터가 빈약하면 진단이 뻔해져 신뢰를 깎으므로,
// 둘 중 하나를 넘겨야 진단을 열어준다(웹 lib/ai-diagnosis.ts getDiagnosisEligibility).
// Edge Function(ai-diagnose)에도 같은 값이 복제돼 있으니 바꿀 때 함께 고칠 것.
export const DIAGNOSIS_MIN_WRONG = 15;
export const DIAGNOSIS_MIN_ATTEMPTS = 3;

// "AI 약점 진단까지 얼마나 남았나"를 한 숫자로 만드는 순수 계산.
//
// 자격은 둘 중 하나만 넘기면 열린다(오답 15개 또는 응시 3회 — 웹 lib/ai-diagnosis 의
// getDiagnosisEligibility). 화면에는 둘 중 **더 가까운 쪽** 하나만 보여준다 — 두 조건을
// 나란히 적으면 "둘 다 채워야 하나"로 읽힌다. 처음 온 사람은 대개 응시 쪽이 먼저
// 차므로(회차 하나에 오답이 서너 개라 15개보다 3회가 빠르다) 같으면 응시를 앞세운다.
//
// 웹 클라이언트(결과 모달)·웹 서버(마이페이지)·모바일이 같은 규칙으로 같은 문장을
// 만들도록 여기 한 곳에 둔다. 서버 전용 import 가 없어야 클라이언트 번들에 실린다.
export type DiagnosisProgressInput = {
  attemptCount: number;
  wrongCount: number;
};

export type DiagnosisProgress = {
  eligible: boolean;
  // 0~1. 자격이 되면 1.
  ratio: number;
  // "응시 2/3" 처럼 진행 바 오른쪽에 붙는 짧은 표기.
  label: string;
  // 무엇을 하면 채워지는지 한 줄. 자격이 되면 null.
  remainingHint: string | null;
};

export function computeDiagnosisProgress({
  attemptCount,
  wrongCount,
}: DiagnosisProgressInput): DiagnosisProgress {
  const byAttempts = Math.min(1, attemptCount / DIAGNOSIS_MIN_ATTEMPTS);
  const byWrongs = Math.min(1, wrongCount / DIAGNOSIS_MIN_WRONG);
  const eligible = byAttempts >= 1 || byWrongs >= 1;
  if (byAttempts >= byWrongs) {
    const left = Math.max(0, DIAGNOSIS_MIN_ATTEMPTS - attemptCount);
    return {
      eligible,
      ratio: byAttempts,
      label: `응시 ${Math.min(attemptCount, DIAGNOSIS_MIN_ATTEMPTS)}/${DIAGNOSIS_MIN_ATTEMPTS}`,
      remainingHint: eligible
        ? null
        : left === 1
          ? "한 회차만 더 풀면 진단이 열려요"
          : `${left}회차만 더 풀면 진단이 열려요`,
    };
  }
  const left = Math.max(0, DIAGNOSIS_MIN_WRONG - wrongCount);
  return {
    eligible,
    ratio: byWrongs,
    label: `오답 ${Math.min(wrongCount, DIAGNOSIS_MIN_WRONG)}/${DIAGNOSIS_MIN_WRONG}`,
    remainingHint: eligible ? null : `오답 ${left}개가 더 모이면 진단이 열려요`,
  };
}
