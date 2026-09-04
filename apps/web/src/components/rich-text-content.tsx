// 저장된 게시판 본문(서식 있는 HTML)을 그리는 자리.
//
// dangerouslySetInnerHTML 을 쓰는 유일한 지점이므로 규칙을 여기 못박아둔다:
// **여기에 들어오는 html 은 서버가 sanitizeRichText 를 통과시켜 DB 에 넣은 값이어야
// 한다**(app/board/actions.ts). 사용자가 방금 입력한 값이나 어딘가에서 받아온 HTML 을
// 그대로 이 컴포넌트에 넘기지 말 것 — 그 순간 저장형 XSS 가 된다.
//
// 스타일(.board-content)은 에디터와 공유한다(globals.css) — 쓰는 동안 보이는 모습과
// 올린 뒤의 모습이 달라지지 않게.
export function RichTextContent({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={`board-content text-[15px] leading-7 text-zinc-700 dark:text-zinc-200 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
