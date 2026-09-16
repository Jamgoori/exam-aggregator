import { daysUntilKst, diagnosisIntroCta, isDiagnosisEligible, nextDiagnosisDate } from "@gongmoa/core";
import { View } from "react-native";
import { DiagnosisDetails, DiagnosisIntroHero, DiagnosisSteps } from "../../src/components/diagnosis/diagnosis-intro";
import { DiagnosisProgress } from "../../src/components/diagnosis/diagnosis-progress";
import { DiagnosisSampleReport } from "../../src/components/diagnosis/diagnosis-sample-report";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useDiagnosisIntro } from "../../src/queries/home";
import { useAuth } from "../../src/providers/auth-provider";

// `/diagnosis`(설계서 §5 행, 게스트 허용 §7.0) — 웹 app/diagnosis/page.tsx 1:1: 히어로(한 줄
// 정의 · 지금 할 수 있는 행동 하나) → (로그인했는데 자격 미달이면 진행 바) → 3단계 → 결과
// 예시(DiagnosisSampleReport) → 접어 둔 규칙·FAQ.
//
// 버튼의 목적지 /mypage/diagnosis(진단 대시보드)는 Phase 4 에서 붙었다(app/mypage/diagnosis.tsx) —
// 문구·주소는 여기서 정하지 않고 core diagnosisIntroCta 가 정한다.
export default function DiagnosisIntroScreen() {
  const { userId, isPremium } = useAuth();
  const intro = useDiagnosisIntro();

  return (
    <Screen contentClassName="gap-8 pb-20">
      {userId ? (
        <QueryState query={intro} skeleton={<IntroSkeleton />}>
          {(data) => {
            const eligible = isDiagnosisEligible(data);
            const daysLeft = data.lastDate ? daysUntilKst(nextDiagnosisDate(data.lastDate)) : null;
            const cta = diagnosisIntroCta({ loggedIn: true, premium: isPremium, eligible, daysLeft });
            return (
              <>
                <DiagnosisIntroHero cta={cta} />
                {/* 로그인했는데 아직 자격이 안 되는 사람에게는 "얼마나 남았는지"를 바로 보여준다 —
                    CTA 의 한 줄 안내보다 내 숫자가 박힌 바가 더 움직인다. 자격이 되면 CTA 가 이미
                    "진단 받으러 가기"라 바를 겹쳐 두지 않는다. */}
                {!eligible && (
                  <DiagnosisProgress attemptCount={data.attemptCount} wrongCount={data.wrongCount} lockedHref="/papers" />
                )}
              </>
            );
          }}
        </QueryState>
      ) : (
        <DiagnosisIntroHero cta={diagnosisIntroCta({ loggedIn: false, premium: false, eligible: false, daysLeft: null })} />
      )}
      <DiagnosisSteps />
      {/* 3단계를 읽고 나서 "그래서 결과가 어떻게 생겼는데"에 답하는 자리. 진단은 응시 3회 뒤에야
          열리므로, 결과물을 미리 보여주지 않으면 세 번 올 이유가 없다. */}
      <DiagnosisSampleReport />
      <DiagnosisDetails />
    </Screen>
  );
}

// 히어로 글은 누구에게나 같으니 그대로 두고, 사람마다 다른 버튼·진행 바 자리만 비운다.
function IntroSkeleton() {
  return (
    <View className="gap-8">
      <DiagnosisIntroHero cta={null} />
      <Skeleton className="h-[74px] w-full rounded-xl" />
    </View>
  );
}
