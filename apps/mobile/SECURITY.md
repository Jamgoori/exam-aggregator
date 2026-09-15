# 보안 검토 (gongmoa_mobile)

앱 + Edge Functions 백엔드 검토. 각 항목 위험도·설명·조치. 표의 상태:
✅ 조치 완료(코드) · 🔧 조치 필요(DB/콘솔, 아래 방법대로) · 🟢 확인됨(문제 없음).

| # | 항목 | 위험도 | 상태 |
|---|---|---|---|
| 1 | 세션 토큰 저장(AsyncStorage 평문) | 높음 | ✅ |
| 2 | AI 진단 동시호출 비용 남용 | 중 | ✅ |
| 3 | 닉네임 검증·유일성·사칭 클라이언트 전용(우회 가능) | 중 | ✅ SQL / 🔧 적용 |
| 4 | EXPO_TOKEN 채팅 노출 | 높음 | 🔧 |
| 5 | 네이티브 OAuth id_token nonce 미사용 | 낮음 | ✅ Apple / ⛔ Google·Kakao(SDK 미지원) |
| 6 | Edge Function CORS `*` | 낮음 | 🟢/🔧 |
| 7 | 섞어풀기 세션 생성 rate limit 없음 | 낮음 | ✅ |
| 8 | 정답 비공개(RLS)·응시 IDOR | — | 🟢 |
| 9 | service_role / 시크릿 분리 | — | 🟢 |
| 10 | 사용자 입력 렌더링(XSS) | — | 🟢 |

---

## 1. 세션 토큰 저장 — ✅ 조치 완료

**문제**: 리프레시 토큰(장기 자격증명)을 AsyncStorage(평문)에 저장하면 루팅/탈옥
기기나 백업 추출로 다른 앱·공격자가 읽어 세션을 탈취할 수 있다.

**조치**: `src/lib/secure-storage.ts` 추가 — iOS Keychain / Android Keystore
(`expo-secure-store`)에 저장하는 어댑터로 교체(`supabase.ts`). 항목 크기 제한(안드로이드
~2KB)은 청크 분할로 대응. `expo-secure-store` 의존성 추가, AsyncStorage 제거.

---

## 2. AI 진단 동시호출 — ✅ 조치 완료

**문제**: `ai-diagnose` 가 하루 1회 캐시만 있어, 캐시가 채워지기 전 연타/병렬 요청이
Anthropic API 를 여러 번 호출해 비용을 태울 수 있었다.

**조치**: 오늘 행을 `report=null` 로 먼저 **선점**(유니크 제약)하고, 충돌 시 이미
생성 중/완료로 판단해 재호출하지 않는다. 생성 실패 시 선점 행을 삭제해 그날이
"생성 중"으로 영구히 막히지 않게 롤백.

---

## 3. 닉네임 검증·유일성 우회 — ✅ SQL 작성 완료 / 🔧 적용 필요

**문제**: 닉네임은 `user_metadata.nickname` 에 저장되는데, 이 필드는 로그인 사용자가
`auth.updateUser` 로 **자유롭게 쓸 수 있다**. 앱의 `validateNickname`(길이·금칙어)·
`is_nickname_taken`(중복)은 클라이언트 검증일 뿐, REST 를 직접 호출하면 우회된다.

**추가로 발견**: 앱(`src/lib/profile.ts`)은 `user_metadata` 만 쓰고 `profiles` 에는 넣지
않았다. 중복 검사가 보는 테이블이 앱 사용자에 대해 비어 있었으니 **중복 검사 자체가
헛돌고 있었다**(웹은 서버 액션에서 양쪽을 함께 쓴다).

**조치**: `supabase/schema.sql` 끝에 트리거를 넣었다 — `auth.users.raw_user_meta_data` 가
바뀔 때마다 `profiles` 를 자동으로 맞추고, 길이(2~10)·제어문자·중복을 DB 에서 거절한다.
거절되면 `auth.users` 갱신까지 롤백되므로 우회할 수 없고, 앱이 `profiles` 를 따로 안
써도 동기화된다. 트리거 이전에 만들어진 계정을 채우는 백필도 함께 들어 있다.

**적용**: Supabase 대시보드 → SQL Editor 에서 `supabase/schema.sql` 의
"닉네임 서버 강제" 절을 실행한다(전체를 다시 돌려도 무방 — 전부 멱등).

**금칙어도 DB 에서 막는다**: 처음에는 목록이 길다는 이유로 클라이언트에만 뒀는데, 그러면
REST 로 `auth.updateUser` 를 직접 호출해 "관리자"·"운영자" 같은 닉네임을 그대로 만들 수 있고
그 이름이 댓글에 공개로 붙는다(사칭). 트리거에서도 같은 목록으로 검사하고, 글자만 남긴
형태("관 리 자")와 원문 양쪽을 본다. 목록이 두 곳에 있으므로
`packages/core/src/nickname.test.ts` 가 `schema.sql` 과 대조해 갈리는 걸 막는다 —
한쪽만 고치면 테스트가 깨진다.

---

## 4. EXPO_TOKEN 노출 — 🔧 즉시 조치

**문제**: EAS 액세스 토큰이 채팅에 평문 노출됐다. 이 토큰으로 Expo 계정의 빌드 트리거·
프로젝트 접근이 가능하다.

**조치**: expo.dev → Account → **Access tokens** 에서 해당 토큰 **폐기(revoke)** 후 재발급.
새 토큰은 채팅/코드/커밋에 넣지 말고, 로컬 `export EXPO_TOKEN=` 또는 GitHub Actions
**Secret** 으로만 주입.

