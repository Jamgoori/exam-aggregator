// 구조화 데이터(JSON-LD)를 <script type="application/ld+json">로 심는 헬퍼.
//
// dangerouslySetInnerHTML을 쓰는 이유: React가 자식 텍스트를 렌더링하면 따옴표 등이
// HTML 엔티티로 이스케이프돼 JSON이 깨지고 크롤러가 파싱에 실패한다. 대신 삽입되는
// 값은 우리 DB에서 온 문자열이므로, </script>로 스크립트 태그를 탈출시키는 것만
// 막아준다.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
