# 집에서 할 일 (순서대로)

앱 코드는 완성. 이제 **콘솔 설정 → 키 채우기 → 백엔드 배포 → 빌드** 순서로 진행하면
실제 폰에서 로그인·CBT·AI 진단까지 동작한다. 위에서부터 차례대로.

각 단계 끝의 `[결과]` 는 다음 단계에서 붙여넣을 값이다. 미리 메모장에 모아두면 편하다.

---

## 0. 코드 받기

```bash
git clone https://github.com/Jamgoori/gongmoa_mobile
cd gongmoa_mobile
npm install
npx expo install          # 네이티브 모듈 버전 정렬 (package.json 핀 대신 이걸로 맞춤)
```

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
EXPO_PUBLIC_WEB_URL=<웹 배포 도메인, 예: https://gongmoa.com>
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

# AI 진단용 Claude 키 (함수 런타임 시크릿 — 앱 번들엔 안 들어감):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# (선택) 모델 변경: supabase secrets set DIAGNOSIS_MODEL=claude-sonnet-5
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
- `runtimeVersion` 이 `appVersion` 정책이라, 네이티브 의존성을 바꾸면 `app.json` 의
  `version` 을 올리고 스토어 빌드를 새로 올려야 한다(OTA 로는 네이티브가 안 바뀐다).

**웹 주소로 앱 열기(딥링크)는 도메인 확인이 필요하다.** 지금은 `gongmoa://` 커스텀 스킴만
동작한다. `https://<도메인>/papers/...` 로 앱이 열리게 하려면:

- iOS: `app.json` 의 `ios.associatedDomains` 에 `applinks:<도메인>` 추가 +
  웹 서버에 `/.well-known/apple-app-site-association` 배포
- Android: `android.intentFilters` 에 `autoVerify` 링크 추가 +
  `/.well-known/assetlinks.json` 배포(서명 인증서 지문 필요)

**원격 푸시(FCM/APNs)는 아직 없다.** 지금 리마인더는 로컬 알림이라 서버가 필요 없다.
"내 댓글에 답글이 달렸다" 같은 서버발 알림을 넣을 때 FCM 키·기기 토큰 테이블·발송
함수를 함께 만들면 된다.

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
   | `EXPO_PUBLIC_WEB_URL` | 웹 배포 도메인 |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Web 클라이언트 ID |
   | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google iOS 클라이언트 ID |

2. **Actions → "앱 빌드 (EAS)" → Run workflow** — 플랫폼 `android`, 프로필 `preview`.
3. 실행이 끝나면 **Summary** 에 expo.dev 빌드 주소가 남는다. 거기서 빌드가 끝나길 기다렸다가
   APK 를 내려받아 폰에 설치한다("출처를 알 수 없는 앱" 허용 필요).

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
3. 아무 문제지 → **CBT로 풀기** → 3분 풀고 제출 → 점수 뜨면 채점 백엔드 정상
4. 마이페이지 → 오답노트 → **섞어풀기**, **AI 진단** 확인

문제 생기면 어디서 막혔는지(로그인/채점/진단) 알려주면 그 부분부터 잡으면 된다.
