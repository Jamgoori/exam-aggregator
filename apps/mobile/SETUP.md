# 집에서 할 일 (순서대로)

앱 코드는 완성. 이제 **콘솔 설정 → 키 채우기 → 백엔드 배포 → 빌드** 순서로 진행하면
실제 폰에서 로그인·CBT·AI 진단까지 동작한다. 위에서부터 차례대로.

각 단계 끝의 `[결과]` 는 다음 단계에서 붙여넣을 값이다. 미리 메모장에 모아두면 편하다.

---

## 0. 코드 받기

앱은 웹과 같은 저장소(`Jamgoori/exam-aggregator`)의 `apps/mobile` 에 있다(예전 별도
저장소 `gongmoa_mobile` 은 쓰지 않는다).

```bash
git clone https://github.com/Jamgoori/exam-aggregator
cd exam-aggregator
npm install               # 루트에서 — 워크스페이스 전체(웹·앱·core·design-tokens) 설치
cd apps/mobile
npx expo-doctor           # 21/21 이어야 한다. 아니면 `npx expo install --fix`
```

폰만 있고 PC 가 없으면 이 절은 건너뛰고 6-A(GitHub Actions 빌드)로 간다.

---

## 1. Supabase — 앱 연결 값 + 소셜 provider

웹과 **같은** Supabase 프로젝트를 쓴다.

1. Supabase 대시보드 → **Project Settings → API**
   - `Project URL` [결과 A]
   - `anon public` 키 (= publishable) [결과 B]
2. **Authentication → Providers** 에서 Google, Kakao **활성화**(아래 3·4 단계에서 받은
   값 입력).

---

## 2. `.env` / `app.json` 채우기

```bash
cp .env.example .env
```

`.env` 편집:
```
EXPO_PUBLIC_SUPABASE_URL=<결과 A>
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<결과 B>
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<3단계 결과>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<3단계 결과, iOS용>
EXPO_PUBLIC_WEB_URL=https://gongmoa.kr
```

> `EXPO_PUBLIC_WEB_URL` 은 앱의 "이용약관 / 개인정보처리방침"이 여는 주소다(웹의
> `/terms`, `/privacy`). 비어 있으면 두 문서가 안 열려서 **스토어 심사에서 반려된다**.

`app.json` 의 `PLACEHOLDER_*` 두 곳 교체:
- google-signin 플러그인 `iosUrlScheme` → iOS 클라이언트 ID의 역방향 값
- kakao-login 플러그인 `kakaoAppKey` → Kakao 네이티브 앱 키(4단계)

---

## 3. Google 로그인 (Google Cloud Console)

1. Google Cloud Console → **APIs & Services → Credentials**
2. OAuth 클라이언트 ID 3개 발급: **Web**, **Android**, **iOS**
   - Android: 패키지명 `com.gongmoa.app` + 서명 인증서 SHA-1(아래 6단계 빌드 후 EAS가
     주는 값, 또는 로컬 keytool)
   - iOS: 번들 ID `com.gongmoa.app`
3. **Web** 클라이언트 ID → Supabase Auth > Providers > Google 에 등록 +
   `.env` 의 `GOOGLE_WEB_CLIENT_ID` [결과]
4. **iOS** 클라이언트 ID → `.env` `GOOGLE_IOS_CLIENT_ID`, 역방향 값 → `app.json`

---

## 4. Kakao 로그인 (Kakao Developers)

1. Kakao Developers → 내 애플리케이션 → 앱 생성
2. **제품 설정 → 카카오 로그인 → 활성화**, 그리고 **OpenID Connect 활성화** ← 필수
   (안 하면 id_token 이 안 나와 로그인 실패)
3. **플랫폼** 에 iOS 번들 ID `com.gongmoa.app` / Android 패키지 `com.gongmoa.app` +
   키 해시 등록
4. **앱 키 → 네이티브 앱 키** → `app.json` kakao-login `kakaoAppKey` [결과]
5. Supabase Auth > Providers > Kakao 활성화 + REST 키 등록

---

## 4-1. Apple 로그인 (iOS 심사 필수)

다른 소셜 로그인이 있는 앱은 Sign in with Apple 이 없으면 iOS 심사에서 반려된다.
Android 빌드에는 영향 없다(버튼이 자동으로 숨겨진다).

