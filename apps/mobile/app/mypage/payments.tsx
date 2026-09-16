import { router } from "expo-router";
import { Receipt } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { EmptyState } from "../../src/components/feedback";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { PaymentItem } from "../../src/components/payments/payment-item";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useMyPayments } from "../../src/queries/payments";

// `/mypage/payments`(설계서 §5 행, L) — 웹 app/mypage/payments/page.tsx 이식.
//
// 전자상거래법상 거래 기록은 보존해야 하고, 무엇보다 결제한 사람이 "내가 언제 얼마를
// 냈는지"를 직접 확인할 수 있어야 문의가 줄어든다(웹 머리말). 앱은 **읽기 전용**이다.
//
// 웹과 다른 두 곳(§8.1 — Apple 3.1.1/3.1.3: 앱 안에서 다른 구매 수단을 안내하면 리젝):
//   1. 빈 상태의 "요금제 보기" 버튼을 그리지 않는다. 요금제·가격·구매 버튼은 IAP 단계
//      (Phase 5) 전까지 앱 어디에도 없다.
//   2. 맨 아래 환불 안내 문단("환불을 원하시면 …으로 주문번호와 함께", "환불 기준은
//      이용약관에")을 그리지 않는다. 결제·환불 안내는 같은 조항에 걸린다.
// 두 문구는 웹에 그대로 남아 있고, 앱은 그 자리에 아무것도 넣지 않는다(다른 문구로
// 바꿔 적지도 않는다 — 우회로 읽힌다).
//
// 결제 자체는 웹 Toss 결제(source:"paid")뿐이라 이 화면에 뜨는 줄도 그쪽에서 생긴다.
// 앱 IAP 구매(Phase 5)는 `store_transactions` 원장이 따로 생기며 그때 이 화면을 넓힌다.
export default function PaymentsScreen() {
  const { userId, loading } = useRequireLogin("/mypage/payments");
  const query = useMyPayments();

  if (loading) return <Screen contentClassName="gap-6" />;
  if (!userId) return <LoginRequiredScreen />;

  return (
    <Screen contentClassName="gap-6" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View>
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/mypage")} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 마이페이지
          </AppText>
        </Pressable>
        <AppText variant="2xl" weight="semibold" accessibilityRole="header" className="mt-2">
          결제 내역
        </AppText>
      </View>

      <QueryState
        query={query}
        skeleton={<PaymentsSkeleton />}
        empty={
          <EmptyState
            icon={<Receipt size={28} color="#d4d4d8" />}
            title="아직 결제 내역이 없어요."
            className="px-6 py-12"
          />
        }
      >
        {(payments) => (
          <View>
            {payments.map((payment) => (
              <PaymentItem key={payment.order_id} payment={payment} />
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}

function PaymentsSkeleton() {
  return (
    <View className="gap-4">
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} className="gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <View className="flex-row items-center justify-between gap-2">
            <Skeleton className="h-5 w-40 rounded-lg" delay={i * 80} />
            <Skeleton className="h-5 w-16 rounded-lg" delay={i * 80} />
          </View>
          <Skeleton className="h-4 w-48 rounded-lg" delay={i * 80 + 30} />
          <Skeleton className="h-3 w-36 rounded-lg" delay={i * 80 + 60} />
        </View>
      ))}
    </View>
  );
}