**재발급은 앱 재시작 Phase 0 의 선행 조건이다**(`docs/redesign-architecture.md` §11
"Phase 0 전(소유자)", §12). `.github/workflows/eas-build.yml` 이 이 시크릿으로 클라우드
빌드를 올리므로, 폐기만 하고 새 값을 저장소 Secrets `EXPO_TOKEN` 에 넣지 않으면 스파이크
빌드(SDK 57 dev build)부터 막힌다. 노출된 옛 토큰을 그대로 두고 Phase 0 을 시작하지 말 것.

---

## 5. OAuth id_token nonce — ✅ Apple 적용 / ⛔ Google·Kakao 는 SDK 미지원

**문제**: 네이티브 로그인에서 `signInWithIdToken` 에 nonce 를 함께 쓰지 않으면, 유효기간
내 id_token 재사용(replay) 방어가 약해진다.

**조치**: 로그인 시 임의 nonce 생성 → 네이티브 SDK에 nonce 의 해시를 넘겨 발급받고,
`supabase.auth.signInWithIdToken({ provider, token, nonce })` 에 원본 nonce 를 전달.

- **Apple — 적용 완료**: `src/lib/auth.ts` 의 `signInWithApple` 이
  `Crypto.randomUUID()` 로 원본 nonce 를 만들고 SHA-256(hex) 을 Apple 에 넘긴 뒤,
  Supabase 에는 원본을 전달한다.
- **Google·Kakao — 현재 SDK 로는 불가**: `@react-native-google-signin/google-signin` 과
  `@react-native-seoul/kakao-login` 은 nonce 파라미터를 노출하지 않는다(패키지 전체에
  해당 문자열이 없음). 적용하려면 SDK 를 바꾸거나(예: 웹 OAuth 흐름 + expo-auth-session)
  각 SDK 가 지원할 때까지 기다려야 한다. Apple 만 nonce 를 쓰는 상태이고, Google·Kakao 는
  id_token 유효기간 내 재사용 위험이 남아 있다.

---

## 6. Edge Function CORS `*` — 🟢/🔧

**현황**: 함수가 `Access-Control-Allow-Origin: *` 를 준다. 인증이 **쿠키가 아니라 Bearer
JWT** 라 CSRF 위험은 없다(브라우저가 자동 첨부하는 자격증명 없음). 앱만 쓰는 API 라
기능상 문제 없음.

**조치(선택)**: 웹에서도 이 함수를 부를 계획이 없으면 그대로 두거나, 특정 오리진만
허용하도록 좁혀도 된다(앱은 오리진이 없어 영향 없음).

---

## 7. 섞어풀기 세션 생성 rate limit — ✅ 조치 완료

**문제**: `review-create` 는 호출 제한이 없어, 연타·남용 시 `review_sessions`(본인 행)이
과도하게 쌓일 수 있었다. 타인 데이터엔 영향 없음(본인 행만).

**조치**: 최근 30분 안에 만들었고 아직 제출하지 않은 세션이 있으면 **새로 만들지 않고 그
세션을 그대로 돌려준다**. 에러로 막지 않아서, 사용자는 버튼을 두 번 눌러도 "막혔다"는
느낌 없이 같은 문제 묶음을 이어서 풀게 된다. 항목이 비어 있는 껍데기 세션(생성 중 실패로
남은 것)은 재사용하지 않고 새로 만든다.

---

## 8. 정답 비공개·IDOR — 🟢 확인됨

- 정답(`paper_answers`)은 RLS 로 anon/authenticated 에 **완전 차단**. 채점은 전부
  service_role Edge Function 에서만. 앱 응답에 정답을 싣지 않는다:
  - `review-create`: 풀이용 응답에 정답·출처 없음(채점 후에만 노출).
  - 오답노트 상세·응시 상세: 정답 미표시(내 선택·정오 여부만).
- service_role 로 RLS 를 우회하는 모든 함수 쿼리는 `user_id` 로 스코프하거나
  세션 소유권을 명시 검사한다(`review-submit` 은 `session.user_id === userId` 확인).
  타인 `attemptId`/`sessionId` 로는 데이터가 안 나온다.

## 9. 시크릿 분리 — 🟢 확인됨

- 레포에 `.env` 미추적(`.env.example` 만, 값은 placeholder). service_role·ANTHROPIC 키
  하드코딩 없음. `git grep` 확인 완료.
- service_role / ANTHROPIC_API_KEY 는 **Edge 런타임에만**, 앱 번들엔 anon(publishable)
  키만. anon 키는 RLS 로 보호되므로 노출돼도 안전.

## 10. 사용자 입력 렌더링(XSS) — 🟢 확인됨

- 댓글·닉네임·메모 등 사용자 입력은 RN `<Text>` 로만 렌더 — HTML/스크립트 실행 경로
  없음(웹 DOM 아님). 길이·형식은 DB 제약(코멘트 length, 난이도 score check)이 서버에서
  강제한다.

---

## 조치 요약

- **코드로 이미 반영**: 1(세션 SecureStore), 2(AI 진단 선점).
- **코드로 반영(추가)**: 5의 Apple 부분(nonce), 7(세션 재사용), 3의 SQL 작성.
- **집에서 DB/콘솔로 해야**: 3(닉네임 트리거 SQL 적용), 4(EXPO_TOKEN 폐기), 6(선택).
- **현 SDK 로는 불가**: 5의 Google·Kakao 부분.
- **양호**: 8·9·10 — 현 구조 유지.
