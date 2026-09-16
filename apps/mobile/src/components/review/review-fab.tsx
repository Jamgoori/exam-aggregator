import { router, type Href } from "expo-router";
import { CalendarCheck } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { useReviewNudgeCount, useStartDueSession } from "../../queries/review-due";
import { themedIcon } from "../../theme/icons";

// 스크롤을 내리면 따라오는 "복습 N" 버튼(웹 review-fab.tsx 1:1).
//
// 복습은 매일 와야 값이 나는 기능인데, 닿는 길이 오답노트 탭 안의 카드와 홈 모달(하루 한 번)
// 뿐이었다. 모달을 닫으면 그날은 사실상 안 보인다. 그렇다고 헤더에 항목을 늘리면 헤더가
// 지저분해지므로, 흔히 "맨 위로"가 놓이는 자리를 대신 쓴다.
//
// 오늘 할 게 없으면 아예 안 뜬다. 0을 띄우는 배지는 알림이 아니라 잔소리다.
//
// 몰입 화면(CBT·복습 솔버·PDF)에는 Screen 이 애초에 이 컴포넌트를 그리지 않는다 —
// 그쪽은 자체 UI 로 화면을 꽉 쓰고, 복습 솔버 위에 "복습 하러 가기"는 말이 안 된다.
const CalendarIcon = themedIcon(CalendarCheck);

export function ReviewFab({ visible }: { visible: boolean }) {
  const count = useReviewNudgeCount();
  const start = useStartDueSession("create");

  if (!visible || count <= 0) return null;

  async function open() {
    if (start.isPending) return;
    try {
      const res = await start.mutateAsync();
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}` as Href);
    } catch {
      // 실패하면 오답노트로 보낸다. 거기 카드가 이유(멤버십·오늘치 없음)를 말해준다 —
      // 떠다니는 버튼은 오류 문구를 그릴 자리가 아니다(웹과 같은 판단).
      router.push("/mypage?tab=wrong-notes" as Href);
    }
  }

  return (
    // pointerEvents="box-none" — 이 View 는 오버레이 전체를 덮으므로 버튼 밖 터치는 아래 본문이
    // 받아야 한다.
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 items-end px-5 pb-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`오늘 복습 ${count}문항 풀러 가기`}
        accessibilityState={{ disabled: start.isPending, busy: start.isPending }}
        disabled={start.isPending}
        onPress={() => void open()}
        className={[
          "flex-row items-center gap-2 rounded-full bg-blue-600 px-4 py-3 shadow-lg active:bg-blue-700",
          start.isPending ? "opacity-70" : "",
        ].join(" ")}
      >
        <CalendarIcon size={17} colorClassName="text-white" />
        <AppText variant="sm" weight="bold" tabular className="text-white">
          복습 {count}
        </AppText>
      </Pressable>
    </View>
  );
}
