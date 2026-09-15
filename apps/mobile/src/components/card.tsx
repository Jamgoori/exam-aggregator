import { LinearGradient } from "expo-linear-gradient";
import { Pressable, View, type ViewProps } from "react-native";
import { AppText } from "./app-text";
import { useIsDark } from "../theme";

// 카드 클래스군(설계서 §4.5 #5). 카드 `rounded-xl border border-zinc-200 p-4`,
// 섹션 카드 `rounded-2xl` + from-blue-50 to-white 헤더, 틴트 카드(blue/violet/amber),
// 스탯 타일 `min-w-[7rem] rounded-xl border px-4 py-3`.
export function Card({
  className,
  onPress,
  children,
  ...rest
}: ViewProps & { onPress?: () => void; children?: React.ReactNode }) {
  const cls = [
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900",
    onPress ? "active:border-blue-300 active:shadow-sm" : "",
    className ?? "",
  ].join(" ");
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} className={cls} hitSlop={4}>
        {children}
      </Pressable>
    );
  }
  return (
    <View {...rest} className={cls}>
      {children}
    </View>
  );
}

export function SectionCard({
  title,
  description,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const dark = useIsDark();
  return (
    <View
      className={[
        "overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        className ?? "",
      ].join(" ")}
    >
      <LinearGradient
        colors={dark ? ["rgba(2,44,34,0.35)", "rgba(24,24,27,0)"] : ["#ecfdf5", "#ffffff"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-row items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800"
      >
        {icon}
        <View className="min-w-0 flex-1">
          <AppText variant="base" weight="bold">
            {title}
          </AppText>
          {description && (
            <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-400" pretty>
              {description}
            </AppText>
          )}
        </View>
        {action}
      </LinearGradient>
      <View className="px-5 py-4">{children}</View>
    </View>
  );
}

const TINT: Record<"blue" | "violet" | "amber", string> = {
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  violet: "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
};

export function TintCard({
  tone = "blue",
  dashed = false,
  className,
  children,
}: {
  tone?: keyof typeof TINT;
  dashed?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      className={["rounded-2xl border p-4", dashed ? "border-dashed" : "", TINT[tone], className ?? ""].join(" ")}
    >
      {children}
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <View
      className={[
        "min-w-[7rem] rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900",
        className ?? "",
      ].join(" ")}
    >
      <AppText variant="11" weight="medium" className="text-zinc-500 dark:text-zinc-400">
        {label}
      </AppText>
      <AppText variant="xl" weight="bold" tabular className="mt-0.5">
        {String(value)}
      </AppText>
      {hint && (
        <AppText variant="11" className="mt-0.5 text-zinc-400 dark:text-zinc-500">
          {hint}
        </AppText>
      )}
    </View>
  );
}
