// 문제지의 공개 주소(slug) 규칙 — 웹·모바일 공유(순수 함수).
//
// /papers/56b5235d-58d2-43a9-... 처럼 UUID 를 주소로 쓰면 주소 자체가 아무 말도
// 하지 않는다. 검색 결과에 뜨는 주소 줄에도, 카톡으로 링크를 받은 사람에게도
// "2021 국회직 8급 국어"라고 읽히는 편이 낫다.
//
// **DB 컬럼이 아니라 계산으로 만든다.** 홈은 문제지 3,800장을 통째로 클라이언트에
// 보내 브라우저에서 검색하는 구조라(paper-search.ts 의 PaperWire), 행마다 slug
// 문자열을 하나 더 실으면 전송량이 40% 가까이 는다. 제목과 회차는 이미 실어
// 보내고 있으므로, 양쪽이 이 함수로 같은 주소를 계산하면 전송량이 전혀 늘지 않는다.
//
// 이 규칙이 성립하는 근거(2026-08-12 실측, 3,790건 전수 검사):
//   - (title, round) 가 전 행에서 유일하다.
//   - 제목에 하이픈·슬래시가 들어간 행이 하나도 없다.
//   - exam_papers 를 UPDATE 하는 코드 경로가 없다 — 업로드 후 제목이 바뀌지 않으므로
//     한 번 만들어진 주소는 변하지 않는다.
// 셋 중 하나라도 깨지면 주소가 겹치거나 조용히 바뀐다. 제목을 고치는 기능을
// 새로 만든다면 그때는 slug 를 DB 에 저장하는 쪽으로 옮겨야 한다.

/** 문자·숫자만 남기고 나머지는 전부 하이픈으로. 한글은 그대로 둔다. */
function slugifyText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * 문제지 주소. 제목을 그대로 쓰되, 제목만으로는 다른 문제지와 구분되지 않는
 * 경우에만 직류(track)와 회차를 덧붙인다.
 *
 * **왜 title 에서 track 을 먼저 떼고 시작하나:** 목록의 중복 통합
 * (collapseDuplicatePapers)이 대표로 남긴 문제지의 title 에서 " (사서서기보)"
 * 같은 접미사를 떼어낸다. 그래서 같은 문제지라도 화면·목록 어디를 거쳐 왔느냐에
 * 따라 title 이 두 가지 모양으로 들어온다. 여기서 한 번 더 떼어내면(이미 떼어진
 * 제목에는 아무 일도 일어나지 않는다) 두 경로가 같은 주소를 계산한다.
 * 떼어낸 track 은 뒤에 따로 붙이므로 직류가 다른 문제지끼리는 여전히 갈린다.
 * 이 처리가 없으면 통합 대표인 "2024 법원직 9급 (사서서기보) 국어"와 원래부터
 * 직류가 없는 "2024 법원직 9급 국어"가 같은 주소를 갖는다(실측된 충돌).
 *
 * **왜 회차를 "round > 1 이면 무조건" 붙이지 않나:** 경찰 문제지는 제목에 이미
 * "공채 2차"가 들어 있어서 그대로 붙이면 `2016-경찰-공채-2차-한국사-2회` 처럼
 * 같은 말이 두 번 나온다. 제목이 이미 회차를 말하고 있으면 생략한다. 한능검은 같은
 * 회차를 "제50회"라고 부르므로("2020 한능검 제50회 심화", round=50) `N차`뿐 아니라
 * `N회`도 함께 본다 — 안 그러면 `2020-한능검-제50회-심화-50회`가 된다.
 */
export function getPaperSlug(
  title: string,
  round: number,
  track?: string | null,
): string {
  const bare = track
    ? title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim()
    : title;

  let slug = slugifyText(bare);
  if (track) slug += `-${slugifyText(track)}`;
  if (round > 1 && !bare.includes(`${round}차`) && !bare.includes(`${round}회`))
    slug += `-${round}회`;
  return slug;
}

/**
 * 주소에서 받은 조각을 slug 표에서 찾을 수 있는 모양(한글 그대로)으로 되돌린다.
 *
 * slug 가 한글이라 링크에는 언제나 퍼센트 인코딩된 모양으로 실린다
 * (`/papers/2018-%EB%B2%95%EC%9B%90%EC%A7%81-9%EA%B8%89-%ED%97%8C%EB%B2%95`).
 * 그런데 Next 가 넘겨주는 `params.id` 는 진입점에 따라 디코딩된 것도 있고 안 된 것도
 * 있다 — 실측(2026-08-13, Next 16.2.9): 같은 요청 안에서도 `generateMetadata` 는
 * "2018-법원직-9급-헌법" 을 받는데 페이지 컴포넌트는 "2018-%EB%B2%95..." 를 받는다.
 * 그래서 페이지 본문만 표에서 못 찾고 `notFound()` 로 빠져, 제목(<title>)은 멀쩡한데
 * 본문만 404 인 화면이 문제지 전체에서 나왔다. 주소가 UUID 이던 시절에는 인코딩할
 * 문자가 없어서 이 차이가 드러나지 않았다.
 *
 * 표의 열쇠는 언제나 디코딩된 한글이므로, 찾기 전에 여기로 한 번 통과시킨다.
 * 디코딩된 slug 에는 `%` 가 남지 않으므로 두 번 디코딩될 걱정은 없다.
 */
export function normalizePaperSlugParam(param: string): string {
  if (!param.includes("%")) return param;
  try {
    return decodeURIComponent(param);
  } catch {
    // 잘못 만들어진 주소(`%zz` 등)는 디코딩이 실패한다. 그대로 돌려주면 표에서
    // 못 찾아 404 가 되는데, 없는 주소라는 뜻이므로 그게 맞는 결과다.
    return param;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 주소 조각이 (옛) UUID 인지. 옛 주소로 들어온 요청을 새 주소로 301 보내야 하는지
 * 판단하는 데 쓴다. slug 는 항상 연도 네 자리로 시작하므로 UUID 와 겹치지 않는다.
 */
export function isPaperUuid(value: string): boolean {
  return UUID_RE.test(value);
}
