import { MEMBERSHIP_FAQ_APP, type MembershipFaqItem } from "@gongmoa/core";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";

// 자주 묻는 질문(웹 membership/page.tsx Faq:476). 항목은 core MEMBERSHIP_FAQ_APP — 결제·환불 문항을
// 뺀 부분집합(설계서 §8.1). 웹 <details> → 접기 토글, 오른쪽 "+" 는 펼치면 45° 회전.
export function MembershipFaq({ items = MEMBERSHIP_FAQ_APP }: { items?: readonly MembershipFaqItem[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <FaqRow key={item.q} item={item} last={i === items.length - 1} />
      ))}
    </View>
  );
}

function FaqRow({ item, last }: { item: MembershipFaqItem; last: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View className={["py-3", last ? "" : "border-b border-zinc-100 dark:border-zinc-800"].join(" ")}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between gap-3"
      >
        <AppText variant="sm" weight="bold" className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200" pretty>
          {item.q}
        </AppText>
        <View style={{ transform: [{ rotate: open ? "45deg" : "0deg" }] }}>
          <AppText variant="lg" allowFontScaling={false} className="text-zinc-300 dark:text-zinc-600">
            +
          </AppText>
        </View>
      </Pressable>
      {open && (
        <AppText variant="sm" className="mt-2 leading-6 text-zinc-600 dark:text-zinc-400" pretty>
          {item.a}
        </AppText>
      )}
    </View>
  );
}
