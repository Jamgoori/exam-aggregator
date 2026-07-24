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
```

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

# AI 진단용 Claude 키 (함수 런타임 시크릿 — 앱 번들엔 안 들어감):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# (선택) 모델 변경: supabase secrets set DIAGNOSIS_MODEL=claude-sonnet-5
```

> `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 는 Edge 런타임이
> 자동 주입하므로 따로 설정할 필요 없다.

---

## 6. 빌드 & 설치 (안드로이드 기준)

```bash
npm i -g eas-cli
export EXPO_TOKEN=<expo.dev Access token>   # 또는 eas login
eas init                                    # 프로젝트 생성 → projectId 가 app.json 에 기록됨
eas build -p android --profile preview      # Expo 클라우드에서 빌드
```

- 끝나면 **APK 다운로드 링크**가 나온다. 폰에서 열어 설치(‘출처를 알 수 없는 앱’ 허용).
- iOS 는 Mac + Apple 개발자 등록($99/년) → `eas build -p ios` → TestFlight.

> Android SHA-1 이 필요하면 `eas credentials` 로 확인해 3단계 Google Android 클라이언트에 넣는다.

---

## 7. 확인 순서 (설치 후)

1. 앱 실행 → 홈에 문제지 목록 뜨는지 (로그인 없이도 떠야 정상)
2. 로그인(구글/카카오) → 닉네임 설정 화면 → 저장
3. 아무 문제지 → **CBT로 풀기** → 3분 풀고 제출 → 점수 뜨면 채점 백엔드 정상
4. 마이페이지 → 오답노트 → **섞어풀기**, **AI 진단** 확인

문제 생기면 어디서 막혔는지(로그인/채점/진단) 알려주면 그 부분부터 잡으면 된다.