1. Apple Developer → **Certificates, IDs & Profiles → Identifiers** → App ID
   `com.gongmoa.app` → **Sign In with Apple** 체크
2. **Identifiers → Services IDs** 로 서비스 ID 생성(예: `com.gongmoa.app.web`) →
   Sign In with Apple 설정에서 Return URL 에
   `https://<프로젝트 ref>.supabase.co/auth/v1/callback` 등록
3. **Keys** 에서 Sign in with Apple 용 키 생성 → `.p8` 파일 다운로드(1회만 받을 수 있음)
   + Key ID, Team ID 메모
4. Supabase 대시보드 → **Authentication → Providers → Apple** 활성화
   - Services ID, Team ID, Key ID, `.p8` 내용 입력
   - **Authorized Client IDs** 에 앱 번들 ID `com.gongmoa.app` 추가 ← 네이티브 로그인은
     이 값으로 검증한다. 빠지면 앱에서만 로그인이 실패한다.

> 코드 쪽은 이미 준비돼 있다(`src/lib/auth.ts` 의 `signInWithApple`, `app.json` 의
> `usesAppleSignIn` + `expo-apple-authentication` 플러그인). id_token 재사용을 막기 위해
> nonce 를 쓴다(SECURITY.md 5번).

**미완**: Apple 은 계정 삭제 시 발급한 토큰 폐기(revoke)까지 요구한다.
`https://appleid.apple.com/auth/revoke` 호출에 위 `.p8` 로 만든 client_secret 이 필요해서
`account-delete` 함수에 아직 안 들어가 있다. 키 발급 후 채워 넣을 것.

---

## 5. Edge Functions 배포 (채점·섞어풀기·AI 진단 백엔드)

**폰만 있을 때** — 저장소 Settings → Secrets and variables → Actions 에 `SUPABASE_ACCESS_TOKEN`
(supabase.com → 계정 → Account → Access Tokens 에서 발급)과 `SUPABASE_PROJECT_ID`(대시보드 →
Project Settings → General 의 Project ID)를 넣은 뒤, **Actions → "Edge Function 배포" → Run workflow**
(함수 `all`)를 실행하면 아래 10개가 전부 올라간다. 끝나면 Summary 에 함수 목록이 남는다.
코드가 바뀔 때마다 같은 버튼을 다시 누르면 된다.

**PC 가 있을 때** — 아래 명령을 저장소 루트(`supabase/config.toml` 이 있는 곳)에서 실행한다.

```bash
npm i -g supabase           # supabase CLI
supabase login
supabase link --project-ref <프로젝트 ref>

supabase functions deploy cbt-start
supabase functions deploy cbt-submit
supabase functions deploy review-create
supabase functions deploy review-submit
supabase functions deploy ai-diagnose
supabase functions deploy explanations-get
supabase functions deploy account-delete   # 회원 탈퇴 (웹·앱 공용, 스토어 심사 필수)
supabase functions deploy review-history   # 지난 섞어풀기 결과 다시 보기
supabase functions deploy comments-write   # 앱 댓글 작성·수정·삭제 (없으면 앱에서 댓글이 안 써진다)
supabase functions deploy membership-get   # 멤버십 조회·체험 시작 (앱 재시작 Phase 0 신설)

# AI 진단용 Claude 키 (함수 런타임 시크릿 — 앱 번들엔 안 들어감):
# ⚠ 웹 Vercel 의 ANTHROPIC_DIAGNOSIS_API_KEY 와 **같은 워크스페이스**의 키여야 한다.
#    앱 요청은 diagnosis-request 가 그 자리에서 Message Batch 를 내고 웹 크론이 그 배치까지
#    수거하는데(그 반대도 같다), 배치는 워크스페이스 단위로만 보인다 — 갈리면 상대가 낸
#    배치 조회가 404 가 되고 이미 요금을 낸 배치가 실패로 닫힌다.
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# (선택) 모델 변경: supabase secrets set ANTHROPIC_DIAGNOSIS_MODEL=claude-sonnet-5
#        (웹 Vercel 의 같은 이름 변수와 같은 값으로 — 한쪽만 바꾸면 경로에 따라 모델이 갈린다.
#         DIAGNOSIS_MODEL 은 폐기된 ai-diagnose 전용이라 새 경로는 읽지 않는다.)
```

