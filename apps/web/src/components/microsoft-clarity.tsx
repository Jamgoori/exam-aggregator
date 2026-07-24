import Script from "next/script";

// GA4와 연동하면(Clarity 대시보드 Setup > Google Analytics) 세션 리플레이 링크가
// GA4 이벤트에 커스텀 파라미터로 붙어서, GA에서 특이 행동을 보인 사용자를 바로
// Clarity 녹화 화면으로 넘어가 볼 수 있다 — 이건 대시보드 설정이라 코드 변경은 필요 없음.
export function MicrosoftClarity({ projectId }: { projectId: string }) {
  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {`
        (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${projectId}");
      `}
    </Script>
  );
}
