import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPaperSlug,
  isPaperUuid,
  normalizePaperSlugParam,
} from "./paper-slug";

// 이 규칙이 만드는 주소는 검색엔진에 색인되고 사람들이 링크로 주고받는 값이라,
// 한 번 정한 뒤에는 바뀌면 안 된다. 아래는 "이렇게 나와야 한다"를 못박아둔 것이다 —
// 규칙을 고치면 이미 색인된 주소가 통째로 404 가 된다는 뜻이므로, 여기가 깨지면
// 규칙이 아니라 의도를 먼저 다시 확인할 것.

test("제목을 그대로 주소로 쓴다 (한글 유지, 공백은 하이픈)", () => {
  assert.equal(getPaperSlug("2021 국회직 8급 국어", 1), "2021-국회직-8급-국어");
  assert.equal(
    getPaperSlug("2018 국가직 7급 전기기기", 1),
    "2018-국가직-7급-전기기기",
  );
});

test("직류(track)는 제목에서 떼어 뒤에 붙인다 — 서로 다른 직류는 갈려야 한다", () => {
  assert.equal(
    getPaperSlug("2024 법원직 9급 (사서서기보) 한국사", 1, "사서서기보"),
    "2024-법원직-9급-한국사-사서서기보",
  );
  assert.notEqual(
    getPaperSlug("2024 법원직 9급 (사서서기보) 한국사", 1, "사서서기보"),
    getPaperSlug("2024 법원직 9급 (전산서기보) 한국사", 1, "전산서기보"),
  );
});

test("중복 통합이 title에서 track을 떼어낸 뒤에도 같은 주소가 나온다", () => {
  // collapseDuplicatePapers는 통합 대표의 title에서 " (사서서기보)"를 떼어낸다.
  // 그래서 같은 문제지가 목록을 거쳤는지에 따라 두 가지 title로 들어온다 —
  // 둘이 다른 주소를 내면 목록의 링크와 정본 주소가 어긋난다.
  assert.equal(
    getPaperSlug("2024 법원직 9급 (사서서기보) 국어", 1, "사서서기보"),
    getPaperSlug("2024 법원직 9급 국어", 1, "사서서기보"),
  );
});

test("통합 대표와 원래 직류 없는 문제지가 같은 주소를 갖지 않는다", () => {
  // 실측된 충돌: 두 행이 서로 다른 문제지인데 사이트맵에 같은 URL로 두 번 실렸다.
  assert.notEqual(
    // 통합 대표 (title에서 track이 떨어진 상태)
    getPaperSlug("2024 법원직 9급 국어", 1, "사서서기보"),
    // 원래부터 직류가 없는 별개 문제지
    getPaperSlug("2024 법원직 9급 국어", 1, null),
  );
});

test("1회차는 접미사를 붙이지 않는다", () => {
  assert.equal(
    getPaperSlug("2017 국가직 9급 국어", 1),
    "2017-국가직-9급-국어",
  );
});

test("같은 제목이 회차만 다를 때만 회차를 붙여 구분한다", () => {
  // 2017 국가직 9급은 추가채용이 있어 같은 제목이 두 벌 있다.
  assert.equal(
    getPaperSlug("2017 국가직 9급 국어", 2),
    "2017-국가직-9급-국어-2회",
  );
  assert.notEqual(
    getPaperSlug("2017 국가직 9급 국어", 1),
    getPaperSlug("2017 국가직 9급 국어", 2),
  );
});

test("제목이 이미 회차를 말하고 있으면 또 붙이지 않는다", () => {
  // 경찰은 제목에 "공채 2차"가 들어 있다. 그대로 붙이면 "...-2차-한국사-2회"가 된다.
  assert.equal(
    getPaperSlug("2016 경찰 공채 2차 한국사", 2),
    "2016-경찰-공채-2차-한국사",
  );
  assert.equal(
    getPaperSlug("2023 경찰 공채 3차 형법", 3),
    "2023-경찰-공채-3차-형법",
  );
  // 회차 숫자가 제목의 것과 다르면 생략하지 않는다 (제목의 "1차"는 round=2를 구분해주지 못한다).
  assert.equal(
    getPaperSlug("2017 경찰 공채 1차 수사", 2),
    "2017-경찰-공채-1차-수사-2회",
  );
  // 한능검은 회차를 "제50회"라고 부른다. round=50 을 또 붙이면 "...-제50회-심화-50회".
  assert.equal(
    getPaperSlug("2020 한능검 제50회 심화", 50),
    "2020-한능검-제50회-심화",
  );
  assert.equal(
    getPaperSlug("2026 한능검 제79회 심화", 79),
    "2026-한능검-제79회-심화",
  );
});

test("퍼센트 인코딩된 채로 들어온 주소 조각도 표에서 찾을 수 있는 모양으로 되돌린다", () => {
  // 실측 사고(2026-08-13): 한 요청 안에서도 generateMetadata 는 디코딩된 조각을,
  // 페이지 컴포넌트는 인코딩된 조각을 받았다. 그래서 <title>은 멀쩡한데 본문만
  // notFound() 로 빠져 문제지 상세페이지 전체가 사라졌다.
  assert.equal(
    normalizePaperSlugParam("2018-%EB%B2%95%EC%9B%90%EC%A7%81-9%EA%B8%89-%ED%97%8C%EB%B2%95"),
    "2018-법원직-9급-헌법",
  );
  // 이미 디코딩된 조각은 그대로 (두 번 디코딩되지 않는다).
  assert.equal(
    normalizePaperSlugParam("2018-법원직-9급-헌법"),
    "2018-법원직-9급-헌법",
  );
  assert.equal(
    normalizePaperSlugParam("56b5235d-58d2-43a9-acac-80a29810f9d4"),
    "56b5235d-58d2-43a9-acac-80a29810f9d4",
  );
  // 잘못 만들어진 주소는 던지지 않고 그대로 흘려보낸다 (없는 주소 → 404).
  assert.equal(normalizePaperSlugParam("2018-%zz"), "2018-%zz");
});

test("옛 UUID 주소를 알아본다 (새 주소는 연도로 시작해 겹치지 않는다)", () => {
  assert.equal(isPaperUuid("56b5235d-58d2-43a9-acac-80a29810f9d4"), true);
  assert.equal(isPaperUuid("56B5235D-58D2-43A9-ACAC-80A29810F9D4"), true);
  assert.equal(isPaperUuid("2021-국회직-8급-국어"), false);
  assert.equal(isPaperUuid("2017-국가직-9급-국어-2회"), false);
});