> `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 는 Edge 런타임이
> 자동 주입하므로 따로 설정할 필요 없다.

---

## 5-1. 앱 전용 기능 — 추가 설정이 필요한 것

**오프라인 / 로컬 알림 / OTA 는 추가 콘솔 설정이 없다.** 캐시는 기기 파일, 리마인더는
기기에서 예약하는 로컬 알림, OTA 는 이미 있는 EAS 프로젝트를 쓴다.

```bash
eas update --branch production --message "설명"   # OTA 배포 (스토어 심사 없이 JS 수정본 반영)
```

- 앱은 켤 때와 포그라운드로 돌아올 때 업데이트를 확인하고 조용히 받아둔다. 적용은 다음
  실행 — 문제 풀던 중에 화면이 날아가지 않게 즉시 재시작하지 않는다.
- `runtimeVersion` 은 `fingerprint` 정책이라, 네이티브 의존성·설정이 바뀌면 지문이 달라져
  스토어 빌드를 새로 올려야 한다(OTA 로는 네이티브가 안 바뀐다).
- **SDK 57 빌드를 설치하기 전에 폰의 구 dev/preview APK 를 먼저 삭제할 것.** 재스캐폴드에서
  `runtimeVersion` 정책이 `appVersion` → `fingerprint` 로 바뀌므로 구 빌드는 새 OTA 를
  받지 못하고, 같은 앱 ID 위에 덮어 설치하면 채널·런타임이 섞여 업데이트 확인이 엉킨다.
  로그인 세션(SecureStore)은 재설치 후에도 이어지고, 잃는 것은 kv 편의값뿐이다
  (`docs/redesign-architecture.md` §10).

**웹 주소로 앱 열기(딥링크)는 코드가 준비됐고 값 두 개만 남았다.** `app.json` 의
`ios.associatedDomains`·`android.intentFilters` 와 웹의 `/.well-known` 두 파일은 이미 있다.
남은 것은 Apple Team ID 와 Android 서명 지문을 Vercel 환경변수에 넣는 일 — **5-3** 참고.

**원격 푸시(FCM/APNs)는 아직 없다.** 지금 리마인더는 로컬 알림이라 서버가 필요 없다.
"내 댓글에 답글이 달렸다" 같은 서버발 알림을 넣을 때 FCM 키·기기 토큰 테이블·발송
함수를 함께 만들면 된다.

**크래시 리포팅(Sentry)·분석(GA4)** — 소유자 결정(`docs/redesign-architecture.md` §12-2 4번).

- Sentry: expo.dev 가 아니라 sentry.io 에서 프로젝트를 만들고 DSN 을 `.env` 의
  `EXPO_PUBLIC_SENTRY_DSN` 에 넣는다(비어 있으면 앱은 Sentry 를 초기화하지 않는다).
  `app.json` 의 `@sentry/react-native/expo` 플러그인 `organization` 을 실제 조직 slug 로 바꾼다.
  소스맵 업로드용 `SENTRY_AUTH_TOKEN` 은 EAS 시크릿에만 두고, 토큰이 없는 빌드에서는
  `SENTRY_DISABLE_AUTO_UPLOAD=true` 로 업로드 단계를 끈다(없으면 gradle 이 실패한다).
- GA4(`@react-native-firebase/analytics`)는 **아직 코드에 없다.** Firebase 콘솔에서 Android 앱
  (`com.gongmoa.app`)을 만들어 받은 `google-services.json` 을 `apps/mobile/` 에 두고(gitignore
  대상 — EAS 에는 시크릿 파일로 올린다) 나서 패키지·플러그인을 추가한다. 파일 없이 플러그인만
  넣으면 prebuild 가 실패하기 때문이다. 화면 코드는 `src/lib/analytics.ts` 의 `track`/`screen`
  만 부르므로 그때 그 파일 하나만 바뀐다.

---

## 5-2. 앱 아이콘

`assets/icon.png`(iOS·스토어), `assets/adaptive-icon.png`(안드로이드 적응형 앞면),
`assets/adaptive-icon-monochrome.png`(안드로이드 13+ 테마 아이콘)이 들어 있고 `app.json` 에
연결돼 있다. 별도 작업 없이 빌드하면 그대로 붙는다.

모양·색을 바꾸려면 `scripts/generate-icons.mjs` 의 상수를 고치고 다시 돌린다:

```bash
cd apps/mobile && node scripts/generate-icons.mjs
```

디자인 도구 없이 코드로 그리고 의존성도 없다(PNG 를 직접 쓴다). 브랜드 색은
`src/theme/colors.ts` 의 primary 와 같은 값을 쓰므로 앱 색을 바꾸면 여기도 같이 고칠 것.

---

## 5-3. 웹 주소로 앱 열기 (유니버설 링크 / 앱 링크)

`https://gongmoa.kr/papers/...` 를 눌렀을 때 브라우저 대신 **앱**이 열리게 하는 설정이다.
카카오톡으로 받은 문제지 링크, 검색 결과, 알림 메일이 전부 앱으로 들어온다. 지금도
`gongmoa://` 커스텀 스킴은 동작하지만, 그건 우리가 만든 링크에서만 쓸 수 있다.

