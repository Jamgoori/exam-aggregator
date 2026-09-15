import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { Pressable } from "react-native";
import { AppText } from "./app-text";

// "지금 보고 있던 페이지로 돌아가기"용 next 를 붙인 로그인 링크(웹 login-link.tsx).
// pathname 에 쿼리가 안 붙으므로 params 를 다시 조립한다(?tab= 유지).
export function useCurrentHref(): string {
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v) usp.set(k, v);
  }
  const qs = usp.toString();
  return `${pathname || "/"}${qs ? `?${qs}` : ""}`;
}

export function loginHref(next: string): string {
  return `/login?next=${encodeURIComponent(next || "/")}`;
}

export function LoginLink({
  className,
  textClassName,
  onPress,
  label = "로그인",
}: {
  className?: string;
  textClassName?: string;
  // 드로어처럼 "누르면 닫아야 하는" 자리에서 쓴다.
  onPress?: () => void;
  label?: string;
}) {
  const current = useCurrentHref();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        onPress?.();
        router.push(loginHref(current));
      }}
      className={className}
    >
      <AppText variant="sm" weight="bold" className={textClassName ?? "text-white"}>
        {label}
      </AppText>
    </Pressable>
  );
}
