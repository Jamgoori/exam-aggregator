# 해외 IP 차단 (한국·일본만 허용)

관련 코드: `src/lib/geo-block.ts`(판정) · `src/proxy.ts`(적용) · `src/lib/geo-block.test.ts`

이 장치는 **잘못 만지면 사이트가 통째로 죽거나, 검색 유입이 통째로 끊긴다.** 손대기
전에 이 문서를 끝까지 읽을 것.

## 켜고 끄기

기본값은 **꺼짐**이다. 코드가 배포되는 것만으로는 아무도 막히지 않는다.
Vercel → Settings → Environment Variables 에서 켠다.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `GEO_BLOCK` | (없음 = 꺼짐) | `on` 이어야 켜진다. 끌 때는 `off` 또는 삭제 |
| `GEO_BLOCK_COUNTRIES` | `KR,JP` | 허용 국가(ISO 3166-1 alpha-2). 쉼표 구분 |
| `GEO_BLOCK_BYPASS_TOKEN` | (없음) | 우회 토큰. 안 넣으면 우회 수단이 아예 없다 |

**환경변수를 바꾼 뒤에는 재배포해야 반영된다.** proxy 는 Edge 에서 도는 코드라
`process.env` 가 빌드 시점에 박힌다. 사고가 나서 급히 꺼야 할 때 "값만 바꾸고
기다리는" 실수를 하지 말 것 — Vercel 대시보드에서 Redeploy 까지 눌러야 한다.

프리뷰 배포(`VERCEL_ENV=preview`)에서는 켜져 있어도 동작하지 않는다. 프리뷰는 밖에서
열어 확인하는 자리라(코드 리뷰·에이전트·모바일 확인), 여기까지 막으면 확인할 방법이
없어진다.

## 무엇이 막히고 무엇이 안 막히나

막힌다: 허용 국가 밖에서 온 **일반 페이지 요청**. 403 + 안내 화면(`noindex`).

막지 않는다 (전부 `geo-block.test.ts` 가 고정한다):

1. **검색엔진·SNS 크롤러** — UA 로 판정. Googlebot·Bingbot·Yeti(네이버)·Daum·
   Applebot·DuckDuckBot·facebookexternalhit·Twitterbot·Slackbot·kakaotalk-scrap 등.
   Googlebot 은 미국 IP 에서 온다. **이 예외가 빠지면 색인이 통째로 사라진다**
   (403 이 계속 나가면 구글은 그 URL 을 색인에서 내린다). 반대로 Ahrefs·Semrush·
   MJ12 같은 SEO 수집 봇은 일부러 뺐다 — 유입에 기여하지 않으면서 사이트를 통째로
   긁어 가는 쪽이라, 이 차단이 걸러 주기를 바라는 대상이다.
2. **돈·로그인 경로** — `/payments/**`(결제창 복귀), `/auth/**`(소셜 로그인 콜백),
   `/api/**`(토스 웹훅, Vercel 크론). 결제 승인 리다이렉트를 막으면 "돈은 빠졌는데
   멤버십은 안 켜진" 주문이 그대로 남는다.
3. **설비 파일** — `robots.txt`·`sitemap.xml`·`rss.xml`·manifest·favicon·
   `opengraph-image` 등. (앞의 셋은 proxy `matcher` 의 확장자 제외로 애초에 판정까지
   오지도 않는다.)
4. **앱 심사·딥링크 검증 경로** — `/terms`·`/privacy`·`/account/delete-request`
   (INFRA_FILES), `/.well-known/**`(INFRA_DIRS), `/app-ads.txt`. App Review 는 미국,
   Play 심사자는 해외 IP 에서 약관·개인정보처리방침·계정 삭제 안내 URL(Google Play
   데이터 안전 섹션에 적는 웹 링크)을 직접 열어 보므로 403 이면 심사가 반려된다.
   `/.well-known/apple-app-site-association`·`assetlinks.json` 은 Apple/Google 의 검증
   CDN 이 읽는다 — 막히면 유니버설 링크·앱 링크가 조용히 꺼진다. `.txt` 는 matcher 가
   이미 제외하지만 `ads.txt` 와 같은 이유로 판정에도 남긴다. 전부 로그인·개인정보가
   없는 공개 문서·설비 파일이라 국가와 무관하게 내준다.
5. **국가를 모르는 요청** — 로컬 개발, Vercel 이 아닌 호스팅, IP 를 못 알아낸 요청.
   판정 근거가 없을 때 막는 쪽으로 기울면 배포처를 옮기는 날 사이트가 조용히 닫힌다.
6. **우회 토큰을 가진 요청** — 아래.

## 우회 토큰 (코딩 에이전트·모니터링·해외 체류)

`GEO_BLOCK_BYPASS_TOKEN` 을 설정하면 세 가지 방법으로 통과한다.

```bash
curl -H "x-geo-bypass: <토큰>" https://gongmoa.kr/          # 자동화·에이전트
open "https://gongmoa.kr/?geo_bypass=<토큰>"                 # 사람 (쿠키로 옮겨 심는다)
```

쿼리로 한 번 열면 30일짜리 httpOnly 쿠키(`geo_bypass`)가 심기고 그 뒤로는 주소에
토큰을 달지 않아도 된다(토큰이 Referer 로 새는 것도 막는다).

GitHub Actions 의 **도메인 점검** 워크플로는 러너가 미국 IP 라 차단 대상이다. 저장소
Secrets 에 `GEO_BYPASS_TOKEN`(같은 값)을 넣어 두면 헤더로 통과한다. 안 넣으면 차단을
켠 순간부터 이 점검이 전부 ❌ 로 뜬다.

## 알고 있는 한계 — 켜기 전에 합의해야 할 것

- **UA 는 위조할 수 있다.** `User-Agent: Googlebot` 을 달면 누구나 통과한다. 이건
  버그가 아니라 교환이다 — 검색 유입을 지키려면 크롤러를 통과시켜야 하고, 크롤러를
  IP 로 검증하려면 역방향 DNS 조회가 필요한데 proxy 에서는 못 한다. 이 장치의 목적은
  "완벽한 접근 통제"가 아니라 **해외 트래픽·크롤링 비용을 줄이는 것**이다. 작정한
  상대를 막아야 한다면 국가 차단이 아니라 다른 수단이 필요하다.
- **해외에 있는 진짜 사용자도 막힌다.** 유학·출장·해외 거주 중인 유료 회원, 국내
  통신사인데 해외 IP 로 잡히는 경우(일부 알뜰폰·기업 VPN·회사 프록시)가 실제로 있다.
  차단 화면에 문의 메일을 넣어 뒀지만, 결제한 사람이 못 들어오는 상황은 그 자체로
  분쟁 소지가 있다. 켠 뒤 며칠은 문의를 살펴볼 것.
- **모바일 앱은 이 차단과 무관하다.** 앱은 웹을 거치지 않고 Supabase 와 Edge
  Functions 를 직접 부른다. 앱까지 막으려면 Edge Function 쪽에 따로 넣어야 한다.

## 확인 방법

```bash
npm test --workspace @gongmoa/web     # geo-block.test.ts 포함
```

배포 뒤 실제 동작은 국가 헤더를 흉내 낼 수 없어 밖에서 확인해야 한다. 해외 VPN 으로
접속해 403 이 뜨는지, 그 상태에서 `?geo_bypass=<토큰>` 으로 열리는지, 그리고
Search Console → URL 검사 → **실제 URL 테스트**로 구글이 여전히 200 을 받는지
(이게 가장 중요하다) 확인한다.
