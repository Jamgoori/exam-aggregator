import { findPlan, formatWon, KST_TIME_ZONE } from "@gongmoa/core";
import * as WebBrowser from "expo-web-browser";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import type { PaymentRow } from "../../queries/payments";

// 결제 내역 한 줄(웹 app/mypage/payments/page.tsx PaymentItem 1:1).
//
// 상태 표시는 "결제 완료 / 환불됨 / 결제 실패" 세 가지뿐이다 — 내부 상태값(ready 등)을
// 그대로 보여줄 이유가 없다(웹 주석). `ready` 는 애초에 목록에서 빠진다(queries/payments.ts).
const STATUS_LABEL: Record<string, { text: string; box: string; text_: string }> = {
  paid: {
    text: "결제 완료",
    box: "bg-emerald-100 dark:bg-emerald-950/60",
    text_: "text-emerald-700 dark:text-emerald-300",
  },
  canceled: {
    text: "환불됨",
    box: "bg-zinc-100 dark:bg-zinc-800",
    text_: "text-zinc-600 dark:text-zinc-400",
  },
  failed: {
    text: "결제 실패",
    box: "bg-red-100 dark:bg-red-950/50",
    text_: "text-red-700 dark:text-red-300",
  },
};

// 한국 시간 기준 "2026년 8월 14일 20:31"(웹 formatDateTime 과 같은 옵션). 기기 시간대가
// 어디든 결제 시각은 KST 로 읽혀야 한다 — 영수증·문의 대응의 기준이 그 시각이다.
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PaymentItem({ payment }: { payment: PaymentRow }) {
  const plan = findPlan(payment.plan_id);
  const status = STATUS_LABEL[payment.status] ?? STATUS_LABEL.failed;
  // 결제 시각이 없으면(실패) 주문을 만든 시각을 쓴다.
  const at = payment.paid_at ?? payment.created_at;
  const paid = payment.status === "paid";

  return (
    <View className="gap-1.5 border-b border-zinc-100 py-4 dark:border-zinc-800">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <AppText variant="sm" weight="bold" className="text-zinc-900 dark:text-zinc-100">
            멤버십 {plan ? plan.label : payment.plan_id}
          </AppText>
          <View className={["rounded-full px-2 py-0.5", status.box].join(" ")}>
            <AppText variant="11" weight="bold" allowFontScaling={false} className={status.text_}>
              {status.text}
            </AppText>
          </View>
        </View>
        <AppText
          variant="sm"
          weight="bold"
          tabular
          className={
            paid
              ? "text-zinc-900 dark:text-zinc-100"
              : "text-zinc-400 line-through dark:text-zinc-600"
          }
        >
          {formatWon(payment.amount)}
        </AppText>
      </View>

      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          {formatDateTime(at)}
        </AppText>
        {payment.method && (
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
            · {payment.method}
          </AppText>
        )}
        {payment.receipt_url && paid && (
          <>
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" accessibilityElementsHidden>
              ·
            </AppText>
            {/* 영수증은 PG(토스)가 발급한 문서다. 앱 안에 그리지 않고 시스템 브라우저로
                넘긴다 — 결제 수단을 앱에 두는 것이 아니라 이미 끝난 거래의 증빙을 여는 것. */}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="영수증 열기"
              onPress={() => void WebBrowser.openBrowserAsync(payment.receipt_url!).catch(() => {})}
              hitSlop={6}
            >
              <AppText variant="xs" weight="medium" className="text-blue-600 underline dark:text-blue-400">
                영수증
              </AppText>
            </Pressable>
          </>
        )}
      </View>

      {/* 주문번호 — 문의할 때 이 값을 알려야 한다. 선택 가능하게 둔다(웹은 font-mono 지만
          앱에는 번들된 고정폭 글꼴이 없어 tabular-nums 로 자릿수만 고정한다). */}
      <AppText variant="11" tabular selectable className="text-zinc-400 dark:text-zinc-600">
        {payment.order_id}
      </AppText>
    </View>
  );
}
