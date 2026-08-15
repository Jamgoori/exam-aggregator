# 공모아 모노레포

공무원 기출문제 자료실. 웹 + 모바일이 같은 Supabase 백엔드를 쓰고, 공유 로직은
`packages/core` 한 곳에 둔다.

```
apps/web/        Next.js 웹앱 (SSR·SEO·관리자). 배포: Vercel
apps/mobile/     Expo(React Native) 앱. 배포: EAS
packages/core/   @gongmoa/core — 웹·모바일 공유(타입·순수로직·DI 데이터접근)
supabase/        Edge Functions + schema.sql
```

npm workspaces + Turborepo. 상세 규칙은 `apps/web/AGENTS.md`, `apps/mobile/README.md`.
코드 밖 작업 중 사업자등록·업종코드·세무는 `BUSINESS.md`.

## 개발

```bash
npm install              # 루트에서 (워크스페이스 전체 설치)
npm run web              # 웹 dev 서버 (localhost:3000)
npm run mobile           # 모바일 Metro (Expo)
npm run typecheck        # 전체 타입체크 (turbo)
```

공유 코어는 `@gongmoa/core` 로 import. TS 소스 그대로 배포되며 Next 는
`transpilePackages`, Metro 는 `apps/mobile/metro.config.js` 로 번들한다.

## 배포

### 웹 (Vercel) — 모노레포 전환 시 1회 필수
Vercel 프로젝트 **Settings → Build & Deployment → Root Directory** 를 **`apps/web`**
로 설정. (이 저장소를 모노레포로 바꾸기 전엔 루트였음 — 안 바꾸고 push 하면 빌드가
`next` 를 못 찾아 배포 실패.) 설정 후 평소처럼 push → 자동 배포.

검증됨: `apps/web` 에서 `npx next build` 성공.

#### 도메인 — `gongmoa.kr` (등록처 yesnic, 2031/08/07 만료)

코드상 정본 주소는 `apps/web/src/lib/site-url.ts` 의 `PRODUCTION_URL` 하나다.
Vercel 위(`process.env.VERCEL`)에서는 프리뷰 배포까지 이 값을 canonical·sitemap·
robots·OG 이미지에 쓴다 — 프리뷰 주소가 검색에 중복 색인되지 않게 하려는 것.
도메인을 바꿀 일이 생기면 이 상수를 고치거나, 임시로는 `NEXT_PUBLIC_SITE_URL`
환경변수로 덮어쓴다.

연결 절차(코드 밖 작업, 순서대로):

1. **Vercel** — 프로젝트 Settings → Domains 에 `gongmoa.kr` 과 `www.gongmoa.kr`
   추가. Vercel 이 화면에 띄우는 DNS 레코드 값(apex 용 A 레코드 IP, www 용 CNAME
   대상)을 그대로 복사한다. **문서에 적힌 옛 IP 를 외워 쓰지 말 것** — Vercel 이
   바꿔 왔다.
2. **yesnic DNS** — 두 방법 중 하나.
   - 레코드만 추가: yesnic 도메인 관리(네임서버는 `dns1~4.yesnic.com` 그대로) 의
     DNS 레코드에 1번에서 복사한 A(호스트 `@`)·CNAME(호스트 `www`) 을 넣는다.
   - 또는 네임서버 자체를 Vercel 것으로 변경(`네임서버 변경` 메뉴). DNS 를 Vercel
     한 곳에서 관리하게 되지만 메일·다른 레코드도 같이 옮겨야 한다.
   전파는 보통 수십 분, `.kr` 은 최대 24시간. `dig gongmoa.kr` 로 확인.
3. **Vercel** — 두 도메인 중 `gongmoa.kr` 을 Primary 로, `www` 는 redirect 로 둔다
   (둘 다 200 을 주면 같은 문서가 두 주소로 색인된다). HTTPS 인증서는 자동 발급.
   이 설정이 빠져도 `apps/web/next.config.ts` 의 host 매칭 redirect 가 `www` 를
   apex 로 넘긴다 — 대시보드 설정은 그래도 해두는 게 낫다(앱까지 안 오고 끝난다).
