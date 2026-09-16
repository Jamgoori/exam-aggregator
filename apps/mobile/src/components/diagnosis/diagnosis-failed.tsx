import { TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { handleEdgeError } from "../../lib/edge";
import { useRequestDiagnosis } from "../../queries/diagnosis";
import { themedIcon } from "../../theme/icons";

// 대기 자리의 **막다른 두 상태**(설계서 §6.9 — 빈 상태·오류 정책). 웹에는 이 카드가 없다:
// 웹은 사람이 페이지를 열고 있는 동안에만 수거하고, 실패하면 다음 방문에서 요청 버튼이 다시
// 보이는 정도였다. 앱은 대기 카드를 띄운 채 20~30초마다 수거를 부르므로, 수거가 "이건 끝났다"
// 고 말해 준 뒤에도 같은 스피너를 돌리면 **영원히 오지 않는 것을 기다리는 화면**이 된다.
//
//   1) 실패로 닫힘(collect status "failed") — 배치가 만료·삭제됐거나 모델이 답을 못 만들었다.
//      사유는 서버가 사용자 문구로 실어 준다(“배치를 찾을 수 없어요.” · 개념별 실패 목록 등).
//   2) 제출 전(collect status "pending" 인데 제출 시각이 없다) — 요청 행은 있는데 배치가
//      나가지 않았다(키 미설정·제출 오류·만들 게 없음).
//
// 둘 다 **다시 시도**가 가능하다. 요청 행은 그대로 있으므로 `diagnosis-request` 를 개념 없이
// (빈 배열) 다시 부르면 서버가 그 행에 박힌 선택 그대로 배치를 새로 낸다 — 주기를 한 번 더
// 쓰는 것이 아니다. 같은 진단에 두 번 요금이 나가지 않게 막는 것은 서버다(이미 pending 배치가
// 있으면 건너뛰고, 제출 직전 `batch_claimed_at` 으로 선점한다). 그래도 무한 재시도는 아니다 —
// 서버가 진단 하나당 시도 횟수를 센다.
const AlertIcon = themedIcon(TriangleAlert);

// 1) 수거가 실패로 닫은 경우.
export function DiagnosisFailedCard({ reason }: { reason: string }) {
  return (
    <StalledCard
      title="극복법을 만들지 못했어요"
      // 사유는 서버 문구를 그대로 올린다(§6.9 1번 — 문구를 앱에서 다시 쓰지 않는다).
      body={reason}
      // 주기는 이미 썼지만 이 진단은 비어 있다. 다시 내지 못하면 다음 주기까지 아무것도 없다.
      hint="다시 시도하면 고른 개념 그대로 한 번 더 만들어요. 이번 주기를 다시 쓰는 건 아니에요."
    />
  );
}

// 2) 요청 행은 있는데 배치가 아직 나가지 않은 경우.
export function DiagnosisNotStartedCard() {
  return (
    <StalledCard
      title="아직 만들기 시작하지 못했어요"
      body="진단 요청은 저장됐지만 생성이 시작되지 않았어요."
      // 그대로 둬도 서버 크론(시간당)이 안전망으로 다시 집는다 — "다시 시도"는 그걸 앞당기는
      // 버튼이지 유일한 길이 아니다. 그 사실을 적어 두지 않으면 눌러도 안 되는 날 앱을 지운다.
      hint="다시 시도하거나, 그대로 두시면 서버가 한 시간 안에 한 번 더 시도해요."
    />
  );
}

function StalledCard({ title, body, hint }: { title: string; body: string; hint: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const request = useRequestDiagnosis();
  const pending = request.isPending;

  async function retry() {
    if (pending) return;
    setError(null);
    try {
      // 빈 배열 = "고른 개념을 바꾸지 않는다"(서버는 빈 선택으로 행을 덮지 않는다).
      const res = await request.mutateAsync([]);
      // 버튼을 잠그는 기준은 `generating` 하나다 — 그것만이 "지금 만들어지는 중"을 뜻한다.
      // `submitError` 가 없다고 제출된 것이 아니다: 방금 다른 호출이 선점했거나(2분)
      // 시도 횟수를 다 썼으면 서버는 조용히 0건을 돌려준다. 그때 버튼을 잠그면 아무것도
      // 안 하고 있는데 "다시 만들고 있어요"라고 말하는 화면이 남는다.
      // 잠그지 않으면 곧 폴링이 같은 상태를 다시 물어와 이 카드가 그대로 다시 그려진다.
      if (res.generating) setDone(true);
      else setError(res.submitError ?? "아직 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
    } catch (e) {
      const handled = await handleEdgeError(e, { next: "/mypage/diagnosis" });
      if (handled.redirected) return;
      setError(handled.message || "다시 시도하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <View className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <View className="flex-row items-center gap-2">
        <AlertIcon size={15} colorClassName="text-amber-700 dark:text-amber-300" />
        <AppText variant="sm" weight="bold" className="text-amber-900 dark:text-amber-200">
          {title}
        </AppText>
      </View>
      <AppText variant="xs" className="mt-1.5 leading-relaxed text-amber-800/80 dark:text-amber-200/70" pretty>
        {body} {hint}
      </AppText>
      {error && (
        <AppText variant="xs" className="mt-1.5 text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}
      <Button
        label={done ? "다시 만들고 있어요…" : pending ? "다시 시도하는 중이에요…" : "다시 시도"}
        disabled={done}
        pending={pending}
        onPress={() => void retry()}
        className="mt-2.5 bg-amber-600 active:bg-amber-700"
      />
    </View>
  );
}
