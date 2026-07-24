// 카카오 심볼(말풍선). 카카오 브랜드 가이드에 따라 노란 배경(#FEE500) 버튼 위에
// 검정(#000000, 투명도 90%) 심볼로 쓴다.
export function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#000000"
        fillOpacity="0.9"
        d="M9 1.5c-4.42 0-8 2.83-8 6.32 0 2.24 1.48 4.2 3.7 5.32l-.94 3.46c-.08.3.26.55.53.38l4.13-2.73c.19.01.38.02.58.02 4.42 0 8-2.83 8-6.45C17 4.33 13.42 1.5 9 1.5Z"
      />
    </svg>
  );
}
