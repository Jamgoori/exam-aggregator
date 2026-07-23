# 공모아 모바일 앱 (Expo / React Native)

공모아 웹(`exam-aggregator`)과 **같은 Supabase 프로젝트**를 백엔드로 쓰는 네이티브 앱 뼈대.
DB·인증·스토리지·RLS·RPC를 그대로 재사용한다. 앱은 새 클라이언트만 구현한다.

> 이 폴더는 웹 레포 안에 스테이징된 스켈레톤이다. 안정되면 `git subtree`로 별도 레포로 분리한다.

## 왜 별도 클라이언트인가

웹은 Next.js(서버 컴포넌트 + 쿠키 세션 `@supabase/ssr`). 앱은 그 모델을 못 쓴다:
- **세션**: 쿠키 → 토큰(AsyncStorage) 저장 방식 (`src/lib/supabase.ts`)
- **인증**: `signInWithOAuth`(브라우저) → 네이티브 SDK id_token + `signInWithIdToken` (`src/lib/auth.ts`)
- **PDF/필기/줌**: pdf.js(브라우저 전용) → `react-native-pdf` + `react-native-skia` + 제스처

## 빠른 시작

```bash
cd apps/mobile
cp .env.example .env        # 값 채우기 (아래 "선행 설정" 참고)
npm install
npx expo install            # 네이티브 모듈 버전 정렬 (package.json 핀 대신 이걸로 맞춤)
```

네이티브 SDK(카카오·구글 로그인)를 쓰므로 **Expo Go로는 안 되고 dev build 필요**:

```bash
npx expo prebuild           # ios/ android/ 생성
npx expo run:ios            # 또는 run:android (시뮬레이터/에뮬레이터)
# 실기기 배포용:
npx eas build --profile development --platform android
```

## 선행 설정 (콘솔 — 코드만으론 안 됨)

1. **Supabase**
   - 웹과 동일 프로젝트의 URL / publishable(anon) 키 → `.env`
   - Auth > Providers 에서 Google, Kakao 활성화
2. **Google** (Google Cloud Console)
   - Web / iOS / Android 클라이언트 ID 발급
   - **Web** 클라이언트 ID를 Supabase Google provider에 등록 + `.env`의 `GOOGLE_WEB_CLIENT_ID`
   - iOS 역방향 클라이언트 ID → `app.json` google-signin 플러그인 `iosUrlScheme`
3. **Kakao** (Kakao Developers)
   - **OpenID Connect 활성화** (id_token 발급용 — 안 하면 `signInWithIdToken` 실패)
   - 네이티브 앱 키 → `app.json` kakao-login 플러그인 `kakaoAppKey`
   - 플랫폼(iOS 번들 ID / Android 키해시) 등록

`app.json`의 `PLACEHOLDER_*` 값은 실제 키로 교체할 것.

## 구조

```
app/                      expo-router 파일 기반 라우팅 (Next.js app-router와 유사)
  _layout.tsx             제스처 루트 + 인증 프로바이더 + 스택
  index.tsx               세션 로딩 게이트 → 탭
  (auth)/login.tsx        소셜 로그인 (모달)
  (tabs)/                 홈·검색·마이페이지
  papers/[id]/index.tsx   문제지 상세
  papers/[id]/cbt.tsx     CBT 풀이 (구축 예정 — 재구현 부담 최대)
src/
  lib/
    supabase.ts           토큰 세션 클라이언트
    auth.ts               네이티브 소셜 → signInWithIdToken
    papers.ts             목록/상세/CBT 데이터 (RLS·RPC 재사용)
    storage.ts            공개 URL 헬퍼
    types.ts              웹 types.ts 복사본 (스키마 바뀌면 동기화)
  providers/auth-provider.tsx  세션 컨텍스트 + 자동 갱신
  components/             pdf-viewer / question-image-viewer 스텁
  theme/colors.ts         웹 팔레트 최소 토큰
```

## 다음 단계 (우선순위)

1. **CBT 뷰어** — 가장 큼. `react-native-pdf` 전체보기 + `react-native-skia` 필기 +
   핀치줌, 문제별 크롭 이미지 모드, OMR·타이머·채점(`cbt_attempts`).
2. 검색 (`paper-search` + 초성검색 `hangul.ts` 이식)
3. 마이페이지 (응시기록·오답노트·AI진단)
4. `types.ts` 웹과 공유 (npm 패키지화 or 동기화 스크립트)

## 유지보수 주의

- `src/lib/types.ts`는 웹 `src/lib/supabase/types.ts` **복사본**이다. 스키마 변경 시 둘 다 갱신.
- RLS·RPC는 웹과 공유 자원 — 앱에서 스키마를 바꾸지 말 것.
- publishable(anon) 키만 앱에 넣는다. service_role 키는 **절대** 앱 번들에 넣지 말 것.
