import { Platform, Text, type TextProps } from "react-native";

// 앱의 모든 글자(설계서 §4.2). 시스템 폰트 — 특정 글꼴명을 지정하지 않는다(iOS Apple SD
// Gothic Neo, Android 는 OEM 기본값). 웹 text-* 값을 lineHeight 까지 그대로 쓰고, Android 는
// includeFontPadding:false + textAlignVertical:'center' 로 CJK 줄높이가 늘어나 배지·칩 높이가
// 어긋나는 것을 막는다.
export type TextVariant =
  | "xs"
  | "sm"
  | "base"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "10"
  | "11"
  | "13"
  | "15"
  | "26"
  | "27";

export type TextWeight = "normal" | "medium" | "semibold" | "bold" | "extrabold";

const VARIANT_CLASS: Record<TextVariant, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  // 홈 히어로 h1(웹 text-4xl leading-[1.15] = 36/41.4px).
  "4xl": "text-4xl leading-[41px]",
  "10": "text-[10px] leading-[14px]",
  "11": "text-[11px] leading-4",
  "13": "text-[13px] leading-5",
  "15": "text-[15px] leading-[22px]",
  // 진단 섹션·소개 h1(웹 text-[1.625rem]/text-[26px] leading-tight = 26/32.5px).
  "26": "text-[26px] leading-8",
  "27": "text-[27px] leading-8",
};

const WEIGHT_CLASS: Record<TextWeight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
  extrabold: "font-extrabold",
};

// className 에 글자색이 없으면 웹 body 색(--foreground)을 준다.
const HAS_TEXT_COLOR =
  /(^|\s)(dark:)?text-(?!(xs|sm|base|lg|xl|\dxl|\[\d|left|center|right|justify|pretty|balance|nowrap|wrap|ellipsis|clip)\b)/;

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  weight?: TextWeight;
  // fontVariant tabular-nums — 타이머·점수처럼 자리가 흔들리면 안 되는 숫자.
  tabular?: boolean;
  // 웹 break-keep: 한글 단어 중간에서 줄이 끊기지 않게.
  pretty?: boolean;
};

export function AppText({
  variant = "base",
  weight,
  tabular,
  pretty,
  className,
  style,
  maxFontSizeMultiplier = 1.3,
  ...rest
}: AppTextProps) {
  const color = className && HAS_TEXT_COLOR.test(className) ? "" : "text-foreground";
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      lineBreakStrategyIOS={pretty ? "hangul-word" : rest.lineBreakStrategyIOS}
      textBreakStrategy={pretty ? "highQuality" : rest.textBreakStrategy}
      className={[VARIANT_CLASS[variant], weight ? WEIGHT_CLASS[weight] : "", color, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={[
        Platform.OS === "android" ? { includeFontPadding: false, textAlignVertical: "center" } : null,
        tabular ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
    />
  );
}