코드는 다 들어가 있다(`app.json` 의 `ios.associatedDomains`·`android.intentFilters`,
웹의 `/.well-known/apple-app-site-association`·`/.well-known/assetlinks.json` 라우트).
**남은 건 소유자만 볼 수 있는 값 두 개를 Vercel 에 넣는 일이다.**

> ⚠ `app.json` 변경은 **네이티브 설정**이라 OTA(`eas update`)로 안 나간다. 지금까지의
> 기능 추가와 달리 이번엔 **APK/IPA 를 새로 빌드해 설치**해야 링크가 앱으로 들어온다
> (`runtimeVersion` 이 `fingerprint` 정책이라 지문이 바뀐다 — 5-1 참고).
> 이미 깔려 있는 빌드는 계속 브라우저로 열린다.

### (1) Android — 서명 인증서 SHA-256 지문

둘 중 있는 쪽에서 얻는다. **둘 다 있으면 둘 다** 넣는다(쉼표로 이어서):

- **Play Console** → 해당 앱 → **테스트 및 출시 → 설정 → 앱 서명**
  - "앱 서명 키 인증서"의 SHA-256 [결과 P1] ← Play 가 배포본에 다시 서명하는 키
  - "업로드 키 인증서"의 SHA-256 [결과 P2] ← 우리가 올릴 때 쓰는 키
- **아직 Play 에 안 올렸으면**: `eas credentials` → Android → 해당 프로필 →
  키스토어 정보에 SHA-256 이 나온다 [결과 P2]

> **두 지문이 다른 게 정상이다.** Play 앱 서명을 쓰면 우리가 업로드 키로 서명해 올린
> APK 를 Play 가 앱 서명 키로 **다시 서명해서** 배포한다. 업로드 키 지문만 넣으면
> 내부 테스트용 APK 는 열리는데 Play 에서 받은 앱은 안 열리고, 반대면 그 반대가 된다.
> 로컬 `keytool` 로 뽑은 디버그 키 지문은 여기 넣지 말 것(그 키로 만든 빌드는 배포하지 않는다).

### (2) iOS — Apple Team ID

Apple Developer → 오른쪽 위 계정 → **Membership details** 의 **Team ID**(영숫자 10자,
예: `A1B2C3D4E5`) [결과 A1]. App Store Connect 앱 페이지의 "App Information" 에도 같은 값이 있다.

> 4-1 에서 `.p8` 키를 만들 때 메모해 둔 Team ID 와 같은 값이다.

### (3) Vercel 환경변수에 넣고 재배포

Vercel → 웹 프로젝트 → **Settings → Environment Variables** (Production):

| 이름 | 값 |
|---|---|
| `APP_APPLE_TEAM_ID` | [결과 A1] |
| `APP_ANDROID_CERT_FINGERPRINTS` | [결과 P1]`,`[결과 P2] (쉼표로, 콜론은 있어도 없어도 됨) |

넣은 뒤 **재배포**해야 반영된다(환경변수는 빌드에 실린다 — `APP_MIN_BUILD_*` 와 같다).

> 값을 저장소에 커밋하지 말 것. 지문·Team ID 는 비밀이 아니지만(APK 에서 뽑을 수 있다)
> 값은 언제나 환경변수로 받는 게 이 저장소의 규칙이다.

### (4) 확인

