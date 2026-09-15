# 앱 금지선 (문서 안 읽었어도 이것만은 절대)

정본은 `docs/redesign-architecture.md`(§5 화면 맵, §6.1·§6.5 데이터 규칙, §8.4 광고,
§10 AGENTS.md 항목). 웹 쪽 규칙은 `../web/AGENTS.md`, 웹↔앱 파리티 절차는
`../web/docs/agents/mobile-parity.md`. 두 문서가 어긋나면 설계서를 따른다.

앱은 규칙을 **실행하지 않고 결과를 그린다.** 규칙은 Postgres(RLS·RPC·트리거)·Edge Function·
Next 서버 액션에만 있고, 앱은 `packages/core` 의 순수 표시 계산만 쓴다.

- **정답·해설·멤버십을 디스크에 남기지 말 것.** `correctChoice`, 채점된 `questionResults`,
  `own_wrong_answers` 결과, 해설 본문, 제출 전·후 복습 세션 항목, 멤버십 행·결제 raw·`is_admin`
  결과, 진단 리포트 본문은 메모리 쿼리캐시에만(`meta.persist:false` + persister
  `shouldDehydrateQuery`). 앱 재시작 시 사라져야 정상이다. 해설은 복사 방지와 3편/일 쿼터의
  의미가, 정답은 RLS 차단의 의미가 디스크에 남는 순간 없어진다.
- **CBT·복습·PDF 화면에 광고 금지.** `/papers/[id]/cbt`, `/mypage/wrong-notes/*/review/*`,
  mix 솔버, PDF 뷰어, OMR 시트, 결과 모달 근처에 광고 자리를 만들지 말 것 — 오클릭은 무효
  트래픽이고 무효 트래픽은 경고 없이 계정 정지다. 앱 오픈·전면·보상형 광고도 쓰지 않는다.
  광고 자리는 웹과 같은 세 곳(`home`, `papersList`, `paperDetail`)뿐. 관리자 계정은 항상 제외.
- **`@gongmoa/core/server` import 금지.** ESLint `no-restricted-imports` 가 막는다 — 규칙을
  우회해 import 하지 말 것. service_role 규칙이 앱 번들에 들어가면 안 된다. 앱은 `@gongmoa/core`
  (순수 로직·타입·`data/*` DI 리포지토리·`edge/*` 계약)만 쓴다.
- **`GEO_BLOCK_BYPASS_TOKEN` 을 번들·OTA·링크·`.env` 에 싣지 말 것.** JS 번들은 추출된다.
  앱이 웹 도메인을 부르는 경로는 `/terms`·`/privacy`(인앱 브라우저)·`/api/app/config`·
  `/.well-known/*`(OS)·`/app-ads.txt`(AdMob 크롤러) 다섯 개뿐이고 전부 geo-block 면제 목록에
  있다. 그 외 웹 URL 을 앱에서 fetch 하지 말 것 — 필요하면 면제 목록부터
  (`../web/docs/agents/geo-block.md`).
- **`memberships` 를 직접 UPDATE 하지 말 것.** 체험 시작은 EF `membership-get` 안에서만
  `start_trial_if_eligible` RPC 를 부른다. 앱은 `membership-get` 을 호출할 뿐이다.
- **`start_trial_if_eligible` 을 앱에서 직접 호출하지 말 것.** service_role 전용 RPC 라 앱
  세션으로는 거부되고(42501), 우회하려고 정책을 열면 탈퇴 후 재가입 체험 재부여 사고가 난다
  (`trial_consumptions` 원장 규칙, `../web/AGENTS.md` "무료 체험 시작").
- **웹 `/download/*` 를 호출하지 말 것.** 로그인 리다이렉트·봇 필터·geo-block 대상이라 앱
  요청은 집계도 안 되고 막힌다. PDF 는 Storage 공개 URL 을 `react-native-pdf` 에 직접 준다.
- **`increment_download_count` 는 사용자가 저장·공유 탭을 누른 순간에만.** 뷰어 진입·프리로드·
  캐시 워밍에서 부르지 말 것(다운로드 집계가 뷰어 열람 수로 부풀어 웹과 뜻이 달라진다).
- **직접 쓰지 않는 테이블·버킷**: `memberships`, `user_question_status`, `review_sessions`,
  `paper_answers`, `question_explanations`, `avatars`·`board-images` 버킷. RLS 상 불가능하고
  정책을 열지도 않는다. SRS(`srs_*`)는 앱이 계산·기록하지 않는다.
- **로컬에 권위 있는 상태를 두지 말 것.** 멤버십·응시·SRS·출석은 서버 행이 정본, 앱 캐시는
  표시용 사본. 앱 타이머 기준은 항상 서버 `startedAt`(`MIN_ATTEMPT_SECONDS = 90`, core 상수 —
  앱 안에 상수를 복사하지 말 것).
- **Edge 계약**: 응답 필드는 서버가 추가만 한다. 앱은 모르는 필드를 무시하고, 없는 필드에
  기대지 않는다. 모든 요청에 `x-gongmoa-app-build`·`x-gongmoa-platform` 헤더를 붙인다
  (`createClient` `global.headers`) — 빼면 최소 버전 게이트(426)가 동작하지 않는다.
- **비밀 값**: 앱 번들에는 `EXPO_PUBLIC_*`(publishable 키·클라이언트 ID·웹 URL)만. service_role·
  `ANTHROPIC_*`·`EXPO_TOKEN`·`CRON_SECRET` 은 절대 앱·`.env.example`·채팅에 넣지 말 것
  (`SECURITY.md`).