4. **Supabase** — Authentication → URL Configuration 의 Site URL 을
   `https://gongmoa.kr`, Redirect URLs 에 `https://gongmoa.kr/**` 추가. 안 하면
   새 도메인에서 소셜 로그인이 끝에서 튕긴다(로그인 콜백은 요청 호스트를 그대로
   쓴다 — `apps/web/src/app/actions.ts` 의 `getOrigin`).
5. **소셜 로그인 콘솔** — Google Cloud OAuth 클라이언트의 승인된 자바스크립트
   원본, Kakao 앱의 사이트 도메인에 `https://gongmoa.kr` 추가.
6. **Search Console / GA** — 새 속성(도메인 속성)으로 `gongmoa.kr` 등록 후
   `https://gongmoa.kr/sitemap.xml` 제출. 예전 `*.vercel.app` 주소가 이미 색인돼
   있으면 vercel.app 은 redirect 로 남겨 두면 정리된다.
7. **모바일** — `apps/mobile/.env` 의 `EXPO_PUBLIC_WEB_URL` 을 `https://gongmoa.kr`
   로. GitHub Actions 쪽은 시크릿이 비어 있으면 이 값을 기본으로 쓰므로 따로
   등록하지 않아도 된다(다른 도메인을 쓸 때만 시크릿으로 덮어쓴다).

연결이 끝났는지는 **Actions → "도메인 점검" → Run workflow** 로 확인한다(폰에서도
된다). apex 200·`www` 리다이렉트·홈 canonical·robots.txt·sitemap 을 밖에서 실제로
찔러보고 어디가 틀렸는지 요약에 남긴다. 주 1회 자동으로도 돌아 설정이 되돌아가거나
인증서가 만료되면 잡힌다.

아직 남은 것(값이 있어야 가능): 웹 주소로 앱이 열리는 딥링크. Apple Team ID 와
안드로이드 서명 인증서 SHA-256 이 필요해 `apps/mobile/SETUP.md` 5-1 절차대로
따로 해야 한다.

#### 루트 `optionalDependencies` 는 지우지 말 것

루트 `package.json` 의 `optionalDependencies`(lightningcss / @tailwindcss/oxide /
sharp 의 `linux-x64` 네이티브 바이너리)는 Vercel 빌드용이다. npm 은 이런 플랫폼별
optional 의존성을 **락 파일을 만든 컴퓨터의 플랫폼 것만** 기록한다 — Windows 에서
`npm install` 을 돌리면 `package-lock.json` 에 `win32` 바이너리만 남고, 리눅스인
Vercel 은 설치할 게 없어서 빌드가 이렇게 깨진다:

```
Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
```

빌드 캐시가 있는 동안엔 안 드러나고, 캐시가 비는 순간(`Previous build caches not
available`) 터진다. 루트에 명시해 두면 어느 플랫폼에서 락을 만들든 리눅스 바이너리가
남는다. 버전은 상위 패키지가 쓰는 것과 **정확히 같아야** 하므로, tailwind 나
lightningcss 를 올릴 때 이 세 줄도 같이 올릴 것.

### 모바일 (EAS)
네이티브 SDK(카카오·구글 로그인)라 Expo Go 불가 — dev build 필요.

```bash
cd apps/mobile
npx eas build --profile development --platform android   # 또는 ios
```

EAS 는 npm workspaces 모노레포를 자동 감지한다(cli >= 12). 선행:
- `app.json` 의 `PLACEHOLDER_REVERSED_CLIENT_ID`(iOS 구글) 를 실제 값으로.
- Kakao/Google 콘솔 키·Supabase OAuth provider 설정 (apps/mobile/README.md 참고).

검증됨: `npx expo export` 로 Metro 번들(공유 코어 포함) 성공. 단, 네이티브 빌드·실기기
테스트는 미실행(EAS 클라우드 빌드 필요).