```bash
curl -i https://gongmoa.kr/.well-known/apple-app-site-association
curl -i https://gongmoa.kr/.well-known/assetlinks.json
```

- **200 + `content-type: application/json`** 이어야 한다. **404 면 환경변수가 비었거나
  형식이 틀린 것**(Team ID 가 10자가 아니거나 지문이 16진수 64자가 아니면 값이 없는 것으로
  친다 — 오타로 링크가 조용히 죽는 것보다 파일이 없는 편이 낫다).
- **301/302 가 있으면 안 된다.** iOS·Android 검증기는 리다이렉트를 따라가지 않는다.
  (주소를 `https://gongmoa.kr` 로 정확히 칠 것 — `www.` 는 301 이다.)
- 로그인 없이 열려야 한다. 해외에서도 열려야 한다(애플 CDN·구글 검증기는 해외 IP다 —
  `/.well-known` 은 해외 IP 차단 면제 목록에 이미 있다).

그다음 **새 빌드를 설치**하고:

- Android: `adb shell pm get-app-links com.gongmoa.app` → 도메인 상태가 `verified` 여야 한다.
  (실패하면 `adb shell pm verify-app-links --re-verify com.gongmoa.app` 로 재검증)
- iOS: 메모앱에 `https://gongmoa.kr/papers` 를 적고 **길게 눌러 "앱에서 열기"** 가 뜨는지.
  (사파리 주소창에 직접 입력한 주소는 유니버설 링크로 안 열린다 — 애플의 의도된 동작이다)

> **앱에 아직 없는 화면은 일부러 뺐다.** 건의(Phase 5 2라운드)는 목록에 없어서 브라우저로
> 열린다 — 넣으면 앱이 열렸다가 "페이지를 찾을 수 없어요"로 떨어진다. 화면을 만들 때
> 세 곳을 함께 연다: `src/lib/next-path.ts`, `app.json` 의 `android.intentFilters`,
> 웹 `apps/web/src/app/.well-known/apple-app-site-association/route.ts`
> (게시판·공지는 Phase 5 1라운드에서 그렇게 열었다 — `/notices/new`·`/notices/*/edit` 는
> 관리자 전용이라 next-path·AASA 에서 빠져 있고, Android `pathPrefix` 는 제외를 못 해 그 두 주소는
> 앱이 열렸다가 "페이지를 찾을 수 없어요"가 된다).

---

## 6. 빌드 & 설치

### 6-A. 폰만 있을 때 — GitHub Actions 로 빌드 (PC 불필요)

`.github/workflows/eas-build.yml` 이 EAS 클라우드 빌드를 대신 돌려준다. 아래는 전부
GitHub 웹(모바일 브라우저)에서 된다.

1. 저장소 **Settings → Secrets and variables → Actions → New repository secret** 에 등록:

   | 시크릿 | 값 |
   |---|---|
   | `EXPO_TOKEN` | expo.dev → Account → Access tokens (**필수**) |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase Project URL (**필수**) |
   | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon(publishable) 키 |
   | `EXPO_PUBLIC_WEB_URL` | 웹 배포 도메인 (`https://gongmoa.kr`) |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Web 클라이언트 ID |
   | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google iOS 클라이언트 ID |

2. **Actions → "앱 빌드 (EAS)" → Run workflow** — 플랫폼 `android`, 프로필 `preview`.
3. 실행이 끝나면 **Summary** 에 expo.dev 빌드 주소가 남는다. 거기서 빌드가 끝나길 기다렸다가
   APK 를 내려받아 폰에 설치한다("출처를 알 수 없는 앱" 허용 필요).

> `preview` 프로필은 **arm64-v8a 한 가지 CPU 용으로만** 빌드한다(`eas.json` 의
> `ORG_GRADLE_PROJECT_reactNativeArchitectures`). 요즘 안드로이드 폰은 전부 arm64 라 설치에
> 문제가 없고, 네 가지를 다 담으면 APK 가 195MB 까지 커진다(실측). **에뮬레이터(x86_64)에
> 설치하려면** 이 줄을 지우거나 `development` 프로필로 빌드할 것.

> 워크플로가 클라우드 빌드를 올리기 전에 타입체크를 먼저 돌린다 — 깨진 코드로 빌드 크레딧을
> 태우지 않으려는 것.

