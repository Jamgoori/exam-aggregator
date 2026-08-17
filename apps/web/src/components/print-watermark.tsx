// 해설 인쇄(PDF 저장)에 박히는 워터마크. 해설은 약관 제4조로 보호하는 자체 제작
// 콘텐츠인데, 화면의 드래그 차단(select-none)과 달리 인쇄본은 파일로 남아 그대로
// 퍼질 수 있다. 그래서 "누구의 계정에서 나간 PDF인지"를 지면에 남겨 유출을 추적할
// 수 있게 하고, 동시에 뿌리는 것 자체를 망설이게 한다.
//
// 화면에는 절대 보이지 않고(print:block) 인쇄에서만 나타난다. position:fixed 요소는
// 크롬 인쇄에서 페이지마다 다시 그려지므로 전 페이지에 반복된다. 배경색이 아니라
// 글자로 그리는 것도 의도된 선택이다 — 인쇄 옵션의 "배경 그래픽"을 꺼도 글자는
// 그대로 나온다.
//
// 표시 문자열은 identity-label.ts 가 만든다(원본 이메일을 그대로 박지 않는다).

const ROWS = 6;
const PER_ROW = 3;

export function PrintWatermark({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 hidden select-none overflow-hidden print:block"
    >
      <div className="flex h-full w-full flex-col justify-around">
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="flex justify-around">
            {Array.from({ length: PER_ROW }, (_, c) => (
              <span
                key={c}
                className="rotate-[-30deg] whitespace-nowrap text-[9pt] font-semibold text-zinc-400/35"
              >
                {label} · 무단 전재·재배포 금지
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
