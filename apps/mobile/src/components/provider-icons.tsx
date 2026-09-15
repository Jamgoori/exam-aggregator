import Svg, { Path } from "react-native-svg";

// 웹 google-icon.tsx / kakao-icon.tsx 의 패스를 react-native-svg 로.
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" accessible={false}>
      <Path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.98v2.33A9 9 0 0 0 9 18Z" />
      <Path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.05l2.99-2.33Z" />
      <Path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.95l2.99 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </Svg>
  );
}

// 카카오 심볼(말풍선). 브랜드 가이드: 노란 배경(#FEE500) 위 검정(투명도 90%).
export function KakaoIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" accessible={false}>
      <Path
        fill="#000000"
        fillOpacity={0.9}
        d="M9 1.5c-4.42 0-8 2.83-8 6.32 0 2.24 1.48 4.2 3.7 5.32l-.94 3.46c-.08.3.26.55.53.38l4.13-2.73c.19.01.38.02.58.02 4.42 0 8-2.83 8-6.45C17 4.33 13.42 1.5 9 1.5Z"
      />
    </Svg>
  );
}