> `EXPO_TOKEN` 은 채팅·커밋에 남기지 말 것. 노출되면 expo.dev 에서 폐기하고 재발급한다
> (SECURITY.md 4번).

### 6-B. PC 가 있을 때 — 로컬에서 직접

```bash
npm i -g eas-cli
export EXPO_TOKEN=<expo.dev Access token>   # 또는 eas login
eas init                                    # 프로젝트 생성 → projectId 가 app.json 에 기록됨
eas build -p android --profile preview      # Expo 클라우드에서 빌드
```

- 끝나면 **APK 다운로드 링크**가 나온다. 폰에서 열어 설치(‘출처를 알 수 없는 앱’ 허용).
- iOS 는 Mac + Apple 개발자 등록($99/년) → `eas build -p ios` → TestFlight.

> Android SHA-1 이 필요하면 `eas credentials` 로 확인해 3단계 Google Android 클라이언트에 넣는다.

> **로컬 `.env` 는 EAS 빌드에 반영되지 않는다.** `.env` 는 gitignore 대상이고 EAS 는
> git 기준으로 프로젝트를 압축해 올리므로 빌드 서버에 도착하지 않는다. `.env` 는
> `expo start` 로 로컬 실행할 때만 쓰인다.
>
> 로컬에서 `eas build` 를 돌릴 거면 값을 **`eas.json` 의 해당 빌드 프로필 `env`** 에
> 넣거나 EAS 대시보드 환경변수에 등록해야 한다(6-A 의 GitHub Actions 경로는 저장소
> 시크릿에서 자동 주입하므로 신경 쓸 것 없다).
>
> 값이 빠지면 APK 는 **정상적으로 만들어지지만** 폰에서 켜자마자 꺼진다
> (`src/lib/supabase.ts` 가 import 단계에서 throw). 이 실수를 빌드 로그에서 잡으려고
> `scripts/check-build-env.mjs` 가 EAS 빌드 시작 전에 필수 값을 확인하고, 없으면
> 빌드를 실패시킨다.

---

## 7. 확인 순서 (설치 후)

1. 앱 실행 → 홈에 문제지 목록 뜨는지 (로그인 없이도 떠야 정상)
2. 로그인(구글/카카오) → 닉네임 설정 화면 → 저장
3. 아무 문제지 → **CBT로 풀기** → 1분 30초 이상 풀고 제출(90초 미만은 거절) → 점수 뜨면 채점 백엔드 정상
4. 마이페이지 → 오답노트 → **섞어풀기**, **AI 진단** 확인

문제 생기면 어디서 막혔는지(로그인/채점/진단) 알려주면 그 부분부터 잡으면 된다.

---

## 8. 앱이 켜자마자 꺼질 때

증상이 같아 보여도 원인은 층이 다르다. **오류 화면이 뜨는지**로 갈린다.

| 화면 | 어디서 죽은 것 | 볼 곳 |
|---|---|---|
| 오류 메시지가 뜬다 | JS. `app/_layout.tsx` 의 `ErrorBoundary` 가 잡았다 | 화면에 원인·스택이 그대로 나온다 |
| 아무것도 없이 꺼진다 | 네이티브. JS 가 시작조차 못 했다 | 아래 참고 |

네이티브에서 죽으면 화면에 아무것도 못 띄운다. 원인을 직접 보려면 `adb logcat -b crash -d`
가 필요하고(PC + platform-tools), 그게 어려우면 아래 후보를 하나씩 끄면서 좁힌다.

**`newArchEnabled`** — `app.json`. 지금은 `false`다.

이 앱이 쓰는 네이티브 패키지 중 `@react-native-seoul/kakao-login` 만 New Architecture
지원 흔적이 없다(`codegenConfig` 없음, 관련 코드 없음, 최신 5.4.2 도 마찬가지). 나머지
7개(pdf, blob-util, google-signin, skia, gesture-handler, reanimated, screens)는 전부
지원한다. `true` 로 두고 빌드했을 때 앱이 화면도 없이 종료됐고, 그래서 껐다.

SDK 52 는 구 아키텍처도 정식 지원하므로 기능 손실은 없다. kakao-login 이 New
Architecture 를 지원하는 버전을 내면 다시 켜고 시험해 볼 수 있다.
