import { LoaderCircle } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, type PressableProps, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { AppText } from "./app-text";
import { themedIcon } from "../theme/icons";

// 버튼 클래스군(설계서 §4.5 #2). hover 는 없고 pressed = 웹 active 값. pending 이면
// lucide Loader2(=LoaderCircle) 15 회전, disabled 는 opacity-50.
export type ButtonVariant = "primary" | "outline" | "tinted" | "danger" | "neutralDark" | "small" | "icon";

const VARIANT: Record<ButtonVariant, { box: string; text: string }> = {
  primary: {
    box: "rounded-xl bg-blue-600 py-2.5 px-4 active:bg-blue-700",
    text: "text-sm font-bold text-white",
  },
  outline: {
    box: "rounded-xl border border-zinc-300 bg-white py-2.5 px-4 active:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:active:bg-zinc-800",
    text: "text-sm font-semibold text-zinc-700 dark:text-zinc-200",
  },
  tinted: {
    box: "rounded-xl border border-blue-200 bg-blue-50 py-2.5 px-4 active:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40",
    text: "text-sm font-semibold text-blue-700 dark:text-blue-300",
  },
  danger: {
    box: "rounded-xl bg-red-600 py-2.5 px-4 active:bg-red-700",
    text: "text-sm font-bold text-white",
  },
  neutralDark: {
    box: "rounded bg-zinc-800 py-1.5 px-4 active:bg-zinc-700 dark:bg-zinc-700 dark:active:bg-zinc-600",
    text: "text-xs font-medium text-white",
  },
  small: {
    box: "rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 active:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40",
    text: "text-xs font-medium text-blue-700 dark:text-blue-300",
  },
  icon: {
    box: "h-9 w-9 rounded-full active:bg-zinc-100 dark:active:bg-zinc-800",
    text: "",
  },
};

const Spinner = themedIcon(LoaderCircle);

export function PendingSpinner({ size = 15, colorClassName = "text-white" }: { size?: number; colorClassName?: string }) {
  const rotate = useSharedValue(0);
  useEffect(() => {
    rotate.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
  }, [rotate]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Spinner size={size} colorClassName={colorClassName} />
    </Animated.View>
  );
}

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  variant?: ButtonVariant;
  label?: string;
  pending?: boolean;
  // 라벨 앞 아이콘(아이콘 전용 버튼은 label 없이 icon 만).
  icon?: React.ReactNode;
  className?: string;
  textClassName?: string;
  children?: React.ReactNode;
};

export function Button({
  variant = "primary",
  label,
  pending = false,
  icon,
  disabled,
  className,
  textClassName,
  children,
  accessibilityRole = "button",
  ...rest
}: ButtonProps) {
  const v = VARIANT[variant];
  const inactive = !!disabled || pending;
  const spinnerColor =
    variant === "primary" || variant === "danger" || variant === "neutralDark"
      ? "text-white"
      : "text-blue-600 dark:text-blue-400";
  return (
    <Pressable
      {...rest}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: inactive, busy: pending }}
      disabled={inactive}
      className={[
        "flex-row items-center justify-center gap-1.5",
        v.box,
        inactive ? "opacity-50" : "",
        className ?? "",
      ].join(" ")}
    >
      {pending ? <PendingSpinner colorClassName={spinnerColor} /> : icon}
      {label != null && (
        <AppText className={[v.text, textClassName ?? ""].join(" ")} allowFontScaling={variant !== "icon"}>
          {label}
        </AppText>
      )}
      {children != null && <View className="flex-row items-center gap-1.5">{children}</View>}
    </Pressable>
  );
}
