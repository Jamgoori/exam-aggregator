# 공모아 모바일 앱 재시작 설계서 (최종안)

> 2026-09-15. 코드 변경 없음 — 아키텍처·동기화 규칙·이식 순서·의사결정 기록용.
> 근거는 레포 실측 리포트 7건(디자인 시스템·라우트·풀이 흐름·계정/커머스/커뮤니티·모바일 감사·백엔드 공유·외부 생태계)과 후보 설계 4안·심사 3건이다. 경로는 전부 저장소 루트 기준. 리포트에 없는 새 파일·함수·테이블·Edge Function 은 **(신설)** 로 표시한다. `apps/web/AGENTS.md` 금지선과 충돌하는 결정은 없다.

## 요약

멈춰 있던 `apps/mobile`(Expo SDK 52, React 18, 하단 3탭, 파랑 브랜드)을 웹(`apps/web`, Next 16, 초록 브랜드, 헤더+드로어)과 **같은 디자인·같은 경험·같은 데이터**로 다시 세운다. 1순위 리스크는 화면이 아니라 "같은 계정이 웹과 앱에서 다른 채점·복습일·멤버십을 받는 것"이며, 이미 Edge Function 9개는 웹 서버 액션과 어긋나 있다(`_shared/status.ts` 의 `source` 에 `mix` 없음, `review-create` 의 dedup·삭제 표시·과목 스코프 부재와 30분 세션 재사용, 별도 알고리즘의 `_shared/status-targets.ts`, 동기식 `ai-diagnose`). 그래서 첫 삽은 UI 가 아니라 **규칙을 `packages/core` 한 곳으로 모으고 웹 서버 액션과 Edge Function 을 같은 코드의 얇은 어댑터로 바꾸는 것**(Phase 0)이다. 앱은 Expo SDK 57 로 재스캐폴드하되 검증된 인프라 층(`secure-storage.ts`, `auth-provider.tsx`, EAS 워크플로)은 옮겨 심고, 라우트 경로를 웹 URL 과 1:1 로 맞추며, Uniwind 로 웹 Tailwind v4 토큰·클래스 문자열을 그대로 소비한다. 정답·해설·SRS·멤버십은 앱에서 계산하거나 디스크에 남기지 않고 서버 행(`memberships`, `user_question_status`, `review_sessions`)만 진실로 삼는다. 신설 RPC/Edge Function 22항목은 전부 core 규칙을 호출하고, 로컬 Supabase 위에서 웹 어댑터와 Edge Function 에 같은 입력을 넣어 결과 행을 비교하는 계약 테스트가 파리티를 기계적으로 증명한다. 전면 무료 기간(`FREE_UNTIL` 2027-07-01 KST) 안에 출시하고, 그 전에 IAP 를 `apply_paid_membership` 멱등 패턴으로 붙여 웹 Toss 와 한 `memberships` 행으로 합산한다.

## 이 문서를 읽는 법

- **구현자(앱)**: §3 → §5 → §4 → §6.2/6.3 → §10 → §12 순서. §4.5 컴포넌트 매핑표가 화면 작업의 체크리스트다.
- **구현자(백엔드/Edge)**: §6 전체 → §11 계약 테스트 → §12 Phase 0. §6.7 이 만들 것의 전체 목록, §6.8 이 지울 것의 전체 목록이다.
- **소유자**: 요약 → §1 → §8 → §12 → §13 의 질문 목록. §13 의 답이 없으면 Phase 2 이후 일정이 확정되지 않는다.
- 각 절의 "금지선" 박스는 `apps/web/AGENTS.md` 규칙을 앱 관점으로 옮긴 것이다. 어기면 웹과 앱이 갈라진다.

---

## 1. 목표·비목표

### 목표

1. **웹과 동일한 디자인·경험.** `apps/web/src/app/globals.css` 의 `@theme`(`blue-*` 스케일을 초록으로 재정의: 500 `#12b382`, 600 `#0a7d5b`, 700 `#06664a`; 다크 400 `#2ec48f`, 500 `#0fa374`, 600 `#096b4e`, 700 `#065a41`; 페이지 배경 `#ffffff`/`#0a0a0a`)을 정본으로 하는 토큰 파이프라인 하나를 웹과 앱이 함께 쓴다. 65px 헤더(로고 + `NotificationBell` + `ThemeToggle` + 햄버거), 우측 드로어(`apps/web/src/components/mobile-nav.tsx`), `site-nav-items.ts` 의 `PRIMARY_NAV`/`ACCOUNT_NAV` 순서, 화면 블록 순서(문제지 상세 10블록, 홈 6섹션), 문구, 배지 색, 모션 곡선을 1:1 로 옮긴다. 웹은 어떤 폭에서도 하단 탭바가 없으므로 앱에도 두지 않는다(§4.4, §13 질문 1).
2. **WebView 금지.** 모든 화면은 React Native 네이티브 컴포넌트다. 유일한 예외는 `/terms`·`/privacy` 를 `expo-web-browser` 의 `openBrowserAsync`(iOS `SFSafariViewController` / Android Custom Tabs — **시스템 인앱 브라우저 시트이지 WebView 가 아니다**; `legal.ts` 상단 주석과 `.env.example` 도 "인앱 브라우저"라고 쓴다. 외부 앱 전환이 아니다)로 여는 기존 `apps/mobile/src/lib/legal.ts` 방식 — 앱 화면이 아니므로 허용. 앱 화면 안에 웹 페이지를 띄우는 곳은 없다.
3. **계정·응시·해설·오답·복습·멤버십 전부 웹과 연동.** 같은 Supabase 프로젝트, 같은 `auth.users.id`, 같은 테이블(`cbt_attempts`, `cbt_attempt_answers`, `user_question_status`, `srs_reviews`, `review_sessions`, `review_session_items`, `wrong_note_marks`, `question_memos`, `bookmarks`, `memberships`, `payments`, `notifications`). "웹에서 한 일이 앱에 다음 조회에서 보이고, 앱에서 한 일이 웹에 보인다"가 합격 기준.
4. **규칙의 단일화.** 채점·SRS·출석·해설 접근·멤버십 판정 같은 "돈과 학습일이 걸린 규칙"은 `packages/core` 한 곳에만 존재하고, 웹 서버 액션과 Supabase Edge Function 이 같은 코드를 실행한다.
5. **단계마다 설치 가능한 빌드.** Phase 1a(Android `preview` APK) 종료 시점에 소유자 기기에 빌드가 깔리고 "로그인 → 기출 검색 → CBT → 채점 → 틀린 문제 보기"가 된다(iOS TestFlight 는 1b — Apple 콘솔 작업이 끝나는 대로, §12).

### 비목표

- `/admin/*` 이식(§5 근거), SEO(JSON-LD·사이트맵·OG·`manifest.ts`), 해설 인쇄(`print-button.tsx`, `explanation-auto-print.tsx`, `?download=1` — 앱 해설 화면은 `print-button` 자리를 비우고, `?download=1` 딥링크는 파라미터를 버린 채 같은 화면을 연다(§5 표와 일치)), 비회원 비밀번호 댓글(`authorizeComment` bcrypt 경로), 웹 Toss 결제 화면의 앱 내 재현, AdSense 코드 재사용.
- 웹을 Expo Router 유니버설 앱으로 합치는 것 — Next.js 16 유지(Expo SSR 은 alpha, `@expo/next-adapter` 는 App Router 미지원, `'use cache'`·`generateStaticParams`·사이트맵 분리 등 SEO 금지선을 재현 못 함).
- SDK 52 앱의 제자리 업그레이드 — SDK 57 로 재스캐폴드 후 로직 이식(§10).
- 오프라인 **쓰기**(응시·복습 제출 큐). 채점은 서버 시각(`cbt_attempt_starts.started_at`) 기준이라 오프라인 큐가 규칙을 깬다. 읽기 캐시만.
- 원격 푸시(Phase 6 선택). 지금은 로컬 20시 리마인더만 유지.
- Node 서버 신설 없음 — 서버 로직은 Supabase Edge Function + SQL RPC + 기존 Vercel 크론만.

---

## 2. 현재 상태 진단

| 항목 | 웹 (`apps/web`) | 멈춘 앱 (`apps/mobile`) |
|---|---|---|
| 규모 | `page.tsx` 49 + `route.ts` 15 = 64 라우트 파일(사용자 대면 약 36개), `src/components` 99파일(`"use client"` 79, 서버 액션 import 43, `next/link\|navigation\|image` import 57), `loading.tsx` 22개, `src/lib` 100+ 모듈, `lib/wrong-notes.ts` 1,653줄 | 8,171 LOC: 라우트 파일 22(`app/**`), 컴포넌트 11, lib 27, provider 1, theme 3. 마지막 커밋 2026-09-11(`52974f7`). `npx tsc --noEmit` **통과** |
| 스택 | Next 16.3.1 / React 19.2.4 / Tailwind v4 / `@supabase/ssr ^0.12.0` / TS ^5.9.3 | Expo 52.0.49 / RN 0.76.9 / React 18.3.1 / expo-router 4.0.22 / reanimated 3.16.7 / skia 1.5.0 / react-native-pdf 6.7.7 / kakao-login 5.4.2 / google-signin 13.3.1 / TS ~5.3.3 / `newArchEnabled:false` — 최신 SDK 57 대비 **5개 SDK 뒤**, Legacy Architecture 는 SDK 55 부터 제거됨 |
| 공유 패키지 | `packages/core` 6,035 LOC, 테스트 30파일, React 의존 0(`data/subjects.ts` 의 `import type { SupabaseClient }` 뿐) | 같은 core 를 `tsconfig paths` 로 직접 읽음, import 지점 31곳·약 18개 모듈. `membership`, `srs`, `review-queue`, `review-pick`, `mix-practice`, `board`, `rich-text`, `notifications`, `payment`, `pricing`, `study-phase` 는 **미사용** |
| 타입 | `packages/core/src/types.ts` 단일 | 같은 파일. README 가 말하는 `src/lib/types.ts`·`format.ts` 는 **존재하지 않음**(stale). 실제 드리프트는 지역 타입 세 곳: `src/lib/explanations.ts` `ExplanationsResult` 에 `lockReason` 없음, `src/lib/cbt.ts` `CbtSubmitResult` 에 `diagnosisProgress` 없음, `src/lib/diagnosis.ts` 리포트 타입이 `mission/insights/conceptCoaching` 을 모름 |
| 서버 로직 | 서버 액션 + `createAdminClient()` 27개 파일 | Edge Function 9개(`cbt-start`, `cbt-submit`, `review-create`, `review-submit`, `review-history`, `explanations-get`, `ai-diagnose`, `comments-write`, `account-delete`) + `_shared` 11파일, 테스트 0 |
| 이미 어긋난 규칙 | `recordQuestionResults` source `cbt\|review\|mix` | `_shared/status.ts` 는 `mix` 없음 → `review-submit` 이 mix 세션을 `review` 로 기록; `_shared/status-targets.ts` 는 core `representativePaperIds` 가 아닌 자체 `dedupKey`+답안 시그니처 클러스터; `review-create` 는 dedup·`wrong_note_marks.deleted`·과목 스코프·24h 쿨다운 없음 + `REUSE_WINDOW_MINUTES=30` 재사용(웹엔 없음); `_shared/media.ts` 는 1000행 미페이지네이션; `ai-diagnose` 는 동기 호출·3필드 리포트(웹은 Message Batches + `conceptCoaching`)로 같은 `ai_diagnoses` 행을 잠금; 앱은 `explanations-get` 의 `lockReason` 을 버려 무료 한도 초과에 "잠시 후" 문구 |
| 디자인 | 브랜드 초록, 다크 배경 `#0a0a0a`, 카드 흰색+`zinc-200` 테두리, 사용자 토글(`localStorage.theme`)+OS 폴백, `lucide-react ^1.22.0` | `src/theme/colors.ts` primary `#2563eb`(진짜 파랑), 다크 bg `#18181b`(웹의 패널색), 카드 `#fafafa`; OS 전용 테마; 아이콘 라이브러리 없음; `theme/badges.ts` 에 `8급`(teal-600)·`한능검`(rose-600) 없음; `exam-type-icons.ts` 에 `한능검` 없음 |
| 내비게이션 | 햄버거 드로어 하나, 하단 탭 없음, 헤더 65px | 하단 3탭(홈/검색/마이페이지), 기본 expo-router 헤더 |
| URL | 제목 슬러그(`core/paper-slug.ts`, `lib/paper-href.ts`, `lib/paper-slug-map.ts`) | UUID — 유니버설 링크 불가 |
| 중복 로직 | — | backend 리포트 §8 기준 24항목(≈15 복사 쌍). `_shared/srs.ts`·`review-pick.ts`·`profanity.ts` 는 core 와 의미 동일(공백 차이만). 함수 **정의** 기준 실측: `fetchQuestionMedia` 계열 3벌(`apps/web/src/lib/wrong-notes.ts:200`, `supabase/functions/_shared/media.ts:7`, `apps/mobile/src/lib/wrong-notes.ts:235 fetchQuestionImages`), `kstToday` 3벌(`apps/web/src/lib/ai-diagnosis.ts:145`, `supabase/functions/ai-diagnose/index.ts:15`, `_shared/membership.ts:108`), `isUuid` 8벌(웹 `app/{board,notifications,suggestions,subjects,notices,papers}/actions.ts` + `mypage/attempts/[attemptId]/page.tsx` 7 + `_shared/cbt.ts:31`; 정본은 core `paper-slug.ts:90 UUID_RE`), `chunk` 8벌(웹 `lib/{status-targets,mix-practice,wrong-notes,review-preferences,review-queue,diagnosis-live}.ts` 6 + `_shared/status-targets.ts` + 모바일 `wrong-notes.ts`), Edge 에러 언랩 6벌, `getAttendanceSummary` 웹·앱 verbatim 중복, `computeAttemptRounds` 는 `apps/web/src/app/mypage/page.tsx:82` 와 `apps/mobile/src/lib/mypage.ts:55` 중복. 근본 원인은 Deno 가 `@gongmoa/core` 를 import 못 하는 것 하나 |

**앱에 없는 기능**: 랜딩 `/`, `/exams*`, `/mix`·`/subjects/[slug]/mix`·mix 세션 노트, 오늘의 복습(SRS: `review-due-card`, `review-fab`, 설정), `/notifications`+종, `/membership*`·`/mypage/payments`, `/board*`·`/notices*`·`/suggestions*`·채팅, 아바타, 문항 신고, 정답지 열기, 회독 평균 비교, 홈 팝업, 테마 토글, 검색 제안, 오답노트·응시 상세의 정답·해설(`paper_answers`·`question_explanations` RLS 차단), `/terms`·`/privacy` 내 링크만 존재.

**앱에만 있는 것**: 오프라인 JSON 캐시(`offline.ts`)+`OfflineBanner`, 로컬 20시 리마인더(`reminders.ts`, 단 `cancelAllScheduledNotificationsAsync` 로 타 알림까지 지움), `expo-updates` OTA, Apple 로그인, `FatalErrorScreen`, CBT 안 메모 필드(웹엔 없음), 전역 복습 기록 목록.

결론: **데이터·인증 계층은 살릴 수 있지만 규칙 계층은 이미 웹과 어긋나 있고 SDK 는 재스캐폴드가 싸다.** 재시작의 첫 삽은 "규칙을 한 곳으로 모으는 것"이어야 한다.

---

## 3. 아키텍처 결정

### 3.1 스택 (landscape 리포트의 SDK 57 고정 버전)

| 영역 | 결정 | 버전 | 근거 |
|---|---|---|---|
| 런타임 | **SDK 57 로 `create-expo-app` 재스캐폴드**, New Architecture 전용 | `expo 57.0.22`, `react-native 0.86.3`, `react 19.2.3` | 52→57 사이에 React 19, expo-router 56 의 react-navigation 제거, Reanimated 4/worklets, Legacy Arch 제거(55), `expo-file-system` 신 API(54), vector-icons 분리(56) 가 겹쳐 제자리 업그레이드가 더 비쌈. SDK 58 은 preview(`58.0.0-preview.1`, RN 0.88 rc, Node ≥22.13, expo-router 58 이 `initialRouteName`/`redirect`/`beforeRemove` preventable 제거) — 안정화 후 이동하되 코드는 58 호환으로 쓴다 |
| 라우팅 | `expo-router`, Stack 하나 + 커스텀 헤더/드로어 | `~57.0.21` | 파일 경로 = 웹 URL. `expo-router/react-navigation` 의 제거 예정 export 사용 금지 |
| 애니메이션·제스처 | Reanimated 4 + worklets, Gesture Handler 2 | `react-native-reanimated 4.5.1`, `react-native-worklets 0.10.1`(Babel `react-native-worklets/plugin`), `react-native-gesture-handler ~2.32.0`, `react-native-screens ~4.26.0`, `react-native-safe-area-context ~5.7.0` | `runOnJS`→`scheduleOnRN` 등 4.x API 로 작성. GH 3 는 SDK 58 에서 |
| 스타일 | **Uniwind**(MIT 무료 티어, Metro `withUniwindConfig`, Babel 불필요) + `packages/design-tokens/theme.css`(신설) | `uniwind 1.12.0`, `tailwindcss ^4` | Tailwind v4 `@theme` 을 그대로 소비하는 두 라이브러리 중 안정판. NativeWind 5 는 `5.0.0-rc.0`(2026-09-13) — `latest` 도달 후 재평가. Phase 0 스파이크에서 `metro.config.js` 모노레포 설정과 충돌하면 폴백은 `StyleSheet` + 생성 `tokens.ts`(토큰 패키지는 어느 쪽이든 필요) |
| 데이터 | supabase-js + TanStack Query v5 + `expo-sqlite/kv-store` 퍼시스터 | `@supabase/supabase-js ^2.116.0`(`detectSessionInUrl:false`), `@tanstack/react-query 5.102.8`, `@tanstack/react-query-persist-client 5.102.8`, `@tanstack/query-async-storage-persister 5.102.8`, `expo-sqlite ~57.0.3`, `@react-native-community/netinfo 12.0.1` | 웹은 RSC 라 캐시 라이브러리가 없으므로 앱만. MMKV(`react-native-mmkv 4.3.2`, Nitro)는 동기 읽기가 필요해질 때. `react-native-url-polyfill` 제거(Expo 가 URL 제공). supabase-js 3 은 `next` 에만 — `^2` 고정 |
| 세션 저장 | `expo-secure-store` + 기존 청킹 어댑터 `apps/mobile/src/lib/secure-storage.ts` 유지 | `expo-secure-store ~57.0.4` | iOS 2 KB 이력을 이미 우회 |
| 인증 SDK | Google Original, Kakao `@react-native-kakao/*`, Apple | `@react-native-google-signin/google-signin 16.1.5`, `@react-native-kakao/user 2.4.6` + `@react-native-kakao/core 2.4.6`, `expo-apple-authentication 57.0.2`, PKCE 폴백 `expo-web-browser 57.0.3` | seoul `kakao-login 6.0.4` 는 New Arch 미명시, `@react-native-kakao/*` 는 New Arch·Expo 플러그인·OIDC nonce 명시 |
| 이미지·PDF·드로잉 | `expo-image`, `react-native-pdf` 7(Fabric) + blob-util + out-of-tree config plugin, Skia | `expo-image ~57.0.5`(`cachePolicy: memory-disk`, `prefetch`), `react-native-pdf 7.0.5`, `react-native-blob-util 0.25.0`, `@shopify/react-native-skia 2.6.2`(SDK 57 핀) | 공식 `expo-pdf` 없음. Phase 0 기기 검증 실패 시 폴백 = 서버 사전 렌더 페이지 이미지(`expo-image`) |
| 아이콘 | `lucide-react-native` + `react-native-svg` | `lucide-react-native` = 루트 `package-lock.json` 의 `lucide-react` 설치 버전(현재 `1.26.0`; `apps/web/package.json` 은 `^1.22.0`)과 **같은 번호로 고정** — lucide 모노레포는 전 패키지를 같은 버전으로 발행(`1.22.0` 존재 확인, latest `1.46.0`); `react-native-svg 15.15.4`(SDK 57 핀, lucide peer `^12–^15` 충족) | 크기 규격 12–22 그대로; 글리프 세트를 웹과 정확히 맞추려면 버전 번호가 같아야 한다 |
| 광고 | AdMob | `react-native-google-mobile-ads 16.5.0`, `expo-tracking-transparency 57.0.2` | AdSense 코드는 네이티브 앱 금지 |
| 관측(크래시·분석) | `@sentry/react-native`(Expo config plugin `@sentry/react-native/expo`, EAS 빌드에서 소스맵 자동 업로드) + 제품 분석은 GA4 앱 스트림(`@react-native-firebase/analytics`, `google-services.json`/`GoogleService-Info.plist` 필요) **또는 분석 없이 출시** — §13 질문 12 | `SENTRY_AUTH_TOKEN` 은 EAS 시크릿, `SENTRY_DSN` 은 `EXPO_PUBLIC_SENTRY_DSN`; Sentry `release` = `Updates.updateId ?? Application.nativeBuildVersion`, `dist` = 채널(OTA 마다 소스맵이 갈리므로 EAS Update 훅에서 업로드) | 웹은 Vercel Analytics·GA4·Clarity 를 싣고(`app/layout.tsx:3-10,218-223`) `/privacy` 5·9항에 고지한다. 현재 앱은 릴리스 크래시가 `FatalErrorScreen` 스크린샷 외엔 어디에도 남지 않는다(`grep sentry\|crashlytics apps/mobile` 0건). 개인정보 원칙: 크래시 payload 에 문항 정답·해설 본문·`user_metadata` 를 넣지 않는다(`beforeSend` 로 `edge` 응답 body 제거) |
| 결제(Phase 5) | `expo-iap`(기본) 또는 RevenueCat | `expo-iap 5.6.0` / `react-native-purchases 10.9.1` | §8, §13 질문 2 |
| OTA·알림 | `expo-updates`(`runtimeVersion.policy: "fingerprint"`), `expo-notifications`(로컬만) | `expo-updates ~57.0.22`, `expo-notifications ~57.0.18` | 네이티브 의존이 많은 앱에서 OTA 불일치 방지 |
| 언어 | TypeScript ^5.9, `@types/react` 19 | | 웹과 통일, 루트 React 분리(18/19) 해소 |

### 3.2 모노레포 패키지 배치

```
packages/core/src/
  index.ts            기존: 순수 규칙 + types (React 의존 0 유지)
  server.ts           (신설) 서버 전용 진입점 — package.json exports "./server" 추가
  data/               (확장) DI 리포지토리: SupabaseClient 주입, RLS 범위 읽기·쓰기
  rules/              (신설) 서버 규칙: service_role 클라이언트 주입, 웹 서버 액션·Edge 공용
  edge/               (신설) Edge Function 요청/응답 계약 타입 + invokeEdge()
  nav-items.ts        (신설) PRIMARY_NAV/ACCOUNT_NAV 데이터(아이콘은 문자열 이름)
  badge-classes.ts    (신설) level/exam-type/subject/round-tier/streak 클래스 문자열 맵
packages/design-tokens/                     (신설) theme.css(정본) + tokens.json + scripts/gen.mjs → tokens.ts
supabase/functions/_shared/core.mjs         (신설, 생성물) packages/core 의 esbuild 번들 — 커밋, CI 가 --check
apps/mobile/src/queries/                    (신설) TanStack Query 훅 — React 의존은 여기까지만
apps/mobile/src/components/                 앱 전용 컴포넌트(패키지로 분리하지 않음)
```

- **`packages/core` 는 React 무의존 유지.** 훅은 앱에 둔다(웹은 RSC 라 훅을 안 씀). A 안의 `packages/ui`·`packages/queries` 분리는 소비자가 앱 하나뿐이라 채택하지 않는다 — 워크스페이스·Metro 마찰만 는다.
- **`@gongmoa/core/server`** 는 `apps/web`(서버 액션·route handler)과 `supabase/functions` 만 import 한다. `apps/mobile` 은 ESLint `no-restricted-imports` 로 차단(신설 규칙). 이로써 service_role 규칙이 앱 번들에 섞이는 일이 구조적으로 불가능해진다.
- **Edge 가 core 를 못 읽는 문제는 번들 생성으로 푼다.** `packages/core/scripts/bundle-edge.mjs`(신설)가 `src/server.ts`+`src/index.ts` 를 esbuild(`format: esm`, `platform: neutral`)로 단일 ESM 에 묶어 `supabase/functions/_shared/core.mjs` 에 쓴다. `packages/core/package.json` 은 `@supabase/supabase-js` 를 `dependencies` 로 선언하고 있다(지금은 `data/subjects.ts` 의 `import type` 뿐이지만, §3.4 가 `data/*`·`rules/*`·`edge/invoke.ts` 를 대량 추가하면 값 import 가 들어갈 수 있다). 그래서 esbuild 는 `bundle: true, external: ['@supabase/supabase-js']` 로 돌리고, `bundle-edge.mjs --check` 는 출력에 `esm.sh`·`node_modules` 문자열이 없는지와 `import` 구문이 0개인지(external 참조조차 없어야 한다 — Edge 는 `https://esm.sh/@supabase/supabase-js@2` 를 따로 읽으므로 이중 로드 금지)를 함께 검사한다. core 의 ESLint 에 `@supabase/supabase-js` 는 `import type` 만 허용(`@typescript-eslint/consistent-type-imports` + `no-restricted-imports` 값 import 금지) 규칙을 신설한다. 번들을 커밋하고 CI 가 재생성 후 diff 0 을 검사한다. `.d.ts` 도 함께 생성해 Deno 쪽에서 `satisfies` 로 계약 타입을 검사한다.

> **금지선 — `srs.ts` 동시 수정.** AGENTS.md 는 `packages/core/src/srs.ts` 와 `supabase/functions/_shared/srs.ts` 를 반드시 함께 고치라고 한다. 번들이 CI 게이트가 되기 전까지는 이 규칙을 그대로 지킨다. 번들이 들어간 뒤에는 두 파일이 "하나의 원본과 그 생성물"이 되어 규칙 의도가 기계적으로 보장되며, AGENTS.md 문구 갱신은 소유자 승인 사항(§13 질문 9). **순서 규칙**: 금지선이 파일명으로 지목한 `_shared/srs.ts`(및 같은 성격의 `_shared/review-pick.ts`·`_shared/profanity.ts`)는 §13 질문 9 승인 후 **AGENTS.md 수정과 같은 PR 에서만** 삭제한다. 그 전까지는 세 파일을 `_shared/core.mjs` 의 re-export 한 줄로 바꿔 두 경로가 같은 코드를 가리키게 한다(Phase 0 안에서 게이트 도입과 삭제를 한꺼번에 하지 않는다 — §6.8, §12).

### 3.3 디자인 토큰 공유 (Tailwind v4 ↔ RN)

정본은 `packages/design-tokens/theme.css`(신설). `apps/web/src/app/globals.css` 의 **네 구간** — `:root`(7–12행, `--background: #ffffff`/`--foreground: #171717`/`color-scheme: light`) + `@theme inline`(14–17행, `--color-background/--color-foreground` 매핑), `@theme {` 블록(28–40행), `[data-theme="dark"]` 오버라이드(42–53행), `@media (prefers-color-scheme: dark)` 블록(56–67행) — 을 **그대로 옮기고** `globals.css` 는 `@import` 한다(`@custom-variant dark`, `body`, 애니메이션 등 웹 전용 규칙은 남긴다). 라이트 `--background/--foreground` 가 `:root` 에, 다크 값이 `[data-theme="dark"]` 에 있으므로 27–65행만 옮기면 라이트/다크 정의가 두 파일로 갈라진다 — 그래서 `:root`+`@theme inline` 도 이동 범위다. `color-scheme` 값(light/dark)도 토큰 `colorScheme` 으로 내보내 앱의 테마 전환이 같은 원본을 쓰게 한다. 앱 `global.css`(신설)는 `@import "tailwindcss"` + 같은 `theme.css` 를 Uniwind 가 읽는다. **클래스명이 곧 계약**: 웹의 `bg-blue-600` 은 앱에서도 `className="bg-blue-600"` 이고 둘 다 `#0a7d5b` 를 그린다. "이름은 blue, 픽셀은 초록"이라는 웹 규약을 앱도 따르며 클래스를 emerald 로 고치지 않는다(globals.css 주석 취지). 상세 §4.1.

### 3.4 데이터 접근 공유

세 층으로 나눈다.

1. **리포지토리(`packages/core/src/data/*`)** — RLS 로 앱이 직접 읽고 쓸 수 있는 것. `SupabaseClient` 를 첫 인자로 받는 순수 async 함수(`data/subjects.ts getSubjectBySlug(supabase, slug)` 가 이미 그 패턴). 웹 서버 컴포넌트와 앱 훅이 같은 함수를 부른다.
2. **Edge 계약(`packages/core/src/edge/*`)** — service_role 이 필요한 것. 요청/응답 타입과 `invokeEdge(client, "cbt-submit", body)` 하나. 앱 `apps/mobile/src/lib/{cbt,review,explanations,diagnosis,account,paper-detail}.ts` 의 `toError/unwrap` 6벌을 대체.
3. **서버 규칙(`packages/core/src/rules/*`)** — 웹 `lib/question-status.ts`, `lib/status-targets.ts`, `lib/attendance.ts#recordAttendance`, `lib/explanation-rate-limit.ts`, `lib/review-session.ts`, `lib/review-queue.ts`, `lib/mix-practice.ts`, `lib/membership.ts#getMembership/isPremium` 을 옮긴 것. 웹 서버 액션과 Edge Function 은 **얇은 어댑터**가 된다.

이동 규칙: 웹 `lib/{question-status,review-session,review-queue,mix-practice,membership}.ts` 는 모두 `import "server-only"` 로 시작하고 `getMixPool` 은 `'use cache'` 에 기댄다. core `rules/*` 에는 **순수 규칙 + 주입된 클라이언트 호출**만 옮기고, `server-only`·`'use cache'`·`revalidatePath`·`createAdminClient()` 호출은 웹 어댑터 파일에 남긴다.

### 3.5 상태·캐시·내비게이션

- 서버 상태는 전부 TanStack Query(§6.3). 클라이언트 상태(테마, OMR 분할 비율, 힌트 dismiss, 드래프트)는 `expo-sqlite/kv-store` 에 웹 localStorage 키 이름 그대로: `theme`, `cbt:omr-split-ratio`, `cbt-lock-hint-dismissed`, `examAggregator:favOnly`, `review-draft:<sessionId>`, `review-nudge-day`(KST 날짜), `free-promo-hidden-day-v1`(KST 날짜), `attendance-promo-hidden-day-v1`(KST 날짜), `beta-notice-hidden-v1`(값 `"1"` — "다음부터 보지 않기" **영구** 숨김, `-day` 가 아니다; `beta-notice-slide.tsx:38,46,64`). 웹이 **sessionStorage**(탭 수명) 에 두는 키 — `free-promo-shown-v1`·`beta-notice-shown-v1`·`attendance-promo-shown-v1`·`review-fab:<srsDayIndex>` — 는 kv 에 저장하지 않고 **메모리(앱 프로세스 수명) 전용**으로 둔다(영구 저장하면 웹과 달리 다시는 안 뜬다). 전역 상태 라이브러리는 추가하지 않는다.
- 내비게이션은 `expo-router` Stack 하나 + **커스텀 우측 드로어**(Reanimated 오버레이, react-navigation drawer 미사용). 하단 탭 없음. 기존 `app/(tabs)/_layout.tsx` 폐기. 몰입 화면은 `Screen` 셸(신설 `src/components/screen.tsx`)의 `immersive` 옵션으로 헤더·FAB·광고를 빼고, 같은 옵션이 `<Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false }} />` 를 포함한다(§4.4, §4.5 #22).

---

## 4. 디자인 시스템 이식

### 4.1 토큰 파이프라인

**정본** `packages/design-tokens/theme.css` + 값이 필요한 소비자를 위한 `tokens.json`(신설). 그룹:

| 그룹 | 내용 | 출처 |
|---|---|---|
| `color.accent` | blue-50…950 light + dark(400/500/600/700) | `globals.css` 28–53행 |
| `color.base` | `--background`/`--foreground` light `#ffffff/#171717`, dark `#0a0a0a/#ededed`; `colorScheme` light/dark | `globals.css` 7–17행(`:root` + `@theme inline`) light, 42–44행 dark |
| `color.brand` | `#12b382`(로고·manifest), `#012854`(NAVY, 다크 `#0a7d5b`; `HomeSearchBox` 제출 hover `#0a3a72`, 다크 hover `#096b4e`), `#e7f2fc`(landing tint, hover `#d3e8f8`; 히어로 배경 `bg-[#e7f2fc]/45`(다크 `zinc-900/60`), 상단 띠 `/60`), `#FEE500`(Kakao, `text-black/90`), 프로모 그라데이션 `#1e3a8a→#4338ca→#7e22ce`, 드로잉 `PEN_COLORS ["#111827","#ef4444","#2563eb"]` + `PALETTE_PRESETS` 14색(`#f97316 #eab308 #84cc16 #16a34a #0d9488 #0ea5e9 #4f46e5 #7c3aed #a855f7 #ec4899 #f43f5e #78350f #1e3a8a #6b7280`) + `RAINBOW_GRADIENT`(conic `#ef4444→#f97316→#eab308→#22c55e→#06b6d4→#6366f1→#ec4899→#ef4444`) | `page.tsx:140,382`, `home-search-box.tsx`, `free-promo-slide.tsx`, `cbt-drawing-toolbar.tsx:7-31` |
| `color.semantic` | surface(white / zinc-900 `#18181b`), subSurface(zinc-50 / zinc-800 `#27272a`), border 3단(zinc-100/200/300 ↔ zinc-800/700), text 5단(zinc-900/700/600/500/400 ↔ zinc-100/200/300/400/500), overlay(`zinc-900/40` 드로어, `black/60` 드로어 다크, `black/40` OMR 시트·초성 모달, `black/50` 결과 모달, `zinc-900/50` 홈 팝업, `black/70` 홈 팝업 다크, `white/70`/`zinc-900/70` 해설 잠금 덮개), skeleton(`#e4e4e7`/`#27272a`, sweep 하이라이트는 토큰이 아니라 리터럴 `rgba(219,234,254,0.9)`(Tailwind 기본 blue-100 = 진짜 파랑) + `rgba(255,255,255,0.95)`, `--skeleton-delay` 캐스케이드 — 앱이 재정의된 `blue-100`(`#d1fae5`)으로 그리면 색이 달라진다), focus `rgba(18,179,130,0.18)` + `input:focus border #12b382`, correct emerald-500 fill / 600·700 text, wrong red-500/600, warning amber-50·100/700·800·900 | design-system 리포트 §1.2; `home-popup-slider.tsx:299`, `explanation-lock.tsx:38`, `cbt-result-modal.tsx:21`, `globals.css:271-288` |
| `richText` | `.board-content` 규칙(`globals.css` 410–470행): `p` min-height `1lh`, `h2` 1.25rem / `h3` 1.1rem, `blockquote` `border-left 3px var(--color-blue-300)` 글자 `#52525b`(다크 `#a1a1aa`), 링크 `var(--color-blue-600)`(다크 `--color-blue-400`) underline offset 2px, `hr` `#e4e4e7`/`#3f3f46`, `pre` `#f4f4f5`/`#27272a` radius 8, `img` radius 12 margin 12 | `globals.css`, `rich-text-content.tsx` — `RichTextContent` 렌더러(#31)가 임의값을 쓰지 않도록 토큰화 |
| `radius` | 4(badge `rounded`), 6(md), 8(lg), 12(xl 카드), 16(2xl 섹션·모달), 24(3xl 시트), 999(full) | |
| `space` | 4px 그리드; 페이지 셸 `px-4 pt-6 pb-12`; 카드 `p-4 gap-3`; 섹션 카드 `px-5 py-4`; 행 `px-3 py-2.5`; 칩 `px-4 py-1.5`; 배지 `px-2 py-0.5` | |
| `text` | xs 12/16, sm 14/20, base 16/24, lg 18/28, xl 20/28, 2xl 24/32, 3xl 30/36; 커스텀 10·11·13·15·27; weight 500/600/700/800 | 사용 빈도 `text-sm` 512, `text-xs` 346, `text-[11px]` 92 |
| `shadow` | sm/lg/xl/2xl + `blue-600/25`(FAB), `#12b382/30`(로고) | |
| `z` | 20 suggestions, 30 header / 하단 고정 선택 바(`subject-paper-list.tsx:206`, `subject-wrong-note-questions.tsx:418,440`), 40 FAB/toast/OMR sheet, 50 drawer/modal/bell/초성 모달, 60 home popup | |
| `motion` | modalFadeIn 180ms ease-out, modalPanelIn 240ms `cubic-bezier(0.16,1,0.3,1)` translateY 12 scale .98, drawerIn 260ms `cubic-bezier(0.16,1,0.3,1)`, themeCrossfade 400ms, skeletonSweep 1800ms, transitionColors 150ms, badge shimmer/flash/glow `--badge-duration`(2.4–3.5s), loadingFloat 2200ms ease-in-out infinite(translateY −6px), loadingFadeIn 350ms ease-out, loadingBar 1600ms(translateX −100%→60%→220%), promoShine 3600ms, promoHeroDrift 9000ms, promoCtaPulse 2800ms(`prefers-reduced-motion` 시 promo-* 도 off) | `globals.css:122-165, 175-247, 255-334, 347-402` |
| `layout` | headerHeight 65, gutter 16, omrSplit default .42 / min .3 / max .7, 문항 이미지 기준 폭 `BASE_CONTENT_WIDTH 605`(zoom 100%) / 높이 맞춤 하한 `MIN_FIT_WIDTH 300`, `ZOOM_STEP 0.1`, PDF 렌더 동시성 3 | `cbt-omr-split.ts`, `question-view-gestures.ts:16-39`, `pdf-canvas-viewer.tsx:499` |

**생성기** `packages/design-tokens/scripts/gen.mjs`(신설): (a) 웹용 CSS 는 정본 그대로(Tailwind 기본값은 내보내지 않아 웹 픽셀 불변), (b) `tokens.ts`(light/dark 완전 해석 hex — Skia 캔버스, `StatusBar`, lucide `color` prop, AdMob 배경, `adaptiveIcon.backgroundColor` 용). **drift 테스트** `packages/design-tokens/tokens.test.ts`(신설): 행 번호가 아니라 `globals.css` 를 파싱해 `:root {…}`, `@theme inline {…}`, `@theme {…}`, `[data-theme="dark"] {…}`, `@media (prefers-color-scheme: dark) {…}` 다섯 블록을 추출하고 생성 CSS 의 같은 블록과 텍스트 diff 0 인지(웹 `@import` 전환 전 회귀 가드 — 행 번호로 자르면 여는/닫는 중괄호가 잘린다), palette hex 가 Tailwind 정본 oklch 에서 ΔE 임계 이내인지 검사. CI 는 `gen --check` 로 생성물 신선도를 막는다.

**배지 팔레트**: `apps/web/src/lib/level-colors.ts`(9급 `bg-blue-600 text-white`=초록, 8급 teal-600, 7급 orange-500, 5급 purple-600, 기타 zinc-500), `exam-type-colors.ts`(한능검 rose-600 포함 **13종 + zinc 폴백**, 맵이 **셋** — `examTypeColor`(테두리), `examTypeTabColor`(선택 탭 border+bg-50), `examTypeFilledColor`(채움); `exam-type-icons.ts` 쪽이 경력경쟁·군무원 포함 14종이라 숫자가 다르다), `exam-browser.tsx:41-45` 의 **네 번째 로컬 맵**(GROUPS 버튼 전용 — 경찰 `bg-sky-700`, 소방 `bg-red-600`, 계리직 `bg-emerald-600`; filled 맵의 경찰 slate-600·계리직 lime-700 과 값이 다르다), `subject-colors.ts`(8슬롯), `round-tier.ts`(그라데이션+shimmer), `streak.ts`(틴트 필)의 **클래스 문자열 맵을 `packages/core/src/badge-classes.ts`(신설)로 옮겨** 웹 lib 5개는 re-export 만 남긴다. `badge-classes.ts` 는 시험유형 맵을 `examTypeOutline`/`examTypeTab`/`examTypeFilled`/`papersGroup`(exam-browser 전용 3색) 네 개로 명시한다 — 하나라도 빠지면 `/papers` 그룹 버튼 색이 웹과 갈라진다. 앱은 같은 문자열을 Uniwind `className` 으로 쓴다. 경계값은 core `roundTierName`(≥10/6/4/2/1)·`streakTierName`(≥30/14/7/3/1) 그대로. 8급·한능검 누락이 재발할 구조 자체를 없앤다. 과목 팔레트 슬롯 0(`bg-blue-100 text-blue-700`)이 웹에서 초록(`#d1fae5/#06664a`)으로 렌더되어 슬롯 3 emerald 와 비슷한 현상은 웹을 고치지 않는 한 앱도 동일하게 재현(§13 질문 4).

### 4.2 타이포·폰트

웹은 웹폰트를 싣지 않는다(`Arial, Helvetica, sans-serif` → 한글은 OS 기본). 앱도 시스템 폰트 — iOS 는 Apple SD Gothic Neo, Android 는 **OEM 기본값**(삼성 One UI 등 제조사마다 다르다 — "Noto Sans CJK" 로 단정하지 않고 특정 글꼴명을 지정하지 않는다). `AppText`(신설) 컴포넌트가 `variant`(xs…3xl, 커스텀 10/11/13/15/27), `weight`, `tabular`(`fontVariant: ['tabular-nums']`), `pretty`(iOS `lineBreakStrategyIOS="hangul-word"`, Android `textBreakStrategy="highQuality"` = 웹 `break-keep` 33곳), `selectable={false}`(해설 `select-none` 대응)를 받는다. Android 에서는 `includeFontPadding: false` + `textAlignVertical: 'center'` 를 기본으로 하고 lineHeight 는 웹 값 그대로 준다(기본 `includeFontPadding: true` 면 CJK 에서 `text-sm 14/20` 줄높이가 위아래로 늘어나 배지·칩 높이가 어긋난다). **Phase 0 스파이크 체크리스트**: `①…⑩`·`ㄱ~ㅎ` 초성 탭·`tabular-nums`·`text-[10px]` 렌더 스크린샷(iOS/Android 각 1대); core 가 `toLocaleDateString('en-CA',{timeZone})`·`toLocaleString` 을 5개 모듈(`format.ts#kstDayKey`, `attendance.ts`, `mix-practice.ts`, `pricing.ts`, `streak.ts`)에서 쓰므로 `kstDayKey`·`toLocaleString('ko-KR')` 결과가 Hermes(iOS·Android)에서 node 와 같은지 core 테스트를 기기에서 1회 실행(시간대를 UTC 로 바꾼 에뮬레이터 포함 — 다르면 KST 일자 키가 기기 시간대에 따라 어긋난다).

**폰트 스케일**: `AppText` 기본 `maxFontSizeMultiplier` 1.3(레이아웃 붕괴 방지용 플랫폼 적응). 배지(`text-[10px]`/`[11px]`)·OMR 원형 선택지(`h-10 w-10`)·헤더는 `allowFontScaling={false}` 로 고정하고, CBT 하단 바는 `minHeight` 로 늘어나게 한다.

**접근성 규칙**(웹은 `aria-*`/`sr-only`/`role` 164곳·`aria-label` 98곳, 현재 앱 트리는 `accessibilityLabel`/`accessibilityRole` 0건): (1) 아이콘 전용 `Pressable` 은 반드시 `accessibilityLabel`(웹 `aria-label` 문구 그대로 — `site-header.tsx`·`bookmark-button.tsx`·`cbt-drawing-toolbar.tsx` 의 값을 `core/nav-items.ts`·컴포넌트 props 로 이관) + `accessibilityRole="button"`; (2) 선택지·탭·칩은 `accessibilityState={{selected}}`, 토글은 `role="switch"` + `checked`; (3) 문항 이미지 `accessibilityLabel` = 웹 alt 문구(`single-question-view.tsx:123` `${firstNumber}번 문제 이미지 ${i+1}`, `wrong-note-question-card.tsx:230`), 장식 아이콘은 `accessible={false}`; (4) 스와이프 삭제(#29)·드로어 제스처에는 버튼 대체 경로(알림 행 롱프레스 메뉴, 헤더 햄버거); (5) Maestro 플로우(§11)가 `accessibilityLabel` 셀렉터를 쓰므로 라벨은 테스트 계약이기도 하다.

### 4.3 다크 모드·아이콘·모션

- **다크**: 웹 `theme-toggle.tsx` 규칙 그대로 — kv-store 키 `theme`(`light`|`dark`), 없으면 `Appearance.getColorScheme()`. `useThemePreference()`(신설)가 `Uniwind.setTheme('light'|'dark'|'system')` **하나만** 호출한다(Uniwind 가 내부에서 `Appearance.setColorScheme` 을 대신 호출해 키보드·시트·상태바까지 맞춘다 — 두 번 부르면 중복이고 `system` 에서 `setColorScheme(null)` 순서가 어긋나면 되돌림 루프가 생긴다; `Appearance.setColorScheme` 직접 호출은 폴백 `StyleSheet` 경로에서만). 헤더 토글 아이콘 `Moon`(라이트)/`Sun`(다크) 18. 전환은 Reanimated 400ms 크로스페이드(웹 View Transition 대응, `AccessibilityInfo.isReduceMotionEnabled` 면 즉시).
- **아이콘**: `lucide-react-native`. 로고 `GraduationCap` 22(드로어 18), `Menu` 20, `Bell` 19, `X` 19(드로어)/18(OMR 시트)/14(자물쇠 힌트), 드로어 `PRIMARY_NAV` 항목 18 / `ACCOUNT_NAV` 항목 17 / 데스크톱 `UserMenu` 16, 카드 `MapPin`/`Monitor` 12, `ChevronRight` 14(해설 토글 14, `rotate-90`), `Bookmark` 14/18, CBT 헤더 `ChevronLeft` 20·`Clock` 16·`Hand`/`PenLine`/`Eraser` 18·`ZoomIn`/`ZoomOut` 20·`Lock`/`LockOpen` 16(모드 잠금)·`PanelRightClose` 16(분할 패널)·`Trash2` 14(전체 지우기), 문제별 하단 `ChevronLeft`/`ChevronRight` 22·`Check` 22(제출), 복습 `Check` 18(제출)·`RotateCcw` 16(재도전)·`Shuffle` 16/15, `Lock` 13(해설 잠금)/16(복습 잠금 카드), 해설 페이지 `Hourglass`/`LockKeyhole` 28·`Monitor` 15, 결과 `Trophy` 40, 404 `FileQuestion` 48. 시험유형 마크는 `apps/mobile/assets/exam-types/*.webp`(웹과 동일 8종) + `한능검 → government.webp` 추가. Google/Kakao 로고는 `google-icon.tsx`/`kakao-icon.tsx` 패스를 `react-native-svg` 로.
- **모션 매핑**:

| 웹 | 앱 |
|---|---|
| `modal-fade-in` 0.18s | 오버레이 `withTiming(1,{duration:180})` |
| `modal-panel-in` 0.24s bezier(0.16,1,0.3,1) | 시트 `translateY 12→0`, `scale .98→1`, `Easing.bezier(0.16,1,0.3,1)` |
| `drawer-in` 0.26s translateX(100%) | 드로어 `translateX width→0` |
| `skeleton-sweep` 1.8s | `Skeleton` `withRepeat` 그라데이션 이동(하이라이트 리터럴 `rgba(219,234,254,0.9)`, `--skeleton-delay` 캐스케이드 = `delay` prop) |
| tier `badge-shimmer/flash/glow` | `TierBadge` Skia 그라데이션 + shimmer 오버레이(`--shimmer-opacity` 0–0.9) |
| `loading-float` 2.2s / `loading-fade-in` 0.35s / `loading-bar` 1.6s | PDF 로딩 화면(`pdf-canvas-viewer.tsx:40-44,318-319` — 아이콘 부유 + `LOADING_MESSAGES` 3문구 2200ms 순환 + 진행 막대)과 `diagnosis-board` 로딩; `withRepeat(withTiming)` |
| `promo-shine` 3.6s / `promo-hero-drift` 9s / `promo-cta-pulse` 2.8s | `FreePromoSlide`(#30) shine/drift/pulse — `useReducedMotion()` 이면 off(웹 `prefers-reduced-motion` 규칙과 동일) |
| `hover:` 계열 | `Pressable` pressed = 웹 `active:` 값(`active:bg-zinc-100`, `active:scale-[0.99]`) |
| `transition-colors` 150ms | 색 보간 생략(즉시), 스케일만 애니메이션 |
| `prefers-reduced-motion` | `useReducedMotion()` 으로 진입 애니메이션 비활성 |

햅틱(`expo-haptics`, SDK 정렬 버전)은 웹에 없는 플랫폼 적응이라 설정에서 끌 수 있게 하고 기본은 선택지 탭 `selectionAsync`, 채점 완료 `notificationAsync(Success)` 만.

### 4.4 내비게이션 크롬 ↔ 웹 모바일 폭 레이아웃

- **`AppHeader`**: 높이 65(64 + 1px `border-b border-zinc-200 dark:border-zinc-700`), 배경 `bg-white/85 dark:bg-zinc-950/85`(+`expo-blur` 선택), 상단 safe-area 위에 얹음. 좌: 로고 타일 `h-10 w-10 rounded-lg bg-[#12b382] text-white shadow-sm shadow-[#12b382]/30` + `GraduationCap 22` + 워드마크 `text-2xl font-bold text-[#12b382]`(탭 → `/`). 우: `ml-auto gap-1.5` 로 `h-9 w-9 rounded-full` 버튼 3개 — `NotificationBell`(로그인 시), `ThemeToggle`, `Menu 20`. 인증 판정 전에는 햄버거 자리에 `skeleton h-9 w-9 rounded-full`. **모든 화면에서 동일**("메뉴는 한 곳", `site-header.tsx` 주석). 스택 뒤로가기는 헤더에 넣지 않고 페이지 안 "← 홈으로" 크럼 + 시스템 제스처/버튼으로.
- **`NavDrawer`**: 오버레이 `bg-zinc-900/40 backdrop-blur-sm dark:bg-black/60`, 패널 `w-[86%] max-w-[20rem] bg-white dark:bg-zinc-900 shadow-2xl` + safe-area bottom. 상단 바 작은 로고(`h-8 w-8`, 아이콘 18, `text-lg`) + `X 19`. 계정 카드 `rounded-2xl bg-gradient-to-br from-blue-50 to-blue-50/30 dark:from-blue-950/40 dark:to-blue-950/10` + `Avatar lg` + "{nickname}님" + `MembershipBadge` + "마이페이지 보기"; 비로그인은 같은 카드 + `LoginLink`(`rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white`). `SectionLabel`(`text-[11px] font-bold tracking-wide text-zinc-400 uppercase`) "메뉴" → `PRIMARY_NAV` 8행(기출문제·과목별·섞어풀기·오답노트·[출석체크 `isAttendanceOpen()`]·AI 약점 진단·자유게시판·멤버십, 힌트는 `isFreeForAll()` 분기; 행 `rounded-xl px-3 py-2.5`, 활성 `bg-blue-50`, 아이콘 18(활성 `text-blue-600`/비활성 `text-zinc-400`), 라벨 `text-sm font-semibold` + 힌트 `text-[11px] text-zinc-400`), "내 학습·계정" → `ACCOUNT_NAV` 2그룹(마이페이지·내 시험 기록·즐겨찾기·알림 | 결제 내역·내 정보 수정·건의게시판·공지사항; 행 `rounded-xl px-3 py-2 text-sm font-medium`, 아이콘 17) — **이 섹션과 푸터 `SignOutButton`(`LogOut 16`, pending 시 "로그아웃 중...", pressed = 웹 hover `bg-red-50 text-red-600`)은 `user` 가 있을 때만 렌더**(`mobile-nav.tsx:201,239`), 관리자 `ShieldCheck` 항목은 **렌더하지 않음**. 활성 판정은 `usePathname()` + 항목별 `match`. 데이터는 `packages/core/src/nav-items.ts`(신설)에서, 아이콘 이름 문자열을 앱에서 lucide 로 매핑.
- **FAB**: `ReviewFab` 우하단(`bottom-5 right-5 z-40 rounded-full bg-blue-600 shadow-lg shadow-blue-600/25`, 스크롤 >400 이후, "복습 N" + `CalendarCheck 17`), `ChatFab` 좌하단(아이콘 전용 `MessageCircle 18`). 둘 다 `insets.bottom` 추가, 몰입 화면 숨김.
- **몰입 화면**(`/papers/[id]/cbt`, `/mypage/wrong-notes/[slug]/review/[sessionId]`, `/papers/[id]/pdf`; `site-header-gate.tsx` 정규식과 동일): 헤더·푸터·FAB·광고 제거, 루트 `flex-1 bg-white dark:bg-zinc-900` = 웹 `h-[100dvh]`. `<Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false }} />` 로 iOS 좌측 가장자리 스와이프 뒤로가기와 Android 14+ 예측 뒤로가기를 끈다 — `BackHandler` 는 iOS 스와이프를 잡지 못하고 `beforeRemove` 는 쓰지 않기로 했으므로(expo-router 58 대비) 이것이 없으면 스와이프 한 번에 확인 없이 응시가 이탈된다(현행 앱 트리에 `gestureEnabled`/`beforeRemove`/`BackHandler` 사용 0건).
- **앱은 폭과 무관하게 웹 `<lg`(<1024px) 레이아웃만 구현한다**(명시적 결정): 웹은 `lg` 에서 몰입 화면에도 전역 헤더를 보이고(`site-header-gate.tsx:24 hidden lg:block`), 솔버는 `lg:h-[calc(100dvh-65px)]`, 우측 고정 OMR `w-[240px]`(`cbt-solver.tsx:953`), 헤더 내 줌·전체화면 버튼을 그리지만 앱은 이 분기를 미이식한다. iPad 가로(1024px+)에서 같은 기기의 웹과 달라지는 것은 감수 — §13 질문 13.
- **태블릿·가로**: Phase 1–5 는 **폰 전용**으로 출시한다 — 현행 `app.json` 은 `ios.supportsTablet: true` + `orientation: portrait` 인데, `supportsTablet` 이 true 면 App Store Connect 가 iPad 스크린샷을 요구하고 심사도 iPad 에서 한다. `ios.supportsTablet: false`(iPad 는 호환 모드로 실행), `orientation: portrait` 유지. 예외는 `/papers/[id]/pdf` 와 CBT 전체보기(#22)만 `expo-screen-orientation` `unlockAsync()` 로 가로 허용 후 이탈 시 `lockAsync(PORTRAIT_UP)`. 폰 가로 폭(≥600dp 폴더블 펼침 포함)에서는 웹 `sm:` 분기(카드 2열)를 따르지 않고 1열 + `max-w-[640px] self-center` 로 제한한다. 태블릿 정식 지원(웹 `md:`(`WIDE_HEADER_QUERY` 768px)·`lg:` 분기 재현, iPad 스크린샷)은 Phase 6 선택.
- **푸터** `AppFooter`: 몰입 외 화면 끝에 `site-footer.tsx` 링크 목록(기출문제·시험별·과목별·멤버십·게시판·공지·건의·약관·개인정보·문의·`BusinessInfo`); 컨테이너 `max-w-5xl px-4 py-6 text-xs text-zinc-400`, "문의" 는 `mailto:lks2354@gmail.com`(`Linking.openURL`), © 줄 "© 2026 공모아 — 공무원 기출문제 자료실".
- 페이지 셸 `px-4 pt-6 pb-12`, 카드 그리드 1열, 필터 스트립 가로 스크롤(`showsHorizontalScrollIndicator={false}`), 마이페이지 탭 4등분 `text-xs rounded-full` 필, 페이지네이션 5블록, 모달은 바텀시트(`rounded-t-3xl` + grab handle `h-1 w-9 bg-zinc-200`; 높이는 시트별 — #7).

### 4.5 컴포넌트 매핑표 (이식 순서 = 표 순서, 모두 `apps/mobile/src/components/`)

| # | 웹 컴포넌트 | 앱 컴포넌트 | 플랫폼 적응 |
|---|---|---|---|
| 1 | 토큰 | `theme/index.ts`, `AppText` | §4.1–4.2 |
| 2 | 버튼 클래스군 | `Button`(primary `rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white` / outline / tinted `border-blue-200 bg-blue-50 text-blue-700` / danger / neutral-dark / small / icon `h-9 w-9 rounded-full`) | `Pressable`, pending 시 lucide `Loader2 15` 회전; `disabled:opacity-50` |
| 3 | 배지 + `badge-classes.ts` | `Badge`(level/examTypeFilled/examTypeOutline/examTypeTab/papersGroup/subject/status/micro), `TierBadge`, `StreakPill`, `UnreadCount`(`h-4 min-w-4 bg-red-500 ring-2`) | 같은 클래스 문자열(§4.1 배지 팔레트의 네 시험유형 맵) |
| 4 | 칩/탭, `mypage-tabs.tsx`, `subject-index-tabs.tsx`, `wrong-note-view-tabs.tsx` | `Chip`, `ChipStrip`, `SegmentedTabs`, `ConsonantTabs`, `ViewTabs` | `ChipStrip` 활성 `bg-blue-600 text-white`, "전체" 칩 `bg-zinc-800 text-white`(`exam-browser.tsx:544` GROUPS·`subjects/[slug]/page.tsx:337,370` 급수/시험유형 필터 — 초성 탭이 아님). `ConsonantTabs`(`subject-index-tabs.tsx:43-117`): 맨 앞 한능검 알약 탭(`h-8 px-3 rounded-full border`, `kheHref` 로 곧장 이동) + 초성 원형 14개(ㄱ…ㅎ, `h-8 w-8 rounded-full border`, 가로 스크롤·스크롤바 숨김) → 탭 시 `CenterModal`(z-50 `bg-black/40`, `max-h 70% max-w-md rounded-xl p-5`, 제목 `'ㄱ' 과목`, "닫기")에 해당 초성 과목 2열 그리드 + 각 항목 `SubjectBookmarkButton`(sm); **활성 상태·"전체" 항목 없음** |
| 5 | 카드 클래스군 | `Card`(`rounded-xl border border-zinc-200 p-4`), `SectionCard`(`rounded-2xl` + `from-blue-50 to-white` 헤더), `TintCard`(blue/violet/amber), `StatTile`(`min-w-[7rem] rounded-xl border px-4 py-3`) | `expo-linear-gradient` |
| 6 | 입력, `search-input.tsx`, `search-suggestions.tsx`, `home-search-box.tsx` | `Input`(`rounded-lg border-zinc-300 px-3 py-2 text-sm`), `PillSearch`, `SearchInput`(`rounded-2xl border-2 px-5 py-4`, 포커스 `ring-4 ring-blue-100`), `SearchSuggestions`(≤6, `/subjects/:slug` 링크), `HomeSearchBox`(`bg-[#012854] dark:bg-[#0a7d5b]` 제출) | 드롭다운 대신 인라인 리스트; IME 가드·화살표 키 불필요; `parseSearchQuery`/`matchSubjectIds` core |
| 7 | 모달/시트 규격, `review-guide-modal.tsx` | `Sheet`(하단 `rounded-t-3xl`, grab handle(`sm:hidden` 대응 = 항상), `height` prop — 기본 `max-h 88%`(`review-guide-modal.tsx:57 max-h-[88vh] max-w-md`), 채팅 패널만 **고정** `h 85%`(`chat-panel.tsx:173 h-[85vh]`), CBT OMR 시트 `max-h 65%` + `rounded-t-2xl`(`cbt-solver.tsx:975`), 초성 모달·알림 드롭다운 `max-h 70%`; 헤더 `from-blue-50/80` 그라데이션 + 아이콘 타일 `h-9 w-9 rounded-xl from-blue-500 to-blue-600`), `CenterModal`(`max-w-sm rounded-2xl p-8`; 초성용 `max-w-md rounded-xl p-5`) | 단일 `max-h` 규격으로 통일하지 않는다(세 곳이 웹과 달라진다); 드래그로 닫기(GH), 키보드 회피, `window.confirm/alert` → `Alert.alert` |
| 8 | `.skeleton` + 22개 `loading.tsx` | `Skeleton`, 화면별 `*Skeleton`(`ExamCardSkeleton` 등) | Suspense 경계 = Query `isPending` |
| 9 | `Avatar`, `MembershipBadge`(`user-menu.tsx`; `UserMenu` 본체는 웹에서도 미사용) | `Avatar`(sm/md/lg/xl), `MembershipBadge`(`rounded-full bg-blue-600 px-1.5 text-[10px]`) | fallback `from-blue-500 to-blue-600` + core `avatarInitial` |
| 10 | `pagination.tsx` | `Pagination` | 항상 5블록, `router.setParams` |
| 11 | 빈 상태/404, 인라인 에러, `WrongNoteUndoToast` | `EmptyState`(dashed `rounded-2xl` + 아이콘 22–28 `text-zinc-300`), `InlineAlert`(`bg-red-50 text-red-600` / amber), `UndoToast`(z-40, 8s, 유일한 토스트) | 토스트 라이브러리 추가 안 함(웹과 동일) |
| 12 | `site-header.tsx` + `site-header-gate.tsx` | `AppHeader` | §4.4 |
| 13 | `mobile-nav.tsx` + `site-nav-items.ts`, `login-link.tsx`, `sign-out-button.tsx` | `NavDrawer` + core `nav-items.ts`, `LoginLink`(`/login?next=<현재 pathname+params>` 조립, `login-link.tsx:20`), `SignOutButton`(pending "로그아웃 중...", pressed `bg-red-50 text-red-600`) | 포털 → 루트 마운트 오버레이; 계정 섹션·로그아웃은 `user` 있을 때만(§4.4) |
| 14 | `theme-toggle.tsx` | `ThemeToggle` | §4.3 |
| 15 | `notification-bell.tsx` | `NotificationBell` | 60초 폴링(`refetchInterval`) + 포커스; 드롭다운 → `Sheet`(최근 8 + 전체보기) |
| 16 | `review-fab.tsx`, `chat-fab.tsx` | `ReviewFab`, `ChatFab` | `onScroll` 오프셋, 세션 캐시 `review-fab:<srsDayIndex>` 는 메모리 |
| 17 | `site-footer.tsx` | `AppFooter` | 약관·개인정보는 시스템 브라우저 시트(`legal.ts` `openBrowserAsync`); "문의" `mailto:`; 컨테이너 클래스 §4.4 |
| 18 | `exam-card.tsx` | `ExamCard` | `p-4 rounded-xl border`, 마크 24px, `Bookmark` 아이콘, 시험유형 배지는 **`examTypeFilledColor`(채움)**, 회독 배지 `tier-badge rounded-full px-2 py-0.5 text-xs font-bold` + 인라인 `--shimmer-opacity`/`--badge-duration`, title `{tier} ({n}회독)`; "바로 풀기"(`rounded-full border-blue-200 bg-blue-50 px-2.5 py-1`, **`hasCbtAnswers` 일 때만**)/"자세히 보기"; 카드 전체 `Pressable` + `hitSlop`, `paperHref` 슬러그 링크; 비현재 pressed = hover `border-blue-300 shadow-sm`; **현재 카드**(`exam-card.tsx:56,127`) `border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20` + `MapPin 12` + 우상단 필 "현재 보는 중"(`rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white`)이며 링크·즐겨찾기·회독 배지·하단 행을 **모두 생략** |
| 19 | `bookmark-button.tsx`, `subject-bookmark-button.tsx`, `favorite-subjects-editor.tsx`, `subject-quick-add.tsx` | 동명 | 낙관적 업데이트(`onMutate`), RLS 직접 |
| 20 | `exam-browser.tsx`, `wrong-note-shortcut.tsx` | `PapersBrowser`, `WrongNoteShortcut` | 웹처럼 전체 목록(`PaperWire` 튜플 + `cbtMask`) 클라이언트 필터, GROUPS 9급/8급/7급/5급/경찰/소방/계리직, 24/페이지, `?q,level,type,fav,page` 를 라우트 params 로, "기출문제" 재탭 → 1페이지 |
| 21 | `my-paper-history.tsx`, `difficulty-rating.tsx`, `comments-section.tsx`(+`comment-row/edit/reply`) | 동명 | `<details>` → 접기 토글; 난이도 0.5 단계 선택 후 제출, 비로그인 블러 + 로그인 CTA; `buildCommentTree` core, `comments-write` EF |
| 22 | `cbt-solver.tsx`, `single-question-view.tsx` + `question-view-gestures.ts` + `question-image-preload.ts` + `lib/image-preload-queue.ts`, `cbt-omr-panel.tsx` + `lib/cbt-omr-split.ts`, `cbt-drawing-toolbar.tsx`, `cbt-view-mode-lock.tsx`, `cbt-result-modal.tsx` + `diagnosis-progress.tsx`, `report-question-button.tsx`, `pdf-canvas-viewer.tsx`, `lib/cbt-view-mode.ts` | `CbtSolver`, `SingleQuestionView`, `OmrPanel`(compact 포함), `DrawingToolbar`, `ViewModeLock`, `CbtResultModal`, `ReportQuestionButton`, `PdfPenViewer`(react-native-pdf 7 + `SkiaInkLayer`) | **시작 상태기계**(`cbt-solver.tsx:222-269,695-712`): 진입 → 5초 카운트다운("N초 후 시작", `Clock 16`) → 0 이 되면 `cbt-start` EF 호출 → 응답 `startedAt` 수신 후에야 타이머 시작("시작하는 중..." → `formatDuration(elapsed)`); 실패 시 red 링크 "시작 기록 실패, 다시 시도"(`requestStart` 재호출). 진입 즉시 재거나 클라이언트 시계로 재지 않는다. **제출 가드 3단**(`:500-536`): started 전 `Alert("시작 기록 확인 중이에요. 잠시 후 다시 시도해주세요.")` → 90초 미만 `Alert(\`최소 ${formatDuration(MIN_ATTEMPT_SECONDS)}은 풀어야 채점할 수 있어요. 조금만 더 풀어보세요!\`)` → 미답 있으면 2버튼 `Alert(\`아직 ${n}문항을 안 풀었어요. 그래도 채점할까요?\`)`. "다시 풀기"(`handleRetry`)는 답안·결과 초기화 후 카운트다운 5초부터 재시작. **초기 모드** = core 로 옮긴 `resolveInitialCbtViewMode(defaultViewMode, hasQuestionImages)`(`lib/cbt-view-mode.ts:11-16`): 이미지 없음 → `full`, 잠금값 `full` → `full`, 그 외(`null`·`single`) → **`single`(사이트 기본)**; 이미지 없는 문제지는 "문제별 풀기" 탭 disabled(`opacity-40`, 안내 "문항별 이미지가 아직 등록되지 않았어요"); 탭 `rounded-full px-2.5 py-1 text-[13px] font-medium`, 활성 `bg-blue-600 text-white`(`cbt-solver.tsx:358-360` prop 주석 "전체보기로 시작" 은 stale — 따르지 말 것). **모드 전환**(`:464-488`)은 2버튼 `Alert` 확인 후 해당 모드 캔버스 스트로크 삭제: full→single "문제별 보기로 바꾸면 전체보기에 그린 필기 내용이 모두 지워져요. 계속할까요?", single→full "전체보기로 바꾸면 문제별 보기에 그린 필기 내용이 모두 지워져요. 계속할까요?"; "전체 지우기"(`clearDrawing`)는 현재 모드·현재 문항만. **세트 묶기** = core `groupQuestionsBySharedImages`(신설; `cbt-solver.tsx:402-427 questionGroups` 와 `wrong-note-question-card.tsx:40 groupRowsBySharedImages` 를 통일 — 연속 번호의 이미지 경로 배열이 완전히 동일하면 같은 세트): 이전/다음 이동은 세트 단위(`prevGroupNumbers[0]-1` / `groupLastNumber`), 상태줄 `12~13번`, 세트일 때 하단 제출 버튼의 `n/N` 카운트 숨김, `SingleQuestionView` 는 세트 번호마다 선택지 줄을 따로 두고 줄 앞에 `h-7 w-7 rounded-full bg-zinc-800 text-xs font-bold text-white` 번호 배지(줄이 하나면 배지 없음), 신고 버튼은 세트 첫 번호. 폰 폭 레이아웃 그대로(2줄 헤더 + 도구줄, `WIDE_HEADER_QUERY` 없음, §4.4 lg 미이식); 전체 모드 OMR = 좌우 분할(0.42, 0.3–0.7, kv `cbt:omr-split-ratio`; 구분선 `w-3 bg-zinc-100` + 핸들 `h-10 w-0.5 rounded-full bg-zinc-400`, 우측 패널 헤더 `PanelRightClose 16`, 키보드 ←/→ 0.05 단계는 미이식), 문제별 모드 OMR = `Sheet`(`rounded-t-2xl max-h 65% z-40` overlay `black/40`, 헤더 "답안 입력" + `X 18`; "답안 입력" 토글 버튼은 열림 시 `bg-zinc-200 text-zinc-700`); `OmrPanel`(`cbt-omr-panel.tsx`): 상단 `{n}/{N} 문항 표기`, 행 `rounded-lg border py-1`, 번호 `h-6 w-6 rounded-full bg-zinc-800`, 선택지 `h-6 flex-1 rounded text-xs`, 채점 후 행 `emerald-50/emerald-200` 또는 `red-50/red-200`, 버튼 `rounded-xl` 3단 문구 "제출하고 채점하기"/"채점 중..."/"채점 완료", compact 는 `px-2 gap-0.5 py-2.5 text-xs`; **패널은 문제지 단위 `choiceCount`, 문제별 뷰만 문항별 `questionChoiceCounts`**(둘을 통일하면 웹과 달라진다); 하단 바 `h-10 w-10` 원형 선택지(선택 blue-600, 정답 emerald-500, 오답 red-500). 제스처(`question-view-gestures.ts`): 스와이프 = **move 도구에서만** `|dx| ≥ 60 && |dx| ≥ 1.5·|dy|`(펜/지우개는 캔버스가 포인터를 잡음), 두 손가락이 닿으면 스와이프 취소; 핀치는 직전 대비 배율 곱, 줌 버튼 `ZOOM_STEP 0.1`(소수 2자리 반올림), `MIN_ZOOM 0.5`–`MAX_ZOOM 2.5`, `BASE_CONTENT_WIDTH 605`/`MIN_FIT_WIDTH 300`; 문항별 스트로크; `createImagePreloadQueue`(`lib/image-preload-queue.ts` `DEFAULT_CONCURRENCY 4`) 이식. `DrawingToolbar`(`cbt-drawing-toolbar.tsx`): 기본 3색 `PEN_COLORS` + `PALETTE_PRESETS` 14색 + 커스텀 HSV 피커(자체 색상환 + 명도 슬라이더 `hsvToHex`, OS 컬러피커 대신; `RAINBOW_GRADIENT` 트리거, `ChevronDown 12` 드롭다운) + 굵기 `DEFAULT_PEN_WIDTH 1.5`·프리셋 `[1,2,3.5]` + "전체 지우기"(`Trash2 14`); `tool === 'move'` 면 툴바 자체를 렌더하지 않음; 지우개 선폭 `ERASER_LINE_WIDTH 24`(`pdf-canvas-viewer.tsx:16`). 이탈 확인은 자체 뒤로가기 버튼 + Android `BackHandler` + `Alert` 로 하되, 몰입 화면(`papers/[id]/cbt.tsx`, `…/review/[sessionId].tsx`, `papers/[id]/pdf.tsx`)은 `<Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false }} />` 로 iOS 스와이프·Android 예측 뒤로가기를 끈다(expo-router 58 의 `beforeRemove` preventable 제거 대비); 전체화면 버튼 없음(항상 몰입) |
| 23 | `review-solver.tsx`, `review-schedule-section.tsx` | `ReviewSolver`, `ReviewScheduleSection`(`ForecastStrip`) | **카운트다운·최소 응시시간 없음**(CBT 와 다름). 헤더 제목 `오답 다시 풀기 · {subjectName}` / mix 는 `기출 섞어풀기`(`review-solver.tsx:261`), `ChevronLeft 20`; 드로잉 툴바는 `tool ≠ move` 일 때만, 줌 버튼은 웹 lg 전용(폰은 핀치); 문제 아래 캡션 "출처와 정답은 채점 후에 공개돼요."; 진행바 `h-1 bg-zinc-100` + `bg-blue-600`; 하단 `ChevronLeft/Right 22`; 마지막 문항은 `rounded-xl bg-blue-600 py-3` 큰 버튼 `제출하고 채점 (n/N)`(`Check 18`, pending "채점 중..."), 그 전엔 텍스트 링크 `지금 채점 (n/N)`; 드래프트 kv `review-draft:<sessionId>`, 제출 시 삭제; 이탈 2버튼 `Alert("아직 채점 전이에요. 이 주소로 돌아오면 이어서 풀 수 있어요. 나갈까요?")`(dirty = 미제출 & 답 1개 이상). **결과 화면**(`ReviewResult`, `:525-713`): 링 `h-28 w-28 rounded-full border-8 border-blue-600 border-r-zinc-200` + `정답률 N%`; 🎉 `{n}문항 극복/정답` emerald 필 + `{m}문항 아직/오답` red 필, 0점 문구 2종("이번엔 다 틀렸어요. 오답노트에서 해설을 보고 다시 풀어봐요 💪" 등, 톤 분리); mix 면 emerald 배너 '오답노트에 "{mixSessionTitle}"로 저장했어요…' → `/mypage/wrong-notes/[slug]/mix/[id]`; `틀린 N문항만 다시 풀기`(`RotateCcw 16`, mix 는 `createRetryFromMix({sessionId})`, 아니면 `createReviewFromWrong({items})`); `ReviewScheduleSection`; `오답노트로 돌아가기`(`bg-zinc-100`); 문항 카드 선택지 `h-9 w-9`(정답 emerald-500 / 내 오답 red-500), "풀지 않음" 필. **"찍었어요"(`GuessedButton`, `:478-522`)는 맞힌 문항에만**, 되돌리기 없음(단방향), 누른 뒤 amber 필 "찍은 문제로 표시했어요" — EF `review-guessed`(§6.7 #11) |
| 24 | `wrong-note-question-card.tsx`, `explanation-body.tsx`, `explanation-lock.tsx`, `explanation-disclosure.tsx`, `memo-editor.tsx`, `wrong-note-mark-actions.tsx`, `app/papers/[id]/explanations/page.tsx`(화면) | 동명 + `ExplanationsScreen` | 본문 `selectable={false}`; 순서 개정 배너(⚠️ "현행법상 성립하지 않는 문항" / "개정 주의 — 현행 기준 정답이 다릅니다") → 정답 요약(배지 "정답" emerald-100) → 핵심 개념 → 선지별(`①…⑧`, 개정 배지 "개정" amber-100 `text-[10px]`) → 개정 참고 → 현행법 기준; `ExplanationDisclosure` 는 접기 토글("해설 보기" / `{n}번 해설 보기`, `ChevronRight 14` → `rotate-90`, `text-sm font-medium text-blue-600`)이고 **펼칠 때만 본문을 렌더**(목록 성능, `explanation-disclosure.tsx:57`); `ExplanationLock` blur 3px + `Lock 13` + 문구 `{n}번 해설은 멤버십에서 볼 수 있어요`/`해설은 멤버십에서 볼 수 있어요` + CTA "멤버십 보러 가기" → `/membership?next=`; `MemoEditor` 명시 저장(현 blur 자동저장 폐기). **해설 페이지 화면 요소**(`explanations/page.tsx`): 제목 `{title} 해설`, 배지 줄 `examTypeColor`(테두리)+`subjectColor`; 범례 "정답" emerald 점 + `N문항 해설`; 무료 회원 성공 화면 상단 `오늘 남은 무료 해설 {remainingToday}개 · 오늘 열어본 문제지는 다시 봐도 차감되지 않아요` + `제한 없이 보기 →`(`remainingToday` 는 웹 `resolveExplanationAccess` 반환값 — **EF `explanations-get` 응답에 `remainingToday: number\|null` 추가 필요**, §6.7 #7); `일부 문항({n}개)의 해설은 아직 준비 중이에요` amber 안내(question_count > 해설 수); 빈 상태 "아직 해설이 등록되지 않은 문제지예요" + "문제지로 돌아가기"; 미리보기 단위는 문항이 아니라 **카드(세트 그룹) 2개**(`ANON_PREVIEW_CARDS = 2`, `groupRowsBySharedImages` 후 slice) 이고 rate-limit 상태에서도 2카드는 보임; 비로그인 잠금 `LockKeyhole 28` + `나머지 {n}문항 해설은 로그인하면 볼 수 있어요` + "로그인하고 전체 해설 보기"; rate-limit `Hourglass 28` + "잠시 후 다시 시도해주세요" + "요청이 많아 전체 해설 표시가 일시적으로 제한됐어요."; free-quota `MembershipUpsell` title "오늘 무료로 볼 수 있는 해설을 다 봤어요" + `FREE_EXPLANATION_DAILY_PAPERS` 문구; 하단 "온라인에서 풀기"(`Monitor 15`) / "문제지로"; `print-button` 자리는 비움(§1 비목표) |
| 25 | `subject-paper-list.tsx`, `subject-wrong-note-questions.tsx`, `wrong-note-paper-view.tsx`, `round-average-compare.tsx`, `mix-session-list.tsx`, `mix-session-view.tsx` | 동명 | 하단 고정 선택 바(`subject-paper-list.tsx:204-228`): `fixed inset-x-0 bottom-4 z-30`(z-40 아님) 안의 `max-w-md rounded-2xl border p-2 shadow-lg` 카드, 왼쪽 `해제` 버튼 + `선택한 ${n}개 시험지 합쳐 풀기`(`Shuffle 15`) = safe-area; `subject-wrong-note-questions` 의 선택 바도 같은 `z-30/bottom-4`, 에러 문구는 `bottom-20`; 정렬 그룹 단위(세트 문항 유지). `MixSessionView`(`mix-session-view.tsx:92-255`): **Phase 2 에서는 `새로 섞어풀기`(tinted, → `/subjects/[slug]/mix`) 1버튼**이고, 웹의 `틀린 {n}문항 다시 풀기`(primary)는 **Phase 3** 에 EF `mix-create` `{action:"retry"}`(§6.7 #14, §12 Phase 3 "믹스 기록·재도전")와 함께 붙는다 — `review-create` 의 `items` 분기로 대신할 수 없어서다(세션 문항은 dedup 대표 문제지 id 라 `filterQuestionsAnsweredByUser` 에 걸려 전부 빠진다; `mix-session-view.tsx` 머리 주석에 근거를 적어 뒀다). 결과 화면(`review-result.tsx`)도 mix 에서는 같은 이유로 이 버튼을 그리지 않는다; 필터 칩 `틀린 문항 N` / `전체 N문항`(`rounded-full px-3.5 py-2 text-sm`, 틀린 0이면 disabled·기본 all), 설명 문구 2종, 빈 상태 "이 섞어풀기에서는 틀린 문제가 없어요. 완벽했어요! 🎉"; 행 헤더 = 위치번호·`examTypeFilledColor` `text-[11px]`·level 배지·`{paperTitle} {n}번`·정답 필; 정답 문항엔 `MemoEditor`·`WrongNoteMarkActions` 없음 |
| 26 | `review-due-card.tsx`, `review-guide-modal.tsx`, `attendance-card.tsx`, `diagnosis-banner.tsx`, `diagnosis-sample-report.tsx`, `app/mypage/page.tsx` 의 지역 함수 `NextActionCard`(499행)·`HowItWorksStrip`(673행) | 동명 + `NextActionCard`, `HowItWorksStrip`(이식 시 파일로 분리), `DiagnosisSampleReport`(순수 마크업 — `/diagnosis` 소개 화면의 violet dashed 카드 `rounded-2xl border-dashed border-violet-300 bg-violet-50/40`, "이렇게 나와요 / 예시 화면 · 실제 데이터 아님") | 토글 스위치 트랙 `h-6 w-11` 커스텀(웹 규격 유지); 출석 카드는 `isAttendanceOpen()` 일 때만 |
| 27 | `mix-subject-picker.tsx`, `mix-practice-starter.tsx` | 동명 | 연도 `<select>` → `Sheet` 목록; `clampMixLimit`, `normalizeYearRange` core |
| 28 | `app/membership/page.tsx`(`CurrentStatus`:211·`StatusPill`:262·`FEATURE_ROWS`:287·`FeatureTable`:313·`faqItems`:398 — `membership-plans.tsx` 가 아니라 페이지 파일 안), `membership-plans.tsx`, `membership-upsell.tsx`(`MembershipLockedPage`:65) | `MembershipStatus`, `MembershipUpsell`, `MembershipLocked` | 플랜 카드·가격·구매 버튼은 Phase 5 전까지 렌더하지 않음(§8.1, FAQ 는 `MEMBERSHIP_FAQ_APP` 부분집합) |
| 29 | `notification-list.tsx` | `NotificationList`(`divide-y rounded-2xl border`, 미읽음 `bg-blue-50/50` + 점) | 스와이프 삭제(플랫폼 적응) + 롱프레스 메뉴 대체 경로(§4.2 접근성) |
| 30 | `home-popup-slider.tsx` + 4 slide | `HomePopupSlider`(z-60, 오버레이 `zinc-900/50` 다크 `black/70`, 스와이프 임계 `max(40, 18%)`, edge drag ×0.3, 500ms 후), `FreePromoSlide` promo-* 모션(§4.3) | "오늘 하루 보지 않기" = kv `free-promo-hidden-day-v1`/`attendance-promo-hidden-day-v1`(KST 날짜), 베타 안내 "다음부터 보지 않기" = kv `beta-notice-hidden-v1`(`"1"`, 영구); `*-shown-v1` 은 **메모리 전용**(웹 sessionStorage 파리티, #16 의 `review-fab:<srsDayIndex>` 와 같은 규칙); `attendance-promo.png` 는 `apps/mobile/assets/attendance-promo.png` 로 번들(§5 미이식 라우트) |
| 31 | `rich-text-content.tsx`(`.board-content` 규칙), `rich-text-editor.tsx` | `RichTextContent`(**자체 렌더러**: `packages/core/src/rich-text.ts` 의 `ALLOWED_TAGS`(22종: p, br, div, span, b, strong, i, em, u, s, strike, h2, h3, blockquote, ul, ol, li, pre, code, hr, a, img)를 core 에서 export 해 렌더러가 그 키 목록을 읽고 `Text`/`View`/`expo-image` 로 그린다; 렌더 규칙은 §4.1 `richText` 토큰 = `.board-content` CSS 1:1), `BoardEditor`(축소판: 굵게/기울임/밑줄/취소선/목록/인용/링크/이미지) | HTML 렌더는 이 한 곳만(웹 규칙과 동일). `react-native-render-html` 은 **기본 채택 불가**: 순수 JS 라 New Arch 는 쟁점이 아니고, 마지막 릴리스가 6.3.4(2022-01-24)이며 함수 컴포넌트 `defaultProps` 를 쓰는데(이슈 #661, #688 미해결) React 19(SDK 57 = React 19.2.3)는 함수 컴포넌트 `defaultProps` 를 적용하지 않아 기본값이 `undefined` 로 들어간다(의존성 `@native-html/transient-render-engine 11.2.3`·`ramda 0.27` 도 같은 시기). 지금 알 수 있는 사실이라 "Phase 5 초입 검증"으로 미루지 않고 자체 렌더러를 Phase 5 정식 작업으로 잡는다 |
| 32 | `board-*`(`board-post-actions.tsx` 의 `BoardShareButton` 포함), `notice-*`, `suggestion-*`, `chat-panel.tsx` | 동명 | 채팅 패널 = 좌하단 앵커 `Sheet`(고정 `h 85%`), 버블 `max-w-[85%] rounded-2xl text-[13px]`; `BoardShareButton`(웹은 `navigator.clipboard.writeText(window.location.href)`, `:69-92`) → RN `Share.share({ url: \`https://gongmoa.kr/board/${id}\` })` — **항상 웹 canonical URL**, 앱 스킴·`EXPO_PUBLIC_WEB_URL` 조립 금지(해외 수신자는 geo-block 403 을 볼 수 있음을 인지); 문제지 상세·해설에는 웹에 공유 버튼이 없으므로 앱에도 두지 않음 |
| 33 | `ad-banner.tsx` | `AdBanner`(AdMob `BannerAd`, `min-h-[100px]` 예약) | §8.4 |
| 34 | `profile-image-field.tsx`, `nickname-field.tsx`, `cbt-view-mode-field.tsx`, `delete-account-button.tsx` | 동명 | 사진 선택 `expo-image-picker`(SDK 정렬) |
| — | `print-button.tsx`, `explanation-auto-print.tsx`, `json-ld.tsx`, `ad-slot.tsx`(사이드 레일), `microsoft-clarity.tsx`, 관리자 전용 `notice-form.tsx`·`notice-delete-button.tsx`·`suggestion-answer-form.tsx`, `scroll-to-hash.tsx`(loading.tsx 뒤 해시 스크롤 — 앱은 `/mypage#wrong-notes`(`review-fab.tsx:114` 폴백, `mypage/page.tsx:721 id="wrong-notes" scroll-mt-4`)·`#comment-…` 를 `?tab=`·`#comment-` 파라미터로 받아 `scrollTo` 로 대응), `user-menu.tsx` 본체 | 이식 안 함 | 웹 전용(앱 크래시·분석은 §3.1 관측 행) |

---

## 5. 화면·내비게이션 맵

원칙: **앱 라우트 경로 = 웹 URL 경로.** 유니버설 링크(AASA/assetlinks 는 `apps/web/public/.well-known/`(신설))와 앱 내 `router.push(pathname)` 이 한 매핑이 된다. `[id]` 는 슬러그·UUID 모두 받는다: core `isPaperUuid` 면 그대로, 아니면 카탈로그 `(id,title,round,track)` 로 `getPaperSlug()` 역색인(`packages/core/src/data/paper-slug-map.ts` 신설 — 웹 `lib/paper-slug-map.ts resolvePaperId` 와 같은 규칙, 퍼시스트). 링크 생성은 신설 `src/lib/paper-href.ts`(웹과 같은 `paperHref`/`paperCbtHref`/`paperExplanationsHref`, `encodeURIComponent`). 게이트: O 공개, L 로그인(`router.replace('/login?next=…')`, `next` 는 core 로 옮긴 `sanitizeNextPath`), P 프리미엄(`isPremium` = admin ∥ `isPremiumMembership`; `FREE_UNTIL` 까지 전원). **`next` 화이트리스트**: `sanitizeNextPath`(`lib/safe-redirect.ts`)는 `/` 로 시작하는 모든 경로를 통과시키므로(`//`·`/\\` 만 거른다) 앱에서는 미이식 경로(`/admin/*`, `/api/*`, `/download/*`)가 `next` 로 들어올 수 있다 → 앱의 `next` 처리는 `sanitizeNextPath` 뒤에 아래 표의 ✓ 경로 화이트리스트(라우트 매처)를 한 번 더 통과시키고, 실패하면 `/papers` 로 떨어뜨린다. `gongmoa://` 커스텀 스킴 링크는 AASA 제외 목록의 보호를 받지 않으므로 같은 매처를 지나며, `/admin/*`·`/api/*`·`/download/*` 는 웹 URL 재매핑 규칙(`/download` 행)이 없으면 `+not-found` 로 보낸다.

| 웹 라우트 | 앱 파일 (`apps/mobile/app/`) | 배치 | 로그인 | 멤버십 | 딥링크 |
|---|---|---|---|---|---|
| (루트 레이아웃) | `_layout.tsx`(Providers·`QueryClient`·persister·`onlineManager`/`focusManager` 연결·`ErrorBoundary` export(기존 패턴 유지, §6.9)·`ForceUpdateScreen` 게이트(§6.6)) | — | — | — | — |
| (미매칭) | `+not-found.tsx`(신설 — 현행 트리에도 없음; 웹 `app/not-found.tsx` 1:1, `FileQuestion 48`; 딥링크·`next` 화이트리스트 실패 시) | Stack | O | — | — |
| `/` | `index.tsx`(랜딩: 팝업·TopBanner·Hero+TodayStudy·PastQuestions(검색+6 시험 카드)·Diagnosis·ClosingCta·AdBanner) | Stack root | O | — | ✓ |
| `/papers?q&level&type&fav&page` | `papers/index.tsx` | Stack | O(배지만 L) | — | ✓ 쿼리 유지 |
| `/papers/[id]` | `papers/[id]/index.tsx` | Stack | O | — | ✓ 슬러그·UUID |
| `/papers/[id]/cbt` | `papers/[id]/cbt.tsx` — `has_cbt_answers` false 이거나 `question_count` null 이면 솔버 대신 **비몰입 안내 화면**(일반 셸·헤더 있음; `cbt/page.tsx:64-72` 문구 그대로: "아직 CBT를 지원하지 않는 문제지예요" / "정답이 등록되면 CBT로 풀 수 있어요. 우선 원본 PDF로 풀어보세요." + "문제지로 돌아가기", `max-w-lg py-24 text-center`) — 딥링크 진입에 필요 | 몰입(안내 화면은 Stack) | L | — | ✓ |
| `/papers/[id]/explanations` | `papers/[id]/explanations.tsx` | Stack | O(익명·rate-limit 은 **카드 2개**(세트 그룹 포함) 미리보기) | 무료 3장/일·40/h, `lockReason` 분기; #24 화면 요소 | ✓ (`?download=1` 무시) |
| `/download/[id]?view=1`, `/download/answer/[id]?view=1` | `papers/[id]/pdf.tsx`(`?kind=paper\|answer`; 저장·공유) — **앱은 웹 `/download/*` 라우트를 절대 호출하지 않는다**(`download/[id]/route.ts:32-44` 는 `view` 아닌 요청을 `/login?next=` 로 리다이렉트, `lib/download-counting.ts` 는 브라우저 UA 화이트리스트라 앱 요청은 집계 제외, `robots.ts:72` disallow, geo-block 대상). 보기: `react-native-pdf` 에 Storage 공개 URL 을 직접 주고(`cache: true`, 뷰어 캐시는 OS 정리에 맡김), 로그인 불필요. 저장/공유(L): `expo-file-system`(SDK 54+ `File`/`Paths` API)으로 `Paths.cache/pdf/<paperId>-<kind>.pdf` 에 받은 뒤 `expo-sharing.shareAsync(uri, {UTI:'com.adobe.pdf', mimeType:'application/pdf'})` 시트 하나로 iOS "파일에 저장"·Android "다운로드에 저장"·카카오톡 공유를 모두 맡긴다(앱이 직접 Downloads/MediaStore 에 쓰지 않음 → 권한 요청 없음). 파일명은 `exam_papers.file_name`/`answer_keys.file_name` 을 `safeFileName` 으로. **이 버튼을 누른 순간에만** `increment_download_count`(기존 `countDownload`), 뷰어 진입·프리로드에서는 절대 호출하지 않는다. 캐시 폴더는 50MB 초과 시 오래된 것부터 삭제, 로그아웃과 무관하게 유지(정답 PDF 도 공개 파일이라 캐시 금지 대상 아님) | 몰입(가로 허용, §4.4) | O 보기 / L 저장 | — | 웹 URL 을 받으면 뷰어로 재매핑 |
| `/exams`, `/exams/[exam]?year` | `exams/index.tsx`, `exams/[exam].tsx`(신설) | Stack | O | — | ✓ |
| `/subjects`, `/subjects/[slug]?level&examTypes&page` | `subjects/index.tsx`, `subjects/[slug]/index.tsx` | Stack | O | — | ✓ |
| `/subjects/[slug]/mix?level` | `subjects/[slug]/mix.tsx`(신설) | Stack | O 보기 / L 시작 | — | ✓ |
| `/mix?level` | `mix/index.tsx`(신설) | Stack | O | — | ✓ |
| `/diagnosis` | `diagnosis/index.tsx`(소개) | Stack | O | — | ✓ |
| `/mypage?tab=wrong-notes\|history\|attendance\|bookmarks` | `mypage/index.tsx`(`?tab=` 이 정본; `#wrong-notes` 해시는 `tab=wrong-notes` 로 재매핑) | Stack | L(비로그인은 웹처럼 `/login?next=…&error=로그인이 필요해요`, `mypage/page.tsx:229`) | 출석 탭은 `isAttendanceOpen()`; 오답노트 탭 안 해설 본문 P | ✓ |
| `/mypage/edit` | `mypage/edit.tsx`(현행 `settings.tsx` 통합) | Stack | L | — | ✓ |
| `/mypage/payments` | `mypage/payments.tsx`(신설) | Stack | L | — | ✓ |
| `/mypage/attempts/[attemptId]` | `mypage/attempts/[attemptId].tsx` | Stack | L | 해설 본문 P | ✓ |
| `/mypage/diagnosis?range&subject` | `mypage/diagnosis.tsx`(신설) | Stack | L | **P**(`MembershipLocked`) | ✓ |
| `/mypage/wrong-notes/[slug]?view` | `mypage/wrong-notes/[slug]/index.tsx` | Stack | L | 해설 본문 P | ✓ |
| `/mypage/wrong-notes/[slug]/[paperId]` | `…/[slug]/[paperId].tsx` | Stack | L | 회독 평균 비교 P | ✓ |
| `/mypage/wrong-notes/[slug]/mix/[sessionId]` | `…/[slug]/mix/[sessionId].tsx`(신설) | Stack | L(소유자) | 해설 P | ✓ |
| `/mypage/wrong-notes/[slug]/review/[sessionId]` | `…/[slug]/review/[sessionId].tsx`(`slug` 는 `all` 가능) | 몰입 | L(소유자; 멤버십 검사 없음 — 웹과 동일) | — | ✓ |
| `/notifications?page` | `notifications/index.tsx`(신설) | Stack | L | — | ✓ |
| `/login?next&error` | `login.tsx`(모달 프레젠테이션) | Modal | O | — | ✓ |
| `/signup` | `signup.tsx` → `/login` 리다이렉트 | — | — | — | ✓ |
| `/onboarding/nickname?next` | `onboarding/nickname.tsx`(현행 `nickname.tsx` 이동, 뒤로가기 차단) | Modal | L | — | — |
| `/membership?next` | `membership/index.tsx`(신설) | Stack | O | — | ✓ |
| `/membership/complete`, `/payments/toss/*`, `/auth/callback` | 앱 없음 — 딥링크는 `/mypage/payments` 로 정규화 | — | — | — | 재매핑 |
| `/board?page&category&q`, `/board/[id]`, `/board/new`, `/board/[id]/edit` | `board/index.tsx`, `board/[id]/index.tsx`, `board/new.tsx`, `board/[id]/edit.tsx`(신설) | Stack / new·edit 는 modal | O / O(좋아요·댓글 L) / L / L(`canEdit`) | — | ✓ `#comment-…` |
| `/notices?page`, `/notices/[id]` | `notices/index.tsx`, `notices/[id].tsx`(신설) | Stack | O(댓글 L) | — | ✓ |
| `/notices/new`, `/notices/[id]/edit` | 없음(관리자 전용) | — | A | — | AASA 제외 |
| `/suggestions?page`, `/suggestions/[id]`, `/suggestions/new`, `/suggestions/[id]/edit` | 동일 경로 4파일(신설) | Stack / modal | O / O(비밀글은 작성자·관리자) / L / L | — | ✓ |
| 채팅(라우트 없음) | `ChatFab` + `ChatPanel` 전역 | 오버레이 | O 읽기 / L 쓰기 | — | — |
| `/terms`, `/privacy` | 시스템 브라우저 시트(`legal.ts` `openBrowserAsync` — SFSafariViewController/Custom Tabs) | — | O | — | — |
| `/admin/*`, `/api/*`(`/api/version` 포함), `/rss.xml`, `/sitemap*`, `/robots.txt`, `/manifest`, `/ads.txt`, `/attendance-promo.png`(`app/attendance-promo.png/route.ts` — 앱은 `assets/attendance-promo.png` 번들), OG 이미지 | **미이식** | — | — | — | AASA 제외 |

**관리자 제외 근거**: `/admin/*` 은 `getUser()` → `/admin/login`, `rpc('is_admin')` 이메일 화이트리스트(스키마에 시드된 계정 1개) 전용이고(검사는 `app/admin/layout.tsx` 가 아니라 각 페이지 — `admin/upload/page.tsx:13-21`, `admin/answers/page.tsx` 등 — 가 개별로 `getUser()`·`rpc('is_admin')` 을 수행한다; admin 디렉터리에 `layout.tsx` 없음), `app/admin/actions.ts` 의 `requireAdmin()` 서버 액션은 `sharp`·PDF 처리·`revalidateTag("home-data")` 등 Vercel 서버 전용 동작과 `apps/web/scripts/` 데스크톱 스크립트에 묶여 있다. 정답 등록·해설 검수는 AGENTS.md 가 소유자 전용 절차로 못 박은 위험 작업이라 폰에서 할 이유가 없고, 앱에 숨은 관리자 UI 가 있으면 스토어 심사에서 설명 요구가 생긴다. 앱은 `is_admin` 을 **광고 제외·프리미엄 판정**에만 쓴다.

**딥링크·유니버설 링크**: `scheme: "gongmoa"` 유지 + `ios.associatedDomains: ["applinks:gongmoa.kr"]`, Android `intentFilters`(`autoVerify: true`, host `gongmoa.kr`). AASA(`appID: <TEAM_ID>.com.gongmoa.app`, ≤128 KB)의 `paths` 는 위 표의 ✓ 경로만 포함하고 `/admin`, `/api`, `/auth`, `/payments`, `/download`, `/sitemaps`, `/notices/new`, `/notices/*/edit`, `/attendance-promo.png` 를 제외한다. assetlinks 는 Play App Signing SHA-256. **geo-block 주의**: `apps/web/src/proxy.ts` matcher 는 `.json`·확장자 없는 경로를 제외하지 않고(`.txt|xml|webmanifest` 등 확장자는 제외, `proxy.ts:189-191`) `lib/geo-block.ts` 의 `INFRA_DIRS`(`/api`, `/payments`, `/auth`)·`INFRA_FILES`(`/robots.txt`, `/sitemap.xml`, `/rss.xml`, `/ads.txt`, `/manifest.webmanifest`, `/favicon.ico`)에 `.well-known` 이 없으므로 `GEO_BLOCK=on` 이면 Apple/Google 검증 CDN 이 403 을 받는다. 같은 이유로 해외 IP 의 App Review·Play 심사자가 `/terms`·`/privacy`·계정 삭제 안내 페이지에서 403 을 받는다. **해법은 면제 목록 확장 하나다**: `lib/geo-block.ts` 의 `INFRA_FILES` 에 `/terms`, `/privacy`, `/app-ads.txt`(`.txt` 는 matcher 가 이미 제외하므로 방어적 등록일 뿐 — `ads.txt` 를 `INFRA_FILES` 에 남긴 것과 같은 "matcher 를 손대는 날 대비" 이유; 403 위험은 `.well-known` 만), `/account/delete-request`(신설, §11) 를, `INFRA_DIRS` 에 `/.well-known` 을 추가한다(공개 법적 문서·설비 파일이라 국가와 무관하게 내준다; `docs/agents/geo-block.md` 와 `geo-block.test.ts` 갱신). **앱은 어떤 경우에도 `GEO_BLOCK_BYPASS_TOKEN` 을 번들·OTA·링크에 싣지 않는다(금지선)** — `.env.local.example` 이 `CRON_SECRET` 처럼 추측 불가능해야 한다고 못 박은 값이고, 쿼리 우회(`proxy.ts:75-99`, 한 번 열면 쿠키로 이전)는 SFSafariViewController/Custom Tabs 에서 동작하지만 토큰이 JS 번들에서 추출된다. 앱 내 정적 약관 사본도 법적 문서 두 벌 문제(`legal.ts:3-6` 주석)로 배제. 앱이 웹 도메인을 부르는 경로는 `/terms`·`/privacy`(인앱 브라우저)·`/api/app/config`(§6.6)·`/.well-known/*`(OS 가 부름)·`/app-ads.txt`(AdMob 크롤러) 다섯 개뿐이며 전부 면제 목록에 있어야 한다 — 그 외 웹 URL 을 앱에서 fetch 하지 않는다.

---

## 6. 데이터·동기화 아키텍처

### 6.1 단일 진실 원천

Supabase Postgres 한 곳. 앱은 **로컬에 권위 있는 상태를 갖지 않는다**: 멤버십·응시·SRS·출석은 서버 행이 정본이고 앱 캐시는 표시용 사본이다. 규칙 실행 위치는 셋뿐 — Postgres(RLS·RPC·트리거), Edge Function(service_role), Next 서버 액션(service_role). 앱 JS 는 규칙을 **실행하지 않고** 결과를 그린다(예외: 순수 표시 계산 `computeStreakDays`, `roundTierName`, `collapseDuplicatePapers`(core), `computeDiagnosisProgress`(현재 `apps/web/src/lib/diagnosis-progress.ts:30` 에만 있고 core 에 없음 → core 로 이동, §6.8 행 추가), 리마인더 문구의 `unresolvedCount`(§10 `reminders.ts` — `['me',userId,'wrong-notes']` 캐시의 마지막 사본에서 읽는다)). 앱 클라이언트는 하나(`apps/mobile/src/lib/supabase.ts`, anon 키 + SecureStore)이며 service_role 은 Edge 에만 있다.

> **금지선.** 앱은 `memberships`·`user_question_status`·`review_sessions`·`paper_answers`·`question_explanations` 를 직접 쓰지 않는다(RLS 상 불가능하고 정책을 열지도 않는다). `avatars`·`board-images` 버킷 쓰기 정책도 열지 않는다. 체험 시작은 `start_trial_if_eligible` RPC 만. 정답·해설 본문은 서버가 판정한 범위에서만 클라이언트로 내려온다.

### 6.2 기능별 접근 방식

| 기능 | 테이블/RPC | 방식 | 근거 |
|---|---|---|---|
| 카탈로그(문제지·과목·시험유형·문항 이미지·정답지 메타) | `exam_papers`, `subjects`, `exam_types`, `questions`, `question_images`, `answer_keys` | RLS 공개 읽기 → `data/papers.ts`(신설), 디스크 캐시 | 웹 `getCachedHomeData` 도 공개 데이터; 전체 목록(`PaperWire` + `cbtMask`) 클라이언트 필터로 웹과 통일 |
| 문항 이미지 | `question_images.image_path`(schema.sql:561-567 — **width/height 없음**), 공개 `exam-papers` 버킷의 lossless WebP(`scripts/crop-question-images.mjs` 기본 `--scale 3`, `sharp().webp({lossless:true})` → 한 장 수백 KB) | core `data/question-media.ts` 가 `${SUPABASE_URL}/storage/v1/object/public/exam-papers/${image_path}` 로 URL 조립(웹 `wrong-notes.ts:213 getPublicUrl`·Edge `_shared/clients.ts:11 storagePublicUrl` 과 동형, 변환 파라미터 없음 — Storage 이미지 변환(`/render/image/`)은 유료 플랜 기능이라 사용 가능 여부 확인 전까지 쓰지 않음, §13 질문 14) | 크기는 DB 에 없으므로 `expo-image` `onLoad` 의 `source.width/height` 로 실측해 `['img-dims', path]` 쿼리(퍼시스트 O)에 저장(웹 `single-question-view.tsx:129 onLoad` 실측과 같은 방식; 현행 앱의 `aspectRatio: 0.72` 하드코딩(`src/components/single-question-view.tsx:92`)은 레이아웃이 틀리므로 폐기), 첫 렌더는 웹처럼 `contain` + placeholder 높이(문제별 보기 화면 높이의 60%). `cachePolicy: 'memory-disk'`, 디스크 캐시는 OS 정리에 맡기되 로그아웃·`clearCache` 에서 `Image.clearDiskCache()`. 프리페치는 CBT 진입 시 현재 문항 ±3(동시 4, 웹 `createImagePreloadQueue` 이식), 오답노트는 화면에 보이는 그룹만(`FlatList` `onViewableItemsChanged`), **과목 전체 프리페치 금지**(문제지당 20~50장 × 수백 KB). 오프라인 표시는 "이미 열어본 이미지만"(§6.5) |
| 슬러그 → id | 카탈로그 역색인 | 앱 내 계산(`data/paper-slug-map.ts`) | 웹과 같은 함수 |
| dedup 대표 계산 | `collapseDuplicatePapers` + **RPC `paper_identity_signals(p_paper_ids uuid[])`(신설)** → `(paper_id, question_count, answer_length, answer_cluster int)` | RPC(SD) | 정답 배열·해시 대신 요청 집합 안의 `dense_rank(md5(answers))` 만 돌려줘 **정답 유출 없음**(md5 원문 반환은 4~5지선다 20~40문항 배열이 브루트포스 가능 범위라 금지); 웹 `fetchPaperIdentitySignals` 와 동일 판정 |
| CBT 지원 여부/통계 | `has_cbt_answers_bulk`, `avg_score_by_round`, `paper_round_score_stats`, `paper_question_wrong_rates`, `mix_playable_question_counts`, `total_*` | RPC(기존) | `has_cbt_answers_bulk`·`avg_score_by_round`·`mix_playable_question_counts`·`total_*`·`increment_download_count` 는 anon/auth 실행 허용; **`paper_question_wrong_rates(uuid[])`·`paper_round_score_stats(uuid)` 는 `authenticated` 전용**(schema.sql:955, 990) — 앱은 로그인 시에만 호출(비로그인 문제지 상세에서 오답률 배지를 그리려 부르면 42501) |
| 즐겨찾기·과목 즐겨찾기·메모·표시·난이도 투표·공지 댓글 | `bookmarks`, `subject_bookmarks`, `question_memos`, `wrong_note_marks`, `difficulty_ratings`(insert), `notice_comments` | RLS 직접 쓰기 → `data/*` | 기존 정책 |
| 복습 설정 | `review_preferences` | **읽기만 RLS**, 모든 쓰기는 EF `review-prefs`(신설, §6.7 #13) | 웹은 `setReviewDailyLimit`·`toggleReviewSubjectPaused` 를 `isPremium` 뒤에 두고(`wrong-notes/actions.ts:347-372`), 보류 해제는 `setSubjectPaused` 가 밀린 문항의 `srs_due_at` 을 재분산하는 서버 전용 처리(`review-preferences.ts:447`; schema.sql:1806-1810 주석). 앱이 RLS 로 직접 쓰면 게이트 우회·재분산 누락·`study_phase` 히스테리시스(core `study-phase.ts`) 우회가 생긴다 |
| CBT 시작/제출 | `cbt_attempt_starts`, `cbt_attempts`, `cbt_attempt_answers`, `user_question_status`, `srs_reviews`, 출석 | EF `cbt-start`, `cbt-submit` | 정답은 서버 전용 |
| 복습·섞어풀기·오늘의 복습 | `review_sessions`, `review_session_items` | EF `review-create`(확장), `review-submit`, `review-history`(확장), `review-due`(신설), `mix-create`(신설) | 세션 테이블은 정책 0 |
| 찍었어요 | `review_session_items.guessed`, `user_question_status.srs_due_at` | EF `review-guessed`(신설, §6.7 #11) — RPC 로 만들지 않음 | core `srsGuessed`(`SRS_RELEARN_DELAY_HOURS = 3`)를 그대로 호출; SQL 에 SRS 상수를 두면 세 번째 복사본이 생겨 §1 목표 4·`srs.ts` 금지선에 어긋나고 번들 CI 게이트가 SQL 은 검사하지 못한다 |
| 오답노트 정답 | `paper_answers` | RPC `own_wrong_answers(p_items jsonb)`(신설) | 본인이 답한 문항만 — 단 형제 문제지 매핑 포함(§6.7 #3) |
| 해설(페이지) | `question_explanations`, `explanation_access_log`, `explanation_daily_views` | EF `explanations-get`(기존 모드) | 쿼터·잠금은 서버 |
| 해설(오답노트·응시 상세·mix 기록 안) | `question_explanations` | EF `explanations-get` **`context:"wrong-note"` 모드**(신설) | 웹 `lib/wrong-notes.ts` 는 `includeExplanations=premium` 으로 admin 조회하며 `explanation_daily_views`·`explanation_access_log` 를 **쓰지 않는다** → 앱도 쿼터 미차감·프리미엄+본인이 답한 문항만·그 외 `explanationLocked` |
| 해설 존재 배지 | — | RPC `paper_explanation_counts(uuid[])`(신설, 개수만) | `countPaperExplanations` |
| 멤버십 | `memberships`(select own) | 읽기 RLS + EF `membership-get`(신설) — 체험 시작은 EF 안에서만 `start_trial_if_eligible`(**service_role 전용 RPC**, schema.sql:1585-1592 `revoke all … from public, anon, authenticated; grant execute … to service_role` — 앱 세션으로는 호출 자체가 거부된다) | 체험 시작은 RPC 하나만(앱이 직접 부르는 것이 아니다) |
| 출석 | `attendance_days`, `attendance_grants` | RLS 읽기(`data/attendance.ts` — 웹·앱 중복 통합) | 쓰기는 채점 EF 안 `recordAttendance` 만 |
| 알림 | `notifications` | RLS 읽기 + RPC `mark_notification_read`/`mark_all_notifications_read`/`delete_notification`(신설) | U/D 회수됨 |
| 문항 신고 | `question_reports` | RPC `submit_question_report`(신설) | insert 회수, 20/h |
| 댓글 | `comments` | EF `comments-write`(기존) | — |
| 게시판 | `board_posts`, `board_comments`, `board_post_likes`, `board-images` | 읽기 RLS / EF `board-write`(신설) / RPC `toggle_board_like`(신설) | `sanitizeRichText` 서버 강제 |
| 건의 | `suggestions`, `suggestion_comments` | EF `suggestions`(신설, 읽기 포함) | SELECT 조차 회수 |
| 채팅 | `chat_messages` | 읽기 RLS + Realtime / EF `chat-send`(신설) | 이미 publication |
| 아바타 | `avatars` 버킷, `profiles.avatar_path` | EF `avatar-upload`(신설), RPC `avatar_paths(uuid[])`(신설) | 버킷 쓰기 정책 열지 않음 |
| AI 진단 | `ai_diagnoses` | EF `diagnosis-request`(신설, `ai-diagnose` 대체) + `diagnosis-aggregate`(신설); 리포트는 RLS 읽기 | 웹 Batches 파이프라인 재사용 |
| 다운로드 집계 | — | RPC `increment_download_count`(저장·공유 탭에서만) | 봇 필터 없음 |
| 계정 삭제 | — | EF `account-delete`(기존) | — |

### 6.3 캐시·무효화·포커스 재조회

TanStack Query 키는 `['catalog', …]`, `['me', userId, …]`, `['edge', name, …]` 세 접두.

| 데이터 등급 | staleTime | 디스크 퍼시스트 | 무효화 |
|---|---|---|---|
| 카탈로그(문제지 목록·과목·시험 인덱스·홈 통계·슬러그 맵) | 5분(웹 `'use cache'` 300s) | ✓ (gcTime 7일) | 앱 재시작·`refetchOnReconnect` |
| 본인 RLS 데이터(응시 목록·오답 그룹·즐겨찾기·메모·표시·출석·알림) | 30초 | ✓ (오프라인 표시용) | 관련 뮤테이션 후 키 무효화; `focusManager` 가 `AppState active` 마다 재조회; 화면 `useFocusEffect` |
| 멤버십(`membership-get`) | 60초 | ✗(메모리) | 로그인·채점·IAP 검증·포그라운드 |
| Edge 결과(채점 결과·복습 세션·진단) | 0 | ✗ | 화면 이탈 시 gc |
| 해설(`explanations-get`, **페이지 모드**) | 화면 마운트 중 `staleTime: Infinity`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: false`, `gcTime: 0`(언마운트 시 폐기) | ✗ | **없음** — 서버가 로그인 사용자의 **호출마다** `explanation_access_log` 에 `view` 를 insert 하고 40/h(`VIEW_HOURLY_LIMIT`, `explanations-get/index.ts:22,45-54`; 웹 `withinHourlyLimit` 과 같은 규칙) 를 넘기면 `lockReason:"rate-limit"` 미리보기만 준다. 기본 정책(staleTime 0 + 포커스 재조회 + retry 3)이면 화면을 열어 둔 채 앱을 몇 번 오가는 것만으로 정상 사용자가 잠금을 만나고 웹(RSC 렌더 1회 = 1로그)과 소진 속도가 달라진다. 호출 1회 = 로그 1행 = 웹의 "페이지 진입 1회". `context:"wrong-note"` 모드는 서버가 로그를 쓰지 않으므로 기본 정책 적용 가능 |

무효화 지도(웹 `revalidatePath` 대응; **`explanations-get` 페이지 모드는 어떤 뮤테이션으로도 무효화하지 않는다**): `cbt-submit` 성공 → `['me',*,'attempts']`, `['me',*,'wrong-notes']`, `['me',*,'status']`, `['me',*,'attendance']`, `['me',*,'membership']`, `['me',*,'due-summary']`, `['me',*,'diagnosis-eligibility']`; `review-submit` → 같은 집합 + `['edge','review-history']`; 즐겨찾기/표시/메모 → 낙관적 업데이트 후 해당 키; 닉네임/아바타 → `supabase.auth.refreshSession()` 후 `['me',*,'profile']`. `onlineManager` 는 NetInfo 에, `focusManager` 는 `AppState` 에 연결하고, Supabase `startAutoRefresh/stopAutoRefresh` 도 같은 훅에서(기존 `providers/auth-provider.tsx` 유지).

### 6.4 Realtime

- `chat_messages`: 이미 `supabase_realtime` publication → `ChatPanel` 열릴 때 `supabase.channel("chat_messages")` 구독, 백그라운드 진입 시 해제·복귀 시 재구독.
- `notifications`: 웹처럼 60초 폴링(RLS own count). publication 추가는 Phase 6 선택.
- 그 외 Realtime 없음. "웹에서 채점하고 앱을 열면 보인다"는 포커스 재조회로 충족.

### 6.5 오프라인 규칙과 "절대 캐시하지 않는 것"

- 오프라인은 **읽기 전용**: 카탈로그, 내 응시 목록, 오답 그룹(이미지는 `expo-image` 디스크 캐시 — **이미 열어본 이미지만** 보인다, §6.2 문항 이미지 행), 출석 요약을 마지막 사본으로 보여주고 `OfflineBanner`(기존) 표시. 모든 뮤테이션은 온라인 필수(`onlineManager` false 면 버튼 비활성). CBT 는 `cbt-start` 가 서버 시각을 기록하므로 오프라인 시작 불가.
- **절대 디스크에 남기지 않는 것**(persister `shouldDehydrateQuery` + `meta.persist:false` 로 강제): (1) 정답 — `correctChoice`, 채점된 `questionResults`, `own_wrong_answers` 결과; (2) 해설 본문 — 복사 방지(웹 `select-none`)와 3편/일 쿼터 의미 유지; (3) 제출 전·후 복습 세션 항목; (4) 멤버십 행·결제 raw·`is_admin` 결과; (5) 진단 리포트 본문. 메모리 쿼리캐시에만 두고 앱 재시작 시 사라진다.
- 드래프트: 복습 답안 `review-draft:<sessionId>`(웹 파리티). CBT 답안은 웹이 저장하지 않지만 앱은 백그라운드 종료가 잦아 `cbt-draft:<paperId>:<startedAt>` 에 답안(+정규화 스트로크)을 두고 서버 `cbt_attempt_starts` 행이 있을 때만 복원(복원 시 5초 카운트다운을 **건너뛰고** 서버 `startedAt` 으로 즉시 재개), 제출·"다시 풀기"에서 삭제 — 웹보다 관대한 유일한 차이.
- 로그아웃·탈퇴 시 `queryClient.clear()` + `persister.removeClient()`(퍼시스트 블롭 삭제) + kv-store `me:*` 삭제(기존 `offline.ts#clearCache` 의 "디렉터리 통째 삭제" 의미 유지). `@tanstack/react-query-persist-client` 는 쿼리별 키가 아니라 dehydrate 한 클라이언트 전체를 하나의 스토리지 키(기본 `REACT_QUERY_OFFLINE_CACHE`)에 저장하므로 "`me:*` 네임스페이스 삭제"만으로는 지워지지 않고, 다른 계정이 로그인하면 이전 사용자의 `['me', prevUserId, …]` 응시 목록·오답 그룹이 디스크에 남아 복원된다(키에 userId 가 있어 화면엔 안 나오지만 기기에 잔존). 퍼시스터 `buster` 를 `` `${APP_VERSION}:${userId}` `` 로 두어 계정이 바뀌면 이전 블롭이 복원되지 않게 한다. `shouldDehydrateQuery` 는 `['edge', …]` 접두와 `meta.persist === false` 를 제외한다.

### 6.6 충돌·멱등성 규칙

| 상황 | 규칙 |
|---|---|
| CBT 시작 중복 | `cbt-start` 는 `cbt_attempt_starts(user_id,paper_id)` upsert(`onConflict: user_id,paper_id`) — 재시작은 `started_at` 을 덮는다(웹과 동일). 웹·앱에서 같은 문제지를 동시에 시작하면 나중 시작이 `started_at` 을 덮는다: 먼저 시작한 기기의 제출도 새 시각으로 재므로 90초 미만이면 "최소 1분 30초" 거절이 나고, 다른 기기가 먼저 채점하면 start 행이 회수돼 이 기기의 제출은 "새로고침 후 다시 시작해주세요" 로 거절되고 **답안은 버려진다**(웹 동작과 동일 — "먼저 제출한 쪽이 이긴다"가 아니라 "나중 시작 이후 90초가 지난 첫 제출만 채점된다"). 허용 동작으로 문서화. 앱은 이 오류에 `recoverAttempt()` 를 시도하되 못 찾으면 "다른 기기에서 이미 채점됐어요" 로 안내. 앱 타이머 기준은 **항상 서버 `startedAt`**, `MIN_ATTEMPT_SECONDS=90` |
| CBT 이중 제출 | 앱: 제출 뮤테이션 single-flight. 서버는 채점 **전에** 시작 행을 원자적으로 회수한다 — `delete from cbt_attempt_starts where user_id=$1 and paper_id=$2 returning started_at`(0행이면 즉시 "새로고침 후 다시 시작해주세요"). 채점·상태·출석은 회수에 성공한 요청만 수행한다. 두 기기가 동시에 제출하면 한쪽만 채점된다. **현재 Edge·웹 모두 read-then-write 라 이 규칙이 필요하다**: `cbt-submit/index.ts:58-64` 가 `started_at` 을 select 한 뒤 채점·insert·`recordQuestionResults`·`recordAttendance` 를 다 끝내고 말미(`:143-144`)에 delete 하고 웹 `papers/actions.ts submitCbtAttempt`(`:313-443`)도 같다 → 웹+앱 동시 제출이나 앱 타임아웃 재시도가 겹치면 둘 다 통과해 `cbt_attempts` 2행, `recordQuestionResults` 2회(wrong_count +2, `nextSrs` 두 번, `srs_reviews` 중복), `record_attendance_day` 2회(schema.sql:2226 은 호출마다 누계 증분 → 출석 문항 누계 두 배 → 멤버십 일수 환전)가 된다. 규칙은 core `rules/cbt-attempt.ts` 에 넣고 웹 어댑터도 같은 순서로 바꾼다(정상 경로 결과 동일 = 웹 동작 변화 없음). 앱은 이 오류를 "이미 채점됨"으로 해석. **타임아웃 복구**: 응답을 못 받으면 재제출하지 말고 `cbt_attempts`+`cbt_attempt_answers`(둘 다 RLS select own)에서 `paper_id` 일치·`created_at >= startedAt − 5분`(다른 기기가 만든 응시의 `created_at` 이 이 기기의 `startedAt` 보다 이를 수 있어 넓힌다) 행을 조회해 점수·문항 정오를 복원(`recoverAttempt()` in `data/attempts.ts` 신설). `voidedQuestions` 는 복원하지 않는다 — `paper_answers.voided_questions` 는 admin 전용 RLS(schema.sql:397-425)라 읽을 수 없고, 응시 상세 `getAttemptWrongNote` 도 voided 를 따로 표시하지 않으므로 파리티 문제 없음 → 결과 모달은 `voidedQuestions` 를 optional 로 취급 |
| 복습 제출 중복 | 서버는 채점 전에 `update review_sessions set submitted_at = now() where id=$1 and user_id=$2 and submitted_at is null returning scope, created_at` 로 세션을 **선점**한다(0행이면 "이미 채점된 세션이에요"). 점수는 채점 후 별도 update. 현재 `review-submit/index.ts:40-46,98` 과 웹 `review-session.ts:791-851` 은 `submitted_at` 을 select 로 확인하고 채점 후 update 하는 read-then-write 라 동시 제출이 두 번 채점된다 — 규칙은 core `rules/review-session.ts` 에 넣고 웹 어댑터도 같은 순서로. 앱은 거부 시 `review-history {sessionId}` 로 채점 뷰를 가져온다 |
| 복습 세션 생성 연타 | 웹은 shuffle 재사용이 없고 `due` 만 24h `findUnfinishedDueSession` 이다. **Edge 의 30분 재사용(`REUSE_WINDOW_MINUTES`)은 제거**하고 웹 규칙을 정본으로 한다(웹 동작을 Edge 에 맞추지 않는다). 네트워크 재시도만 멱등하게 하려고 생성 요청에 클라이언트 `requestId`(앱이 세션 생성마다 새 UUID)를 붙이고, 서버는 `review_sessions.request_id text`(신설 SQL) + `create unique index review_sessions_request_uidx on review_sessions(user_id, request_id) where request_id is not null` 로 `insert … on conflict (user_id, request_id) do nothing returning id` 하여 0행이면 기존 세션을 조회해 같은 응답(정답 없음)을 돌려준다(§6.7 #8). "최근 60초" 창은 두지 않는다 — 같은 `requestId` 는 언제나 같은 세션. 현재 `review_sessions`(schema.sql:733-748)에는 `request_id` 컬럼이 없고 Edge 아이솔레이트는 메모리를 공유하지 않으므로 컬럼+유니크 없이는 판정할 곳이 없다(select-then-insert 면 동시 재시도 두 건이 모두 새 세션을 만든다). 웹은 `request_id` null 이므로 웹 동작 불변 |
| SRS | 앱은 `srs_*` 를 계산·기록하지 않는다. 승격(`promotePendingItems`)은 세션 생성 시에만, 요약 계산 시엔 절대 쓰지 않는다. `review-guessed` 는 단방향·멱등 |
| 상태 대상 해석 | 세션은 dedup 대표 `paper_id`, 상태 행은 실제 id → 채점은 반드시 `resolveStatusTargets` 경유(CBT 제외). Edge 의 별도 알고리즘을 버리고 core 판으로 통일 |
| 체험 시작 | `start_trial_if_eligible` 만. 앱 로그인 직후·포그라운드마다 `membership-get` 이 `isTrialUnstarted` 일 때 호출 |
| 출석 | `record_attendance_day` 원자적 증가, `attendance_grants` 원장이 멱등키. `isAttendanceOpen()` false 면 EF 가 기록하지 않고 앱은 카드·탭·메뉴를 숨긴다(현재 앱은 항상 그림 — 수정) |
| 유료 멤버십 부여 | `apply_paid_membership(p_order_id,…)` 는 `'already'` 로 재적용 거부 → `payments.order_id` 가 멱등키(§8) |
| Edge 계약 버전 | 응답은 **추가만** 허용(필드 삭제·의미 변경 금지). 깨지는 변경은 새 함수명(`-v2`). 앱은 `x-gongmoa-app-build`/`x-gongmoa-platform` 헤더(신설; supabase-js `createClient` 의 `global.headers` 로 고정)를 보내고 서버 로그에 남긴다. Edge `corsHeaders` 의 `Access-Control-Allow-Headers` 는 `authorization, x-client-info, apikey, content-type` 뿐이라(`_shared/cbt.ts:35-40`) 네이티브에는 무관하지만 Expo web/dev 클라이언트에서 preflight 가 막힌다 → 두 헤더를 Allow-Headers 에 추가(Phase 0, `_shared/http.ts` 로 이동하면서). OTA(`expo-updates`)는 같은 runtimeVersion 안의 JS 만 바꾸므로 네이티브 의존이 바뀐 구 빌드를 강제로 올릴 수 없다 → 아래 최소 버전 게이트 |
| 앱 최소 버전 | `apps/web/src/app/api/version/route.ts` 는 **Vercel 배포 커밋 SHA**(`VERCEL_GIT_COMMIT_SHA`, `no-store`, `warm-papers.yml` 폴링용)를 돌려주는 워밍 엔드포인트라 앱 버전 판정에 쓰지 않는다. 신설 `apps/web/src/app/api/app/config/route.ts`(`/api/**` 라 geo-block 면제, `cache-control: public, max-age=300`)가 `{ minBuild: { ios: number, android: number }, latestBuild, message?, storeUrl }` 을 돌려주고 값은 Vercel 환경변수 `APP_MIN_BUILD_IOS/ANDROID` 에서 읽는다(코드 배포 없이 올릴 수 있게). 앱은 시작·포그라운드마다(기존 `checkForUpdate` 옆) `expo-application` `nativeBuildVersion` 과 비교해 미만이면 전체 화면 `ForceUpdateScreen`(스토어 링크, 닫기 불가), `latestBuild` 초과분은 드로어 상단 배너 1회. Edge 는 `x-gongmoa-app-build` 가 `minBuild` 미만인 요청을 426 `{error:'update-required'}` 로 거부(계약 변경 시 서버 쪽 안전망) |

### 6.7 신설·변경할 Edge Function / RPC 전체 목록

모두 `_shared/clients.ts` 의 `requireUser`/`adminClient` 패턴, 규칙 본문은 core `rules/*` 호출.

**authenticated 에 여는 SECURITY DEFINER RPC 공통 규칙**(현재 스키마의 SD 함수는 전부 service_role 로 회수(결제·출석·체험)되거나 집계 전용(정답 비노출)이다 — 새로 여는 함수는 다음을 본문에서 강제): (1) `if auth.uid() is null then raise exception`; (2) `set search_path = public`; (3) 모든 where 에 `user_id = auth.uid()` 를 명시(SD 라 RLS 가 적용되지 않는다 — 조건을 빠뜨리면 타인 신고 수를 세거나 무제한이 된다); (4) 서버 액션의 인자 검증을 본문에서 반복; (5) `revoke all from public, anon` 후 `grant execute to authenticated`. `question_reports` 는 insert 가 회수돼 있고(schema.sql:1294-1320) 제약이 `question_reports_qnum_range`·`question_reports_open_unique` 뿐이라 20/h·컨텍스트·메시지 길이는 함수 본문 몫이다.

| # | 이름 | 종류 | 원본 웹 로직 | 요청 → 응답 / 규칙 | Phase |
|---|---|---|---|---|---|
| 1 | `membership-get`(신설) | EF | `lib/membership.ts#getMembership/isPremium`, `auth/callback` 체험 시작 | `{}` → `{membership, isAdmin, isPremium}`; `isTrialUnstarted` 면 `start_trial_if_eligible` | 0 |
| 2 | `cbt-submit`(변경) | EF | `papers/actions.ts#submitCbtAttempt` | 응답에 `diagnosisProgress{attemptCount,wrongCount}` 추가(추가 필드) | 0 |
| 3 | `own_wrong_answers(p_items jsonb)`(신설) | RPC SD | `lib/wrong-notes.ts:266#fetchCorrectAnswers` + `lib/review-session.ts:378#filterQuestionsAnsweredByUser` 가드 | `[{paperId, questionNumber}]` 를 받고 `(paper_id, question_number, correct_choice)` 반환. 각 항목에 대해 `user_question_status`/`cbt_attempt_answers`(어느 쪽이든 행 존재, **`selected_choice` null 포함**) 가 **요청 paper_id 또는 같은 dedup 그룹의 형제 paper_id** 에 있으면 정답을 돌려준다. 근거: 웹 오답노트는 dedup **대표** id 로 정답·해설을 조회하고(`wrong-notes.ts:1075-1080 fetchCorrectAnswers(repIds)`) 사용자 상태 행은 실제(형제) id 에 있어 `fetchQuestionStatusByRep`(`:688`) 가 `repId()` 로 접어 합친다(`review-session.ts:855-860` 주석) — 요청 id 로만 검사하면 형제 문제지 응시자는 앱에서 정답이 null 이 된다. 또 웹 응시 상세는 건너뛴 문항(`selected_choice` null)에도 `correctChoice` 를 보여주므로(`:1646`, `cbt_attempt_answers` 는 모든 문항에 행이 있다) "답했다" = "행이 있다". 형제 판정은 `paper_identity_signals` 와 같은 SQL(`subject_id, exam_type_id, year, round, level` 동일 + `md5(answers\|\|voided)` 동일 — core `representativePaperIds` 의 SQL 판)을 재사용. SQL 테스트: (a) 형제 문제지에만 행이 있는 사용자가 대표 id 로 요청 → 반환, (b) 행이 전혀 없는 문항 → 미반환, (c) `selected_choice` null 행 → 반환 | 0 |
| 4 | `paper_identity_signals(uuid[])`(신설) | RPC SD | `lib/dedup-papers.ts#fetchPaperIdentitySignals` | §6.2 dense_rank 클러스터 | 0 |
| 5 | `paper_explanation_counts(uuid[])`(신설) | RPC SD | `countPaperExplanations` | `(paper_id, count)` | 0 |
| 6 | `submit_question_report(p_paper_id, p_question_number, p_context, p_reason, p_message)`(신설) | RPC SD | `papers/actions.ts#submitQuestionReport`(`:480-529`) | 위 SD 공통 규칙 적용: `p_context in ('explanation','cbt')` 검사, **`p_context='cbt' and p_reason in ('wrong_answer','wrong_explanation')` 거절**(cbt 컨텍스트는 `image_issue\|other` 만), `left(p_message, 500)`, 20/h 는 `select count(*) from question_reports where user_id = auth.uid() and created_at > now() - interval '1 hour'`, `question_reports_open_unique` 충돌 → "이미 신고한 문항이에요" | 2 |
| 7 | `explanations-get`(변경) | EF | `lib/wrong-notes.ts#fetchExplanations`(`includeExplanations`), `lib/explanation-rate-limit.ts#resolveExplanationAccess` | `{paperId, context:"wrong-note", questionNumbers[]}` 모드 추가: 프리미엄 + 본인이 답한 문항만(**#3 과 같은 형제 paper_id 매핑**을 쓴다), 쿼터·로그 미기록, 그 외 `explanationLocked`; 기존 페이지 모드는 `lockReason` 그대로 + 응답에 **`remainingToday: number\|null` 추가**(웹 `ExplanationAccess.remainingToday`, `explanation-rate-limit.ts:28,90,106` — 없으면 #24 의 "오늘 남은 무료 해설 N개" 안내를 그릴 수 없다) | 2 |
| 8 | `review-create`(변경) | EF | `actions.ts#createReviewSession/createReviewAll/createReviewFromPapers/createReviewFromWrong/createReviewFromConcept` | `scope:"subject"\|"all"`, `subjectSlug`, `onlyDue`(P, 24h 쿨다운), `includeResolved`, `paperIds[]`, `items[]`(서버가 `filterQuestionsAnsweredByUser`), `conceptId`(P), `strategy`, `requestId`; dedup 대표·`wrong_note_marks.deleted`·`subject_id` 반영; **30분 재사용 제거**; `requestId` 멱등은 `review_sessions.request_id text`(신설 SQL) + 부분 유니크 인덱스 `review_sessions_request_uidx(user_id, request_id) where request_id is not null` 로 `insert … on conflict do nothing returning id`, 0행이면 기존 세션 조회(§6.6; 60초 창 없음, 웹은 null); 응답에 `paperId/correctChoice` 없음 | 2 |
| 9 | `review-submit`(변경) | EF | `submitReviewSessionForUser` | `source = scope==="mix" ? "mix" : "review"`; 응답에 `guessed, scope, subjectSlug, subjectName, paperId, paperTitle` | 0 |
| 10 | `review-history`(변경) | EF | `getReviewSessionView`, `listMixSessions`, `listRecentMixSessions`, `getMixSessionWrongNote` | `{sessionId}` 가 **미제출 세션도** 반환(답 없이 `images, choiceCount, position`); `{scope, subjectSlug, limit}` 목록; `{sessionId, view:"mix-note"}` | 2 |
| 11 | `review-guessed`(신설, `review-submit` 계열 EF) | EF | `lib/review-session.ts:531#markReviewItemGuessed` | `{sessionId, position}` → core `rules/review-session.ts#markReviewItemGuessed` 를 그대로 호출(소유자·`submitted_at`·`is_correct` 검사, `srsGuessed(srsStateFromRow(status), now)` 로 due 계산 = `SRS_RELEARN_DELAY_HOURS` 3). **RPC 로 만들지 않는다** — `now()+interval '3 hours'` 를 SQL 리터럴로 두면 SRS 상수가 세 번째 장소에 생겨 §1 목표 4·AGENTS.md `srs.ts` 금지선이 확장되고(번들 CI 게이트는 SQL 을 검사하지 못함), authenticated 에 열린 유일한 `user_question_status` 쓰기 경로가 되어 "쓰기 정책 없음" 원칙에 예외가 생긴다. 단방향·멱등 | 3 |
| 12 | `review-due`(신설) | EF | `lib/review-queue.ts#getDueReviewSummary/collectDueQueueItems/collectExtraQueueItems/getSessionSchedule`, `findUnfinishedDueSession`, `getReviewNudge` | `{action:"summary"\|"create"\|"extra"\|"schedule"\|"nudge", sessionId?}`; 전부 프리미엄; core `buildDueQueue` 번들 사용 | 3 |
| 13 | `review-prefs`(신설) | EF | `lib/review-preferences.ts#setDailyLimit(:157)/setSubjectPaused(:447, 재분산)/spreadOverdueBacklog/restoreSuspendedQuestions/saveStudyPhase(:129)`, `wrong-notes/actions.ts:347-372` 의 `isPremium` 게이트 | `{action:"daily-limit"\|"pause"\|"diagnosis-pause"\|"study-phase"\|"spread"\|"restore", subjectId?, limit?, phase?}` — `review_preferences` 의 **모든 쓰기**(`daily_limit`, `paused_subject_ids` 토글+재분산, `diagnosis_paused_subject_ids`, `study_phase`)를 이 EF 가 맡고 앱은 이 테이블을 읽기만 한다(§6.2). 방어선으로 DB check `daily_limit in (10,20,40,60)` 과 `study_phase` check(신설 SQL) 추가. 웹의 RLS insert/update 정책(schema.sql:1804-1823) 회수 여부는 §13 질문 15 — 웹 서버 액션이 `getSessionUser()` 의 **세션 클라이언트(RLS)** 로 쓰고 있어(`review-preferences.ts:167 upsert`), 회수하려면 웹 어댑터도 admin 클라이언트로 바꿔야 한다 | 3 |
| 14 | `mix-create`(신설) | EF | `lib/mix-practice.ts#getMixOverview/createMixSessionForUser/createRetryFromMixSession` | `{action:"overview", subjectSlug}` → cells/levelGroups; `{action:"create", subjectSlug, levels[], yearRange, limit, requestId}` → `{sessionId,total,unseenCount,coveredAll}`; `{action:"retry", sessionId}` | 3 |
| 15 | `mark_notification_read(p_id)`, `mark_all_notifications_read()`, `delete_notification(p_id)`(신설) | RPC SD | `notifications/actions.ts` | `auth.uid()` 범위; `mark_all` 은 60일 초과 읽음 정리(`pruneReadNotifications`) 포함 | 4 |
| 16 | `avatar-upload`(신설), `avatar_paths(p_user_ids uuid[])`(신설) | EF, RPC | `app/actions.ts#uploadAvatar/removeAvatar`, `lib/avatars.ts#fetchAvatarUrls` | multipart → 256px webp(Deno 는 sharp 없음 → WASM 코덱; 5MB·MIME 검증은 core `avatar.ts`), `profiles.avatar_path` + `auth.updateUser`; 실패 시 Next route handler(bearer JWT) 대안 | 4 |
| 17 | `board-write`(신설), `toggle_board_like(p_post_id)`(신설) | EF, RPC | `board/actions.ts` 전부 | `{action:"post.create"\|"post.update"\|"post.delete"\|"image"\|"comment.create"\|"comment.update"\|"comment.delete"}`; 순서 **새니타이즈(`sanitizeRichText`) → `validateBoardPostInput` → 저장**; 10/30/60 시간당 한도; 이미지 1600px webp; 알림 생성 | 5 |
| 18 | `report_post(p_post_id, p_reason)`, `block_user(p_user_id)`(신설) | RPC SD | 웹에 없음 — 스토어 UGC 요건(Apple 1.2) | `board_post_reports`·`user_blocks` 테이블(신설); 차단 목록은 앱 전용 필터로 시작, 웹 적용은 §13 질문 8 | 5 |
| 19 | `suggestions`(신설) | EF | `lib/suggestions.ts` + `suggestions/actions.ts` | `{action:"list"\|"get"\|"comments"\|"create"\|"update"\|"delete"\|"comment.*"}`; `canReadSuggestion` 마스킹 서버에서; `increment_suggestion_view` 는 EF 내부 | 5 |
| 20 | `chat-send`(신설) | EF | `chat/actions.ts#sendChatMessage` | `checkChatFlood/checkChatBurst`, 300자, 중복 검사 | 5 |
| 21 | `diagnosis-request`(신설, `ai-diagnose` 폐기), `diagnosis-aggregate`(신설) | EF | `mypage/actions.ts#requestDiagnosis/checkDiagnosisProgress`, `lib/diagnosis-live.ts` | 요청 행만 삽입(프리미엄·자격 15오답∨3응시·`normalizeConceptSelection` ≤10) → 기존 Vercel 크론 `/api/cron/diagnosis`(시간당, `CRON_SECRET`)가 Batches 로 처리; 앱은 `ai_diagnoses` 를 RLS 로 폴링 | 4 |
| 22 | `iap-verify`, `iap-webhook`(신설) | EF | 웹 `lib/payments.ts#settleTossPayment/syncTossPaymentByKey` 패턴 | §8 | 5 |
| — | `comments-write`(유지) | EF | — | 관리자 삭제·게스트 비밀번호 경로는 앱 범위 밖 | — |

**Edge 내부 파리티 수정(Phase 0)**: `_shared/status.ts` source 유니온에 `"mix"`; `_shared/media.ts` 의 `fetchQuestionMedia` 를 웹처럼 10문제지 청크로 페이지네이션; `_shared/status-targets.ts` 를 core 판(`representativePaperIds` + 시그널)으로 교체 — 문항 수가 다른 형제 문제지 픽스처로 계약 테스트 후.

### 6.8 core 로 통일할 모듈과 지울 복사본

| 통일 모듈(`packages/core/src/`) | 흡수하는 원본 | 삭제 |
|---|---|---|
| `rules/question-status.ts`(`recordQuestionResults`, source `cbt\|review\|mix`) | `apps/web/src/lib/question-status.ts` | `supabase/functions/_shared/status.ts` |
| `rules/status-targets.ts` | `apps/web/src/lib/status-targets.ts` + `lib/dedup-papers.ts#fetchPaperIdentitySignals`(→ `data/dedup-signals.ts`) | `_shared/status-targets.ts` |
| `rules/attendance-record.ts` | `apps/web/src/lib/attendance.ts#recordAttendance` | `_shared/attendance.ts`(상수는 이미 `core/attendance.ts`) |
| `rules/membership-server.ts` | `apps/web/src/lib/membership.ts#getMembership/isPremium/startTrialIfEligible` | `_shared/membership.ts`(`TRIAL_DAYS`, `FREE_UNTIL`, `FREE_EXPLANATION_DAILY_PAPERS`, `isPremiumUser`, `consumeFreeExplanationQuota`) |
| `rules/explanation-access.ts` | `apps/web/src/lib/explanation-rate-limit.ts` + `explanations/page.tsx#ANON_PREVIEW_CARDS` | `explanations-get` 내부 중복 |
| `rules/cbt-attempt.ts`(시작 행 원자 회수 포함, §6.6) | `apps/web/src/lib/cbt-attempt.ts`, `papers/actions.ts#startCbtAttempt/submitCbtAttempt` | `_shared/cbt.ts`(`MIN_ATTEMPT_SECONDS`, `sanitizeSelectedChoice`, `formatDuration` 복사) — 단 **`corsHeaders`·`json()`·`isUuid`(`_shared/cbt.ts:28-47`)는 Edge Function 10개 전부가 여기서 import 하므로 `_shared/http.ts`(신설)로 옮긴 뒤 삭제**(목록대로 지우면 EF 전부가 깨진다; `isUuid` 는 core `isPaperUuid` 로 대체 가능), `apps/mobile/src/lib/cbt.ts` 상수 |
| `diagnosis-progress.ts`(`computeDiagnosisProgress`, 테스트 `diagnosis-progress.test.ts` 동반) | `apps/web/src/lib/diagnosis-progress.ts` | 웹 파일은 re-export |
| `rules/review-session.ts`(세션 선점 update·`request_id` 멱등 포함, §6.6 — `review_sessions.request_id` 컬럼·부분 유니크 인덱스는 신설 SQL), `rules/review-queue.ts`, `rules/mix-practice.ts`, `rules/review-preferences.ts`(모든 쓰기, §6.7 #13) | 동명 `apps/web/src/lib/*.ts` | `review-create/submit/history` 인라인 로직 |
| `rules/explanations.ts`(`QuestionExplanationContent`, `normalizeChoiceExplanations`, `toExplanationContent`) | `apps/web/src/lib/wrong-notes.ts` 284–405행 | `_shared/explanations.ts`, `apps/mobile/src/lib/explanations.ts` 타입 |
| `edge/contracts.ts`(신설 — `ExplanationsResult`, `CbtSubmitResult`, `ReviewSessionView`, `AiDiagnosisReport` 등은 **현재 core 에 없고 앱 lib 지역 타입뿐**이므로 새로 만든다) | `apps/mobile/src/lib/{explanations,cbt,diagnosis,review}.ts` 지역 타입, `apps/web/src/lib/ai-diagnosis.ts` 리포트 타입 | 앱 지역 타입 |
| `data/question-media.ts`(10장 단위 페이지네이션) | `lib/wrong-notes.ts#fetchQuestionMedia` | `_shared/media.ts`, `apps/mobile/src/lib/wrong-notes.ts#fetchQuestionImages`, `papers.ts#getCbtQuestionData`, `mypage.ts#getAttemptDetail` 의 이미지 정렬 |
| `data/attendance.ts`, `data/attempts.ts`(`computeAttemptRounds`), `data/wrong-notes.ts`(`fetchWrongNoteMarks/fetchWrongAnswerRows/fetchQuestionStatusMap`) | 웹 `lib/attendance.ts#getAttendanceSummary`, **`apps/web/src/app/mypage/page.tsx:82 computeAttemptRounds`**(`lib/my-round-counts.ts` 는 `getMyRoundCounts` 로 다른 함수), 웹 `lib/wrong-notes.ts` 동명 | `apps/mobile/src/lib/attendance.ts`, `mypage.ts:55 computeAttemptRounds`, `wrong-notes.ts` 중복 |
| `edge/invoke.ts` | — | 앱 lib 6곳 `toError/unwrap` |
| `badge-classes.ts`, `nav-items.ts` | 웹 `lib/{level-colors,exam-type-colors,subject-colors,round-tier,streak}.ts`, `components/site-nav-items.ts` | 웹 파일은 re-export/아이콘 매핑만; 앱 `theme/badges.ts`, `lib/round-tier.ts`, `lib/streak.ts` |
| 번들 `_shared/core.mjs` 가 대체 | — | `_shared/srs.ts`, `_shared/review-pick.ts`, `_shared/profanity.ts`(현재 공백 차이만) — **§13 질문 9 승인 후, AGENTS.md 문구 수정과 같은 PR 에서만 삭제**(그 전엔 `core.mjs` re-export 한 줄로 교체, §3.2 금지선 박스) |
| `format.ts#kstDayKey`, `paper-slug.ts#isPaperUuid`, `format.ts#chunk`(추가) 재사용 | `isUuid` 8벌·`kstToday` 3벌·`chunk()` 8벌(§2 의 정의 기준 파일 목록) | 각 인라인 복사 |

웹 `lib/*.test.ts` 중 이관되는 것(`review-queue.test.ts`, `status-targets.test.ts`, `review-from-wrong.test.ts`, `mix-practice.test.ts`, `diagnosis-progress.test.ts`)은 core 로 함께 이동. `apps/web/scripts/*.mjs` 의 `normalizeConceptAlias` 3벌 규칙은 plain-node 루틴 제약이라 이 설계 범위 밖(AGENTS.md 규칙대로 유지).

### 6.9 오류·빈 상태·로딩 정책

화면 30여 개가 공통으로 따를 정책. Edge Function 오류는 `{error: string}` + 400/401/500 문자열 계약(`cbt-submit/index.ts:36-114` 의 "새로고침 후 다시 시작해주세요" 등, `_shared/clients.ts:44-50 requireUser` → 401 `{error:"로그인 후 이용할 수 있어요."}`)뿐이고, 현행 앱의 `toError` 6벌(`src/lib/cbt.ts:47-57` 등)은 이를 `Error.message` 로만 풀어 상태 코드가 사라진다. 웹은 `error.tsx` 가 없고 `not-found.tsx` 하나라 베낄 정책도 없다.

1. **오류 타입**: `core/edge/invoke.ts` 는 `EdgeError { status, code?, message }` 를 던지고 `{error}` 문자열은 그대로 `message` 로 보존(웹 문구 파리티).
2. **상태별 처리**: 401(다른 기기에서 탈퇴·세션 폐기) → `supabase.auth.signOut({scope:'local'})` + 캐시 초기화(§6.5) + `/login?next=` 모달; 403·`lockReason`·프리미엄 → `MembershipUpsell`/`MembershipLocked`; 426 `update-required` → `ForceUpdateScreen`(§6.6); 429 → `InlineAlert(amber)` "잠시 후 다시 시도해 주세요"; 5xx·네트워크 → `InlineAlert(red)` + "다시 시도" 버튼(`query.refetch()`/`mutation.reset()`); 오프라인 → 뮤테이션 버튼 disabled + `OfflineBanner`.
3. **목록 화면 순서 강제**: `QueryState` 헬퍼 하나로 `isPending` → 화면별 Skeleton(#8), `isError` → `InlineAlert` + 재시도, 빈 배열 → `EmptyState`(#11, 문구는 웹 동일) 순서를 통일한다.
4. **경계**: `app/+not-found.tsx`(신설, 웹 `not-found.tsx` 1:1, `FileQuestion 48`, §5) + 각 라우트 그룹의 `ErrorBoundary` export(기존 `app/_layout.tsx:14-20` 패턴 유지, Sentry `captureException` 후 `FatalErrorScreen`).
5. **타임아웃**: Edge 호출은 `AbortSignal.timeout(20_000)`, CBT 제출만 60s + §6.6 `recoverAttempt`.
6. **당겨서 새로고침**은 목록·마이페이지에만(플랫폼 적응, 웹 파리티 예외로 명시).

---

## 7. 인증·계정

### 7.0 게스트 모드

첫 실행은 로그인 없이 `/` 랜딩(첫 실행 로그인 강요 금지 — Apple 5.1.1(ii)·Play 정책; 현행 `app/index.tsx:5-6` 주석 "목록·상세는 비로그인도 열람" 과 같은 방향). 게스트 가능: `/`, `/papers*`, `/exams*`, `/subjects*`, `/papers/[id]`(이력·댓글 읽기), `/papers/[id]/explanations` 카드 2개 미리보기(`getOptionalUser`, `_shared/clients.ts:47`), PDF 보기, `/board*`·`/notices*`·`/suggestions*` 읽기, 채팅 읽기, `/membership`, `/diagnosis` 소개. 로그인 필요 동작은 버튼을 숨기지 않고 웹과 같은 문구의 `LoginPrompt`(댓글 "댓글은 로그인 후 남길 수 있어요" + "로그인하기" — `comments-section.tsx:139-145` 문구 재사용)를 그 자리에 그린 뒤 `/login?next=<현재 pathname+params>` 모달로 보내고, 로그인 후 `next` 로 복귀한다(모달 프레젠테이션에서는 `router.replace(next)` 로 모달을 닫으며 이동). 게스트 kv 키(`theme`, `*-hidden-day-v1`, `beta-notice-hidden-v1`)는 로그인 후 그대로 유지, `me:*` 만 사용자 스코프. ATT(§8.4)는 첫 광고 자리(`/` 하단 `AdBanner`)가 처음 마운트되기 직전에 1회 요청(로그인 여부 무관 — 광고가 비로그인에게도 뜬다). 게스트는 `review-draft`·`cbt-draft` 를 만들 수 없다(CBT 자체가 L).

### 7.1 제공자·세션·계정

- **제공자**: Google(`signInWithIdToken` provider `google`), Kakao(`kakao`, OIDC 켜고 `nonce` 전달 — `@react-native-kakao/user 2.4.6`), **Apple(iOS 필수** — App Review 4.8: Google/Kakao 같은 제3자 로그인으로 주 계정을 만들면 **동등한 프라이버시 보호 로그인 옵션**(데이터 최소 수집·이메일 가리기·광고 목적 미수집)이 필요하고 Sign in with Apple 이 이를 충족한다 — 4.8 이 Apple 로그인 자체를 요구하는 것은 아니지만 결론은 같다; `isAppleSignInAvailable()` 로 iOS 에서만 네이티브 버튼 노출). 세 버튼 모두 같은 Supabase `auth.users` 에 연결되므로 웹에서 Google/Kakao 로 만든 계정이 앱에서 그대로 열린다(계정 연속성).
- **Android 의 Apple 로그인**: `expo-apple-authentication` 은 iOS 전용이므로(현행 `app.json` 도 `ios.usesAppleSignIn: true` 뿐, Android 설정 없음) iOS 에서 Apple 로 가입한 계정(`auth.users` identity 가 `apple` 뿐)은 Android 앱(Google/Kakao 만)에 로그인 경로가 없다 — 웹에 Apple 버튼을 추가해도 Android 앱은 해결되지 않는다. Android 는 `signInWithOAuth({ provider: 'apple', options: { skipBrowserRedirect: true, redirectTo: 'gongmoa://auth/callback' } })` → `expo-web-browser.openAuthSessionAsync` → `exchangeCodeForSession(code)`(PKCE; Kakao 폴백과 같은 경로)로 같은 `apple` identity 에 로그인한다. 이것이 없으면 iOS Apple 가입 계정이 Android 앱에서 영구히 열리지 않는다. Supabase Apple 프로바이더의 Services ID·`.p8` 설정(§13 질문 7)이 선행 조건. Supabase Auth → URL Configuration → Redirect URLs 에 `gongmoa://auth/callback` 등록(콘솔 작업, §11).
- **웹에 Apple 추가(웹 변경)**: `app/login/page.tsx` 에 Apple 버튼이 없고 `app/actions.ts signInWithProvider` 는 `"google" | "kakao"` 타입이다. 앱에서 Apple 로만 가입한 사용자가 웹에 못 들어오므로 union 확장 + 버튼 추가가 필요하다(대시보드 설정만으로는 안 됨). Apple "이메일 가리기" 릴레이 주소면 별도 계정이 생기며, 같은 이메일의 자동 링크 여부는 Supabase 프로젝트의 identity linking 설정에 달려 있어 레포에서 확인 불가(§13 질문 3). 릴레이 이메일 계정은 `trial_consumptions` 원장(`trial_identity_hash` 가 `lower(trim(u.email))` 의 sha256 — schema.sql:1507-1535)과도 별개 정체성이라 **FREE_UNTIL 이후 체험 60일이 다시 켜진다** — 허용할지 §13 질문 3 에 포함. 로그인 화면에 "웹에서 쓰던 Google/Kakao 로 로그인" 안내 한 줄.
- **Kakao aud**: 네이티브 id_token 의 `aud` 가 네이티브 앱 키(`app.json` `kakaoAppKey`)라 Supabase Kakao client-ID 목록에 추가해야 한다(supabase/auth#1715 미해결) → Phase 0 스테이징 스파이크; 실패 시 폴백 `signInWithOAuth({skipBrowserRedirect:true, redirectTo:'gongmoa://auth/callback'})` + `expo-web-browser` PKCE `exchangeCodeForSession`(Redirect URLs 등록 필요, 위와 동일).
- **Google**: `google-signin 16.1.5` Original(무료)은 레거시 Android SDK 의존(Play Services 제거 예정) → Universal(유료) 전환 여부 §13 질문 2. `app.json` `iosUrlScheme` 의 `PLACEHOLDER_REVERSED_CLIENT_ID` 교체 필수.
- **세션 저장**: 기존 `src/lib/secure-storage.ts`(SecureStore 2000자 청크) + `auth-provider.tsx` 의 AppState `startAutoRefresh/stopAutoRefresh` 유지, `detectSessionInUrl:false`, `react-native-url-polyfill` 제거.
- **로그인 직후 순서**(웹 `/auth/callback` 파리티): `signInWithIdToken` → `membership-get`(체험 시작) → `user_metadata.nickname` 없으면 `/onboarding/nickname?next=` → `next`(**기본 `/`** — 웹 `sanitizeNextPath`(`lib/safe-redirect.ts:18-19`)가 값이 없거나 부적합하면 `"/"` 를 돌려주고 `auth/callback/route.ts:13,52` 가 그리로 리다이렉트한다; 앱이 `/papers` 를 기본으로 두면 로그인 직후 화면이 웹과 갈라진다 — §13 질문 11 의 "앱은 `/papers` 로 바로 열지" 와 묶어 결정; §5 의 `next` 화이트리스트 실패 시 폴백 `/papers` 는 별개).
- **닉네임 온보딩**: 웹 `onboarding/nickname/page.tsx` 1:1(CTA "시작하기"). core `validateNickname`(2–10자) + RPC `is_nickname_taken` + `auth.updateUser` 하나로 충분 — DB 트리거 `sync_nickname_from_auth` 가 `profiles` upsert·금칙어를 강제하므로 웹의 admin upsert(`persistNickname`) 경로는 앱에 불필요. 저장 후 `refreshSession()`. 기존 `NicknameGate` 유지. **오류 매핑**: 트리거는 길이·금칙어를 `raise exception`(schema.sql:1356,1361,1382 — "닉네임은 2~10자로 입력해주세요." / "닉네임에 사용할 수 없는 문자가 포함되어 있어요." / "사용할 수 없는 닉네임이에요.")으로 막지만 중복은 `profiles_nickname_unique_idx`(`lower(nickname)`, schema.sql:1050) 유니크 위반으로 터져 `auth.updateUser` 가 일반 500 성 에러를 돌려준다 — `is_nickname_taken` 선검사와 경합하면 원인 없는 오류가 된다 → 메시지가 위 세 문구면 그대로, 유니크 위반(`23505` 문자열 포함)이면 "이미 사용 중인 닉네임" 으로 매핑.
- **프로필/아바타**: `/mypage/edit` 파리티 — 사진(EF `avatar-upload`, `expo-image-picker`, `AVATAR_MAX_BYTES` 5MB, `{userId}/{uuid}.webp`), 닉네임, `default_cbt_view_mode`(`single|full|null` — 앱도 null 해제 지원; 현행 `settings.tsx` 는 불가), 이메일 표시, 리마인더 토글(앱 전용 유지), 탈퇴.
- **탈퇴**: "탈퇴" 입력 2단계 → EF `account-delete`(`comments` 익명화 "탈퇴한 회원" + `uploaded_by/verified_by` null → `auth.admin.deleteUser`; `account-delete/index.ts:36-61`) + 로컬 signOut + 캐시·kv 초기화(§6.5). 웹도 같은 EF 를 부르므로(`delete-account-button.tsx:24`) 파리티는 맞고 스토어 요건(계정 삭제)은 충족하지만 "완전성" 은 다음을 알고 써야 한다: (1) `avatars`·`board-images` 버킷의 사용자 객체는 `auth.users` 삭제로 지워지지 않는다(스토리지는 FK 가 없고 공개 버킷이라 탈퇴 후에도 URL 로 접근된다) → **`account-delete` 확장(Phase 4, 아바타 도입과 함께)**: `deleteUser` 전에 `storage.from('avatars').list(userId)` → remove, 본인이 올린 `board-images/{userId}/…` remove; (2) `board_posts`·`board_comments`·`chat_messages`·`suggestions`·`suggestion_comments`·`notice_comments` 는 `on delete cascade`(schema.sql:130, 2031, 2115, 2451, 2549, 2624) 라 글이 통째로 사라지고 그 글에 달린 타인의 댓글도 같이 삭제된다(댓글 익명화 정책과 불일치; `user_id` 가 FK not null 이라 익명화 불가 → §13 질문 16: 익명 계정 id 로 이전할지 cascade 를 유지할지 — 현재 cascade 동작은 웹과 동일); (3) `payments` 도 cascade 로 지워진다(schema.sql:1863 — §8.2 IAP 원장과 결제 분쟁 대응용 스냅샷 여부는 §13 질문 16). App Review 5.1.1(v) 충족. **Apple 토큰 revoke 는 필수**(Apple 계정 삭제 안내: Sign in with Apple 앱은 삭제 시 REST API `/auth/revoke` 로 토큰을 폐기해야 하며(문구는 "should") 이 항목으로 5.1.1(v) 반려 사례가 다수) — `account-delete` EF 가 `deleteUser` 전에 `https://appleid.apple.com/auth/revoke` 호출(현재 TODO, `account-delete/index.ts:18`); `.p8`+Services ID 는 Android PKCE Apple 로그인에도 필요하므로 §13 질문 7 은 "발급 시점" 질문으로 축소. **Google Play 정책도 앱 내 삭제 + 웹 링크 둘 다 요구**(§11).
- **로그아웃**: `signOut({scope:"local"})` → `queryClient.clear()` + `persister.removeClient()` + kv `me:*` 삭제(§6.5) → 로컬 리마인더 취소(§10 `reminders.ts`) → Google SDK signOut.
- **관리자**: 앱에 관리자 UI·링크 없음. `is_admin` 은 광고 제외·프리미엄 판정에만.

---

## 8. 멤버십·결제·광고

### 8.1 진실의 원천과 표시

`memberships(user_id, tier, source, started_at, expires_at)` 한 행이 웹·앱 공통 진실이며 만료는 읽는 시점에 core `membershipFromRow`/`isPremiumMembership`/`hasOwnPremiumPeriod`/`isAdFreeMembership` 으로 계산한다(크론 없음). 앱은 `membership-get` 결과를 `useMembership()`(staleTime 60초, 비퍼시스트)으로 들고 다니며, 웹 Toss 결제(`source:"paid"`)·출석 보상(`attendance`)·체험(`trial`)은 그 행에 이미 반영되므로 별도 동기화가 없다. `/membership` 화면은 웹 `app/membership/page.tsx` 의 `CurrentStatus`(:211)·`StatusPill`(:262) 와 같은 6가지 상태 필(관리자/전면무료/체험 N일/출석 N일/프리미엄/무료), `FEATURE_ROWS`(:287)·`FeatureTable`(:313) 비교표, FAQ(`faqItems`:398)를 그리되 **플랜 카드·가격·구매 버튼·웹 결제 안내 문구는 IAP 단계 전까지 일절 렌더하지 않는다**(Apple 3.1.1: 앱 내 판매 없이 웹 결제를 안내하면 리젝; 3.1.3: 한국 스토어프론트에 링크아웃 예외 없음). 웹 FAQ·본문에는 "아래 요금제는 이벤트가 끝난 뒤에 적용될 가격이에요"(:123), "내 결제 내역 보기"(:187), "표시된 금액은 부가세 포함 … 결제·환불 조건은 이용약관"(:193), 환불 문항(:458-463) 같은 결제 문구가 섞여 있어 '동일 텍스트' 로 옮기면 3.1.1/3.1.3 의 "앱 내 다른 구매 수단 언급" 이 된다 → FAQ 는 결제·환불·요금제·결제 내역을 언급하는 항목을 Phase 5 전까지 제외한 부분집합(`MEMBERSHIP_FAQ_APP` 상수, core `pricing.ts` 옆)만 렌더한다. `FREE_UNTIL`(2027-07-01 KST)까지 전원 프리미엄이고 `BUSINESS_INFO` 가 비어 Toss 도 미설정이므로 출시 시점엔 구매 UI 가 필요 없다 — "지금은 전부 무료예요"+`FREE_UNTIL_LABEL` 이 첫 문장.

### 8.2 IAP 결정과 권한 동기화(Phase 5, `FREE_UNTIL` 전)

- **정책 제약**: Apple 3.1.3(b) — 웹에서 산 멤버십을 앱에서 인정하려면 **같은 상품을 IAP 로도 팔아야** 한다. StoreKit External Purchase(한국, 26%)는 IAP 와 공존 불가. Google 은 Play Billing 필수, 한국은 대체결제·임베디드 웹뷰 링크아웃 허용(2026-12-31 까지 New Era 확대)이나 "WebView 금지" 목표와 충돌하므로 **IAP 단일 경로**로 통일한다.
- **상품**: `core/pricing.ts` `MEMBERSHIP_PLANS` 의 같은 3개 SKU(`monthly` 5,900 / `quarterly` 14,900 / `yearly` 39,900원). **Apple**: 비자동갱신 구독(non-renewing subscription) 3종. **Google**: Play Billing 에는 비자동갱신 구독 유형이 없다 — 선택지는 (a) 구독 상품의 선불(prepaid) 기본 요금제, (b) 일회성 상품(managed, 소비 처리) 둘이며, 선택에 따라 검증 API·RTDN 페이로드·consume/acknowledge·환불 해석이 전부 달라진다. 기본값은 **(b) 동일 기간의 일회성 상품 3종** — 선불 기본 요금제는 Play 가 "구독" 으로 취급해 갱신 UI·`subscriptionsv2` 계약이 붙으므로 채택하지 않는다(§13 질문 2 에 선택지로 명시). 앱 내 Toss·웹 결제 링크 없음.
- **라이브러리**: 기본 `expo-iap 5.6.0` + 스토어 서버 API 직접 검증; RevenueCat(`react-native-purchases 10.9.1`, 웹훅·재시도·`GET /subscribers`)은 운영 편의 대가로 수수료 — §13 질문 2. **Play Billing Library ≥ 8 필수**(2026-08-31 신규 앱·업데이트 게이트 이미 시행 중) — expo-iap 5.6.0(openiap-google PBL 8.x)은 충족, RevenueCat 채택 시 `purchases-android` 의 PBL 버전 확인.
- **동기화 흐름**(웹 `settleTossPayment` 패턴 재사용):
  1. 앱 구매 완료 → EF `iap-verify {platform, transactionId|purchaseToken, productId}`.
  2. EF 가 Apple `Get Transaction Info`(JWS 검증) / Google `purchases.products.get` + `purchases.products.consume` 으로 검증한 뒤, **스토어 트랜잭션 원장 `store_transactions(provider text, transaction_id text, user_id uuid, order_id text, consumed_at timestamptz, primary key (provider, transaction_id))`(신설)에 `insert … on conflict do nothing returning user_id` 로 선점**한다 — **`auth.users` FK 를 걸지 않는다**(`trial_consumptions` 와 같은 이유, schema.sql:1494-1505: 탈퇴해도 남아야 한다). 기존 행의 `user_id` 가 다르면 "다른 계정에서 이미 사용한 구매" 로 거절(재시도 금지 코드) — 같은 Apple ID/Google 계정의 영수증을 다른 공모아 계정으로 제출하는 경우를 여기서 잡는다(Apple 3.1.1 "복원" 은 같은 공모아 계정 안에서만 성립 — 비자동갱신 상품이라 계정 귀속이 허용된다). 그 다음 `payments` 행을 `on conflict (order_id) do nothing` 으로 삽입(`order_id` = 스토어 트랜잭션 id, `provider` = `'apple'|'google'` — 컬럼은 `text not null default 'toss'` 이고 check 제약 없음(schema.sql:1873), `status:'paid'`, `months`) → RPC `apply_paid_membership(p_order_id, p_expires_at)`(`p_expires_at` = core `payment.ts#grantedExpiry`, 잔여 기간에 개월 누적 → 웹·앱 구매가 한 행에서 합산; `'already'` 면 멱등 종료). 원장이 필요한 이유: 멱등키가 `payments.order_id` 하나인데 `payments.user_id` 는 `references auth.users(id) on delete cascade`(schema.sql:1863)라 탈퇴로 `payments` 행이 사라지면 재가입 후 같은 기기의 "앱 시작 시 영수증 재검증"(4) 이 새 `payments` 행을 만들고 `apply_paid_membership` 이 다시 `'applied'` 를 돌려줘 같은 트랜잭션이 두 번 부여된다. 원장이 있으면 탈퇴 후 재가입 계정의 재검증은 원장 충돌로 거절된다.
  3. EF `iap-webhook` 이 App Store Server Notifications V2(`REFUND`·`REFUND_REVERSED`) / Google RTDN `oneTimeProductNotification`(`ONE_TIME_PRODUCT_PURCHASED`·`ONE_TIME_PRODUCT_CANCELED`) 을 받아 환불·취소 시 스토어 API **재조회 후** `revoke_paid_membership` + `revokedExpiry`(알림 타입만으로 판단하지 않음). 웹 Toss 웹훅 `syncTossPaymentByKey` 와 같은 원칙. 원장에만 있고 `payments` 에 없는 order(탈퇴 후 도착한 환불 — `revoke_paid_membership` 이 `'not_found'` 를 돌려준다)는 로그·관리자 알림으로 남긴다.
  4. 앱은 StoreKit 결과로 잠금을 풀지 않는다 — 검증 후 `['me',*,'membership']` 무효화 → 서버 행으로만 판정. **웹훅 유실 대비** 앱 시작 시 미반영 영수증을 `iap-verify` 로 재검증(원장 + `apply_paid_membership 'already'` 로 멱등).
  5. 체험은 IAP 와 무관하게 `start_trial_if_eligible` 만(IAP 무료 체험 상품 만들지 않음). 출석 지급은 채점 EF 안 `grant_attendance_membership` 만(`memberships_source_check` 는 `'attendance'` 허용). 환불 정책 문구는 Phase 5 에서 **개정된** `/terms`(인앱 결제·스토어 환불 조항, §12)와 동일 텍스트 — 그 전까지는 §8.1 의 `MEMBERSHIP_FAQ_APP` 부분집합대로 환불 문항을 렌더하지 않는다.
- 결제 내역 `/mypage/payments` 는 `payments`(own) 직접 읽기(웹 `listUserPayments` 와 같은 `ready` 제외 필터) — provider 가 `toss`/`apple`/`google` 이든 한 목록.

### 8.3 게이트 파리티

판정 함수는 core `isPremiumMembership` 하나(웹 `isPremium` = admin ∥ 그것; Edge `isPremiumUser` 도 같은 core 함수로 교체).

| 기능 | 무료 | 프리미엄 | 강제 위치 |
|---|---|---|---|
| CBT, 응시 기록, 오답노트 열람·메모·핀·삭제·복구, shuffle, mix, 즐겨찾기, 댓글, 난이도, 다운로드(로그인), 찍었어요, 기존 세션 제출 | ✓ | ✓ | 없음 |
| 해설 페이지 | 비회원 2장 미리보기, 회원 3장/일(KST)+40/h | 무제한(+40/h) | `explanations-get`; `lockReason` `free-quota`→`MembershipUpsell`, `rate-limit`→"잠시 후" |
| 오답노트·응시 상세·mix 기록 안 해설 본문 | `ExplanationLock` | 본문 | `explanations-get context:"wrong-note"`(쿼터 미차감) |
| 오늘의 복습(생성·추가·설정(`daily_limit`·보류 토글+재분산)·복구·일정·넛지) | 잠긴 카드(숫자 없음) | ✓ | `review-due`/`review-prefs`(설정 쓰기 전부 EF — §6.2 복습 설정 행) |
| 개념 복습, `onlyDue` shuffle | ✗ | ✓ | `review-create` |
| AI 약점 진단 대시보드·요청 | `MembershipLocked` | ✓ | 앱 화면 + `diagnosis-request` |
| 회독별 타인 평균 | 잠금 링크 | ✓ | 앱 화면(RPC `paper_round_score_stats` 는 **로그인 사용자 누구나** 호출 가능 — `authenticated` 전용 grant(schema.sql:990), anon 불가, 프리미엄 검사 없음 — 웹과 동일) |

`FREE_UNTIL` 종료 시 잠기는 기능이 갑자기 늘어나므로 잠금 UI 는 Phase 1 부터 구현하고 `isFreeForAll`/`isAttendanceOpen` 분기를 시계 주입으로 테스트한다.

### 8.4 광고(AdMob)

- `react-native-google-mobile-ads 16.5.0`. **초기화 순서**: `requestTrackingPermissionsAsync()`(iOS ATT, `expo-tracking-transparency`, `NSUserTrackingUsageDescription`; 첫 광고 자리 마운트 직전 1회 — §7.0) → `AdsConsent.requestInfoUpdate()` + `loadAndShowConsentFormIfRequired()`(UMP — 배포 국가에 EEA/UK/스위스가 포함되면 Google 인증 CMP 동의 흐름이 필수(2024-01~); 아니면 Play/App Store 배포 국가를 한국·미국 등으로 제한하고 §11 에 기록) → `mobileAds().initialize()`. 앱 ID(`android_app_id`/`ios_app_id`)는 코드가 아니라 `app.json` 플러그인 설정에 있어야 SDK 가 초기화되고, 광고 단위 ID 3개만 `apps/mobile/src/lib/admob.ts`(신설, 웹 `NEXT_PUBLIC_ADSENSE_SLOT_*` 대응) 상수.
- `app-ads.txt` 는 **정적 파일이 아니라** `apps/web/src/app/app-ads.txt/route.ts`(신설)로 서빙 — `lib/adsense.ts` `PUBLISHER_ID` 를 재사용하되 AdMob 계정이 AdSense `pub-1367114332344973` 과 같은 게시자인지는 미확인(§13 질문 5). geo-block 설비 경로에 추가.
- **누가 보는가** = 웹 `lib/ads.ts shouldShowAds` 그대로: 미설정이면 없음; 비로그인 true; 로그인은 `!is_admin && !isAdFreeMembership(membership)`(source `paid|attendance` 만 광고 제거 — 체험·전면무료 사용자는 본다). `isPremiumMembership` 으로 거르지 말 것(웹 주석).
- **어디에** = 웹과 같은 3자리만: `home`, `papersList`, `paperDetail`(각 `min-h 100` 예약). 사이드 레일(`papersSide`, `paperDetailSide`)은 폰에서 원래 안 나옴.

> **금지선 — 광고 위치.** `/papers/[id]/cbt`, `/mypage/wrong-notes/*/review/*`, mix 솔버, PDF 뷰어, OMR 시트, 결과 모달 근처에 광고 없음(오클릭 = 무효 트래픽 = 계정 정지). 앱 오픈 광고·전면 광고·보상형 광고 사용 안 함. 관리자 계정은 항상 제외, 관리자 계정으로 광고 확인 금지. 웹 Auto Ads 는 계속 off.

---

## 9. 기능별 파리티 매트릭스

| 기능 | 웹 | 현재 앱 | 목표 Phase | 메커니즘 |
|---|---|---|---|---|
| 소셜 로그인 Google/Kakao/Apple | G+K | G+K+A 구현(콘솔 미설정) | 1 | `signInWithIdToken`; 웹에 Apple 추가 |
| 체험 자동 시작 | `/auth/callback` | 없음 | 1 | `membership-get` |
| 닉네임 온보딩·수정 | ✓ | ✓(경로 `/nickname`) | 1 | `auth.updateUser`+트리거 |
| 아바타 | ✓ | ✗ | 4 | EF `avatar-upload` |
| 탈퇴(+Apple revoke, 스토리지 객체 정리) | ✓ | ✓(revoke 없음) | 1 / revoke 는 스토어 제출 전 **필수**(`.p8`) / 스토리지 정리 4 | EF `account-delete` + Play 계정 삭제 웹 링크(§11) |
| 게스트 모드·`LoginPrompt` | ✓ | 부분 | 1 | §7.0 |
| 크래시·분석 | Vercel Analytics·GA4·Clarity | ✗(`FatalErrorScreen` 만) | 1 | Sentry(+GA4 앱 스트림 선택, §3.1) |
| 최소 버전 강제 업데이트 | — | ✗ | 1 | `/api/app/config` + `ForceUpdateScreen`(§6.6) |
| 테마 토글 | ✓ | OS 전용 | 1 | kv `theme` + Uniwind |
| 헤더·드로어·FAB 크롬 | ✓ | 3탭 | 1 | `AppHeader`, `NavDrawer` |
| 랜딩 `/`·TodayStudy | ✓ | ✗(목록이 홈) | 2 | 카탈로그 + `cbt_attempts` own |
| 홈 팝업 4종 | ✓ | ✗ | 2 / 넛지 3 | kv-store; `review-due nudge` |
| `/papers` 검색·제안·그룹·즐겨찾기 필터·24/페이지 | ✓ | 부분(20/페이지, 8급·시험유형 그룹·제안 없음) | 1 | 카탈로그 캐시 + core `search.ts` |
| dedup 카드 병합 | ✓(시그널 포함) | 메타만 | 1 | RPC `paper_identity_signals` |
| 시험 허브 `/exams*` | ✓ | ✗ | 2 | 공개 읽기 |
| 과목 목록·과목 페이지 탭·페이지네이션 | ✓ | 부분(100개 제한) | 1 | 공개 읽기 |
| 문제지 상세(이력·회독 평균·정답지·난이도 0.5·댓글·관련 12장) | ✓ | 부분 | 1(회독 평균 2) | RLS + RPC + `comments-write` |
| 문제/정답 PDF 열기·저장 | ✓ | 문제만 | 1 | `react-native-pdf` 7 + `expo-file-system`/`expo-sharing`(§5 `/download` 행), `increment_download_count` 는 저장·공유 탭 시만 |
| CBT 문제별(필기·스와이프·핏·세트·결과) | ✓ | 부분(필기 없음) | 1 | EF `cbt-start/submit`, Skia |
| CBT 전체보기(PDF 보기 / 필기+분할 OMR) | ✓ | 미검증 뷰어 | 1(보기) / 2(필기·분할) | react-native-pdf 7 + Skia |
| CBT 잠금·이탈 확인·신고 | ✓ | ✗ | 1 / 1 / 2 | `auth.updateUser`, `gestureEnabled:false`+`BackHandler`+`Alert`, `submit_question_report` |
| 결과 모달(진단 진행·틀린 문제 링크) | ✓ | 부분 | 1 | `cbt-submit` 응답 확장 |
| 해설 페이지(미리보기·쿼터·`lockReason`·개정 배너·현행법) | ✓ | 문구 오류 | 1 | `explanations-get` |
| 응시 상세(정답·해설·N회독) | ✓ | 정답 없음 | 1(정답) / 2(해설) | `own_wrong_answers`, `explanations-get context` |
| 오답노트 과목/문제지/문항(정렬·필터·선택 재풀이·정답·해설·오답률·복구·undo) | ✓ | 부분(정답 없음, dedup 없음) | 2 | RLS + RPC + `review-create` |
| 상태 전용 오답(mix) 합산·마지막 선택 | ✓ | ✗ | 3 | `review-history` 확장 |
| 회독별 타인 평균 | ✓(P) | ✗ | 2 | RPC + 앱 게이트 |
| shuffle(과목/전체/문제지/선택/개념) + 재개 | ✓ | 전체만 | 2 | `review-create`/`review-history` 확장 |
| 복습 솔버(드로잉·스와이프·임시저장·찍었어요·재도전·일정) | ✓ | 부분 | 2 / 3(일정) | `review-submit`, EF `review-guessed`, `review-due schedule` |
| 오늘의 복습(SRS)·설정·밀린 복습·복구·FAB | ✓(P) | ✗ | 3 | `review-due`, `review-prefs` |
| 기출 섞어풀기 `/mix` 허브·시작·기록·재도전 | ✓ | ✗ | 3 | `mix-create`, `review-history` |
| 출석 카드·탭·메뉴(열릴 때만) | ✓(닫힘) | 항상 표시(버그) | 1(숨김) | RLS + `isAttendanceOpen()` |
| 스트릭·티어 배지 | ✓ | ✓(색 다름) | 1 | core + `badge-classes.ts` |
| 마이페이지 4탭·스탯·NextAction·멤버십 타일·즐겨과목 편집 | ✓ | 3탭 | 1 | RLS |
| `/mypage/edit`(아바타·CBT 모드 null) | ✓ | 부분 | 2(아바타 4) | `avatar-upload`, `auth.updateUser` |
| 알림함·벨·읽음 | ✓ | ✗ | 4 | RLS + 3 RPC |
| AI 진단 소개·보드·요청·진행 | ✓(Batches) | 동기 EF(드리프트) | 4 | `diagnosis-request/aggregate` |
| 멤버십 상태 화면·결제 내역 | ✓ | ✗ | 1(상태) / 2(내역) / 5(IAP) | `membership-get`, `payments` RLS |
| 자유게시판 읽기/좋아요/댓글/작성 | ✓ | ✗ | 5 | RLS 읽기 + `board-write` + `toggle_board_like` |
| 공지 읽기·댓글 | ✓ | ✗ | 4 | RLS |
| 건의게시판 | ✓ | ✗ | 5 | EF `suggestions` |
| 채팅 | ✓ | ✗ | 5 | Realtime + `chat-send` |
| UGC 신고·차단 | ✗ | ✗ | 5 | `report_post`, `block_user` |
| 광고 | AdSense | ✗ | 4 | AdMob |
| 유니버설 링크 | — | 스킴만 | 4 | AASA/assetlinks |
| 오프라인 읽기·OTA·로컬 리마인더 | ✗ | ✓ | 1(유지) | persister, `expo-updates` |
| 원격 푸시 | ✗ | ✗ | 6(선택) | `device_tokens`(신설) |
| 해설 인쇄, 게스트 댓글, 관리자, SEO | ✓ | ✗ | 비목표 | — |

---

## 10. 기존 모바일 코드 처리

**업그레이드 경로**: in-place 52→57 대신 `apps/mobile` 를 SDK 57 로 **재스캐폴드**하고 아래 KEEP 파일을 옮겨 심는다(`bundleIdentifier`/`package` `com.gongmoa.app`, EAS `projectId ed6b6dd5-…`, `owner kojam`, `scheme gongmoa`, `slug gongmoa-mobile` 유지). 단 D 안의 스파이크 아이디어는 채택: 재스캐폴드 **전에** 기존 트리를 SDK 57 dev build 로 한 번 띄워 `react-native-pdf 7`·Skia 2.6·`@react-native-kakao`·`google-signin 16` 의 네이티브 빌드와 Kakao `aud` 를 검증한다(CNG 프로젝트라 네이티브 폴더는 없지만 **JS 최소 수정이 필요하다** — "`package.json`+`app.json` 차이뿐" 이 아니다: `src/lib/offline.ts:1-72` 는 `expo-file-system` 레거시 API(`cacheDirectory`, `getInfoAsync`, `writeAsStringAsync`, `deleteAsync`)를 쓰므로 SDK 54+ 에서 `expo-file-system/legacy` import 로, `supabase.ts` 의 `react-native-url-polyfill` 제거, `auth.ts` 를 `@react-native-kakao/user` 로(`app.json` 의 `@react-native-seoul/kakao-login` 플러그인 블록 — `kotlinVersion`·`overrideKakaoSDKVersion` 옵션은 seoul 6.0 에서 제거됨 — 삭제), `newArchEnabled` 삭제, `@react-native-community/netinfo 11.4.1` → 12.0.1, `@types/react ~18.3.12` → 19 갱신; 스파이크 일정은 이 수정을 포함해 잡는다). `newArchEnabled` 키 삭제.

**기존 사용자 이관 없음.** 스토어 출시 이력이 없고(`git tag` 0건, `app.json` `version 0.1.0`, 루트 README "네이티브 빌드·실기기 테스트는 미실행") 남은 것은 EAS 프로젝트(`ed6b6dd5-…`)와 소유자 기기의 내부 APK 가능성뿐이므로 데이터 마이그레이션 코드를 만들지 않는다. 단 같은 앱 ID 를 유지하므로 (1) SecureStore 세션 키 이름·청킹 형식은 `secure-storage.ts` 그대로 두어 재설치 없이 로그인이 이어지고, (2) 첫 실행에 `offline.ts` 의 `gongmoa-cache/` 디렉터리를 삭제하는 1회 정리(kv `migrated-v2` 플래그)만 넣으며, (3) 구 빌드는 `runtimeVersion` 정책이 `appVersion` → `fingerprint` 로 달라져 새 OTA 를 받지 못하므로 소유자 기기의 구 APK 는 삭제 후 재설치를 SETUP.md 에 적는다. 이후 사용자 데이터는 전부 서버 행이므로 앱 재설치로 잃는 것은 kv 편의값뿐이다.

| 영역 | 처리 | 파일 |
|---|---|---|
| Supabase 클라이언트·세션 | **KEEP** | `src/lib/supabase.ts`(polyfill import 제거), `secure-storage.ts`, `providers/auth-provider.tsx` |
| 인증 | KEEP+수정 | `src/lib/auth.ts`(Kakao SDK 교체·nonce, 로그인 후 `membership-get`), `account.ts`, `profile.ts` |
| Edge 래퍼 | REWRITE→core | `cbt.ts`, `review.ts`, `explanations.ts`, `diagnosis.ts`, `paper-detail.ts` 의 `toError/unwrap` → `core/edge/invoke.ts`; 타입은 `core/edge/contracts.ts` |
| 데이터 조회 | REWRITE→core `data/` | `papers.ts`(SQL 필터 → 카탈로그 캐시+클라 필터), `mypage.ts`, `wrong-notes.ts`(파일 캐시는 persister 로), `attendance.ts`(`isAttendanceOpen` 게이트), `subjects.ts`, `memo.ts`(명시 저장), `review-preferences.ts` |
| 인프라 | KEEP(+수정) | `net.ts`, `legal.ts`, `storage.ts`, `.github/workflows/eas-build.yml`, `eas.json`(프로필 추가); `updates.ts`(`checkForUpdate` 유지 + `ForceUpdateScreen` 게이트 추가, §6.6); `reminders.ts`(KEEP+수정: `identifier: 'study-reminder'` 로 예약하고 취소·존재 판정 모두 식별자 기준 — 현행 `cancelAllScheduledNotificationsAsync`(:26)는 타 알림까지 지우고 `hasScheduledReminder`(:30-31)는 `getAllScheduledNotificationsAsync().length > 0` 라 강제 업데이트 안내 등 다른 로컬 알림이 생기면 오판; `unresolvedCount` 는 `['me',userId,'wrong-notes']` 쿼리의 마지막 사본에서 읽어 채점 EF 성공·로그인·로그아웃(취소) 시 재예약; `app.json` `expo-notifications` 플러그인에 `icon`(단색 알림 아이콘, `generate-icons.mjs` 로 생성)·`color: '#12b382'`·`defaultChannel: 'study-reminder'` 지정 — 현행은 옵션 없음; Android 13+ `POST_NOTIFICATIONS` 권한은 기존대로 토글 켤 때만 요청); `download.ts`(KEEP+수정: `RNBlobUtil` 캐시 다운로드 → `expo-file-system` 신 API + `expo-sharing`, `countDownload` 는 저장·공유 탭에서만 — §5 `/download` 행); `scripts/check-build-env.mjs`(`EXPO_PUBLIC_WEB_URL` 을 OPTIONAL → **REQUIRED** 로 승격 — 없으면 약관 링크가 죽어 심사 반려), `.env.example`(§11 위치표 반영), `.gitignore`(`credentials.json` 추가); `metro.config.js`·`babel.config.js`·`tsconfig.json` 은 재생성 후 병합(`withUniwindConfig` 최외곽, `react-native-worklets/plugin`, TS 5.9) |
| 오프라인 캐시 | DROP | `src/lib/offline.ts` → TanStack persister 로 흡수(`OfflineBanner` 는 유지) |
| 테마 | DROP/재작성 | `theme/colors.ts`·`badges.ts`·`exam-type-icons.ts`·`lib/round-tier.ts`·`lib/streak.ts` → `packages/design-tokens` + core `badge-classes.ts`; `exam-type-icons.ts` 는 한능검 추가 후 core 로 |
| 내비게이션 | DROP | `app/(tabs)/_layout.tsx`, `app/(tabs)/search.tsx`, `src/lib/search.ts`(웹은 `/papers` 하나) |
| 화면 | REWRITE(웹 구조·경로로; 상태 로직 재사용) | `(tabs)/index.tsx`(→ `index.tsx` 랜딩 + `papers/index.tsx`), `(tabs)/mypage.tsx`(스탯 계산·`computeStreakDays` 재사용), `settings.tsx`(→ `mypage/edit.tsx`), `diagnosis.tsx`(→ 2화면), `papers/[id]/*`(타이머·세트 묶기·OMR 상태·제출 가드 유지), `wrong-notes/**`(→ `mypage/wrong-notes/**`), `review/*`(→ `mypage/wrong-notes/[slug]/review/[sessionId].tsx`), `subjects/*`, `mypage/attempts/*`, `nickname.tsx`(→ `onboarding/`), `(auth)/login.tsx`(→ `login.tsx`) |
| 컴포넌트 | KEEP | `fatal-error-screen.tsx`, `offline-banner.tsx`, `image-zoom-modal.tsx` |
| 컴포넌트 | REWRITE | `exam-card.tsx`, `single-question-view.tsx`, `omr-panel.tsx`, `cbt-result-modal.tsx`, `wrong-note-question-card.tsx`, `attendance-card.tsx`(재스타일+게이트), `memo-field.tsx` |
| 컴포넌트 | 기술 재작성 | `pdf-pen-viewer.tsx` — 기기 검증 이력 없음. react-native-pdf 7 + Skia 2.6.2 + Reanimated 4 로 다시(연속 스크롤·페이지별 정규화 스트로크·`destination-out` 지우개 파리티). Phase 1 은 보기 전용, 필기·분할 OMR 은 기기 검증 후 Phase 2; 실패 시 폴백 = 서버 사전 렌더 페이지 이미지(웹 `pdfjs-dist`·`sharp` 파이프라인 존재) |
| 앱 전용 기능 | DROP | `app/review/history.tsx` 전역 기록(웹은 과목·mix 별), CBT 안 메모 필드(웹엔 없음), PDF 열 때 `countDownload`(저장·공유 탭에서만) |
| 설정 | 수정 | `app.json`(아이콘 배경 `#12b382`, `expo-build-properties`·react-native-pdf·`@react-native-kakao/core`·`react-native-google-mobile-ads`(`android_app_id`/`ios_app_id`)·`expo-notifications`(icon/color/channel)·`@sentry/react-native/expo` 플러그인, `associatedDomains`/`intentFilters`, `runtimeVersion.policy: "fingerprint"`, `userTrackingPermission`, `ios.supportsTablet: false`(§4.4), `ITSAppUsesNonExemptEncryption=false`), `scripts/generate-icons.mjs`(초록 + `GraduationCap` + 단색 알림 아이콘) |
| 문서 | 수정·신설 | `apps/mobile/README.md`(없는 `types.ts/format.ts` 목록, "최소 3분"→90초, "하루 1회"→7일 주기, "댓글 수정 지원 안 함"), `SETUP.md`(§0 `Jamgoori/gongmoa_mobile` 참조, 구 APK 재설치), `SECURITY.md`(§4 `EXPO_TOKEN`); **`apps/mobile/AGENTS.md`(신설 — 현재 없음)**: 앱 금지선 = 정답·해설·멤버십 디스크 캐시 금지(§6.5), CBT/복습/PDF 화면 광고 금지(§8.4), `@gongmoa/core/server` import 금지, `GEO_BLOCK_BYPASS_TOKEN` 번들 금지(§5), `memberships` 직접 UPDATE 금지·`start_trial_if_eligible` 은 EF 안에서만, 웹 `/download/*` 호출 금지, `increment_download_count` 는 사용자 탭에서만; **`apps/web/AGENTS.md` 인덱스에 행 추가** — `docs/agents/edge-core-bundle.md`(신설: `bundle-edge.mjs`, `_shared/core.mjs` 재생성, `srs.ts` 동시수정 규칙의 후신), `docs/agents/contract-tests.md`(신설), `docs/agents/mobile-parity.md`(신설: 서버 액션 ↔ Edge 어댑터 추가 절차, 응답 "추가만" 규칙); 기존 갱신 — `geo-block.md`(`/terms`·`/privacy`·`/.well-known`·`/app-ads.txt`·`/account/delete-request` 면제), `adsense.md`(`app-ads.txt` 라우트, AdMob 계정 동일성), `board-rich-text.md`(`board-write` EF 도 새니타이즈→검증→저장 순서 적용, `notifications_type_check` 두 곳 규칙), `srs-tuning.md`(번들 게이트 이후 절차); 루트 `README.md`(레이아웃 설명·개발 절 → `docs/dev-workflow.md`(신설, §11) 링크, "하단 탭" 문구 삭제). 이 목록은 Phase 0 종료 조건에 포함(§12) |
| 삭제 | DROP | `react-native-url-polyfill`, 앱 안 상수 복사(`MIN_ATTEMPT_SECONDS`, `VALID_SCORES`) |

"stale types copy"에 대해: 별도 타입 사본 파일은 존재하지 않는다(README 만 stale). 실제 드리프트는 지역 결과 타입 세 곳이며 `core/edge/contracts.ts` 를 신설해 통일한다.

---

## 11. 품질·테스트·CI/CD

- **로컬 개발 워크플로**(신설 문서 `docs/dev-workflow.md`, 루트 README 링크): 레포에는 `supabase/config.toml` 도 `supabase/migrations/` 도 없다(`supabase/` = `functions/` + `schema.sql`; `.gitignore` 는 `supabase/.temp/` 만) — `supabase start`·`functions serve` 는 `supabase init` 이 만든 `config.toml` 이 있어야 돌고, `schema.sql` 은 마이그레이션이 아니라 단일 파일이다. (1) `supabase init` 으로 `supabase/config.toml` 생성·커밋(`[functions.*] verify_jwt` 기본, `[auth] site_url`·`additional_redirect_urls=["gongmoa://auth/callback"]`), `supabase/seed.sql` 은 `\i schema.sql` + 픽스처 순으로 두어 `supabase db reset` 한 번에 적재; (2) 터미널 3개 — `npm run web`(3000), `supabase start && supabase functions serve --env-file supabase/.env.local`(54321; Edge 는 `https://esm.sh/@supabase/supabase-js@2` 를 직접 import 하고 import map 이 없다, `_shared/core.mjs` 는 `npm run bundle-edge -w @gongmoa/core -- --watch`), `npx expo run:android|ios`(dev client — `apps/mobile/README.md:22` "Expo Go 불가") — 앱 `.env` 의 `EXPO_PUBLIC_SUPABASE_URL` 은 에뮬레이터 `http://10.0.2.2:54321` / 시뮬레이터 `http://127.0.0.1:54321`, 실기기는 `supabase start` 호스트 LAN IP; (3) 로컬 Supabase 에는 소셜 provider 가 없으므로 개발용 이메일/비밀번호 로그인을 로컬 config 에서만 켜고 앱 `login.tsx` 는 `__DEV__` 에서만 그 폼을 노출; (4) `turbo run typecheck lint test` + `npm run bundle-edge -- --check` + `npm run tokens -- --check` 를 PR 게이트로; (5) Node 22(`eas-build.yml:40` 과 동일), npm workspaces.
- **정적 검사**: 루트 `turbo run typecheck lint test`(web·mobile·core, TS ^5.9 통일), `expo lint`. mobile 은 `@gongmoa/core/server` import 금지 lint; core 는 `@supabase/supabase-js` 값 import 금지 lint(§3.2). `npx expo-doctor`.
- **core 단위 테스트**: 기존 `node --import tsx --test src/*.test.ts` 30파일 유지 + `rules/*.test.ts`(신설; `nextSrs`, `buildDueQueue`, `attendanceQuestionCount`, `grantedExpiry`, `pickMixQuestions` 는 이미 순수) + 이관 테스트 5개(§6.8, `diagnosis-progress.test.ts` 포함) + `badge-classes.test.ts`(8급·한능검 존재) + `nav-items.test.ts` + `rich-text.test.ts`(`ALLOWED_TAGS` export 가 22종인지 — #31 렌더러 계약).
- **생성물 신선도**: `bundle-edge.mjs --check`, `design-tokens gen --check`, `tokens.test.ts`(§4.1) 가 PR 에서 실패하면 머지 불가.
- **계약 테스트(핵심, 신설 `.github/workflows/contract-tests.yml`)**: `supabase start` 로 로컬 DB 를 띄우고 `supabase/schema.sql` + 픽스처(`packages/core/src/rules/__fixtures__/*.sql`)를 적재한 뒤, 같은 입력을 (a) 웹 어댑터(node, `@gongmoa/core/server`)와 (b) `supabase functions serve` 의 Edge Function 에 넣고 결과 행(`cbt_attempts`, `cbt_attempt_answers`, `user_question_status.srs_*`, `srs_reviews`, `review_session_items`, `attendance_days`, `memberships`)을 **스냅샷 비교**한다. 케이스: CBT 제출(voided 포함·90초 미만 거부·재제출 거부), **동시 제출 2건 → `cbt_attempts` 1행, `user_question_status.wrong_count` +1, `attendance_days.question_count` 1회분**(§6.6 원자 회수 검증; 복습도 동시 제출 2건 → 채점 1회), 복습 제출 scope `mix`/`review` source, dedup 형제 문제지(문항 수 다른 경우 포함) 상태 대상, 해설 접근 순서(시간당 40 → 프리미엄 → 일일 3)와 `context:"wrong-note"` 의 쿼터 미차감·형제 paper_id 매핑, 체험 1회, 출석 임계(10문항·2초)·마일스톤, 닉네임 트리거, `review-create` 응답에 `paperId/correctChoice` 부재, `own_wrong_answers` 의 (a) 형제 문제지 행만 있는 사용자 → 반환 (b) 행 없음 → 미반환 (c) `selected_choice` null → 반환(SQL), `review-create` 30분 재사용 부재·같은 `requestId` 두 번 → 세션 1개(유니크 인덱스). **결정성**: `recordQuestionResults` 는 `nextSrs(…, { fuzz: Math.random })` 로 간격을 흔든다(`question-status.ts:101`, `_shared/status.ts:69`, core `srs.ts:222 fuzzInterval`) → core `rules/question-status.ts` 는 `fuzz` 와 `now` 를 주입 가능하게 하고(기본 `Math.random`/`new Date()`), 계약 테스트는 양쪽에 같은 고정 시드(`() => 0.5`)와 고정 `now` 를 주입한다(없으면 reps ≥ 3 케이스의 `srs_interval_days`·`srs_due_at` 스냅샷이 비결정적으로 실패). Docker 가 필요하므로 GitHub Actions 러너에서만 돈다.
- **Edge 계약 타입**: `core/edge/contracts.ts` 의 `.d.ts` 를 번들과 함께 생성해 Deno 쪽에서 `satisfies` 검사.
- **픽셀 비교**(Phase 1 종료 판정): Playwright(웹, 390×844 뷰포트, `data-theme` light/dark) vs Maestro `takeScreenshot`(앱, 같은 논리 해상도)를 `pixelmatch` 임계 5% 로 비교, 대상 `/papers`·`/papers/[id]`·CBT 문제별 3장. **교차 확인 스크립트** `scripts/parity-check.mjs`(신설): 같은 계정의 `cbt_attempts` 수·최근 5건 id 를 웹 SSR 페이지와 앱 쿼리로 비교.
- **E2E(Maestro, Phase 2 종료 조건부터)**: EAS Workflows `type: build`(`e2e-test` 프로필: Android apk / iOS simulator) → `type: maestro` `flow_path: .maestro/*.yml`. 소셜 로그인은 자동화 불가 → 스테이징 프로젝트에 이메일 provider 를 켠 테스트 전용 계정(§13 질문 10 확정 시 — 그 전엔 green 이 될 수 없어 Phase 1 종료 조건에서 뺀다). 셀렉터는 `accessibilityLabel`(§4.2). 플로우: 로그인 → 닉네임 → `/papers` 검색 → 상세 → CBT 시작·90초 대기·제출 → 결과 → `/mypage/attempts/[id]` → 오답노트 메모·핀 → shuffle 생성·제출 → 드로어 전 항목 → 테마 토글 → 딥링크 `gongmoa.kr/papers/<slug>` → 광고가 CBT/복습 화면에 없음을 단언 → 로그아웃.
- **EAS 프로필**(`apps/mobile/eas.json`): `development`(dev client, 채널 development), `preview`(internal, 채널 preview), `production`(autoIncrement, 채널 production), `e2e-test`(신설). `postinstall` 이 `@gongmoa/core` 번들·토큰 생성 실행. `eas.json` 은 `apps/mobile` 에; 서명 자격은 **EAS 관리 자격을 기본**으로 하고 로컬 `credentials.json`(키스토어 비밀번호·p12 포함)은 만들지 않는다 — 만들면 `apps/mobile/.gitignore` 에 `credentials.json` 을 추가해야 한다(현행 `.gitignore` 는 `*.keystore`·`*.p8`·`*.p12` 만 있어 그대로 두면 커밋된다). IAP 도입 전 빌드(Phase 1–4)는 **TestFlight 내부 테스터 그룹 / Play 내부 테스트 트랙**만 쓴다 — TestFlight **외부** 테스트는 Beta App Review 를 거쳐 IAP 없는 빌드가 3.1.x·5.1.1 심사에 노출된다(내부 테스터 100명까지는 심사 없음).
- **환경변수·비밀 위치표**:

| 값 | 위치 | 공개? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY`, `EXPO_PUBLIC_WEB_URL`(REQUIRED 승격), `EXPO_PUBLIC_GOOGLE_WEB/IOS_CLIENT_ID`, `EXPO_PUBLIC_SENTRY_DSN` | GitHub secrets → `eas-build.yml` 이 jq 로 `eas.json` 프로필 env 에 주입(기존 `:63-93`), 로컬은 `.env` | 번들에 박힘(공개 가능 값만) |
| Kakao 네이티브 앱 키, AdMob `android_app_id`/`ios_app_id`, `iosUrlScheme`, `associatedDomains` | `app.json` 플러그인 설정(커밋; `kakaoAppKey` 는 이미 커밋돼 있음) | 공개 |
| AdMob 광고 단위 ID 3개 | `src/lib/admob.ts` 상수(웹 `NEXT_PUBLIC_ADSENSE_SLOT_*` 대응) | 공개 |
| `credentials.json`(키스토어·p12) | EAS 관리 자격 기본; 로컬 파일은 만들지 않음(만들면 `.gitignore` 추가 필수) | 비밀 |
| `EXPO_TOKEN`(유출 이력 — 재발급 대기, SECURITY.md §4), `SENTRY_AUTH_TOKEN` | GitHub secrets / EAS 시크릿 | 비밀 |
| Apple `.p8`(로그인·revoke), App Store Server API 키, Play 서비스 계정 JSON, `ANTHROPIC_*` | `supabase secrets set`(Edge 런타임)·Supabase Auth 대시보드 | 비밀, **앱 번들 금지** |
| `APP_MIN_BUILD_IOS/ANDROID`, `GEO_BLOCK*`(`GEO_BLOCK_BYPASS_TOKEN` 포함), `CRON_SECRET` | Vercel 환경변수 | 비밀, **앱 번들 금지** |
- **EAS Update 정책**: `runtimeVersion: { policy: "fingerprint" }`. JS/토큰/문구 변경만 OTA(채널별, `preview` → 하루 검증 → `production`); 네이티브 의존 변경(SDK·Skia·pdf·IAP·AdMob 플러그인)은 스토어 빌드. Edge 계약 변경을 동반하는 릴리스는 "추가 전용" 규칙(§6.6)을 지키고 앱 OTA 를 같은 날 내보낸다. 기존 `updates.ts`(포그라운드 fetch, 다음 실행 적용) 유지.
- **CI**: 기존 `.github/workflows/eas-build.yml`(workflow_dispatch, jq 로 `EXPO_PUBLIC_*` 주입) 유지 + `mobile-ci.yml`(신설: PR 마다 typecheck/lint/core test/생성물 diff) + `contract-tests.yml`.
- **스토어 제출 체크리스트**: Sign in with Apple(4.8 동등 프라이버시 옵션) ✓ 구현됨 + Android PKCE 경로(§7.1); 앱 내 탈퇴(5.1.1(v)) ✓(스토리지 객체 삭제는 아바타 도입 시 추가, §7.1); **Apple 토큰 revoke — 필수**(Apple 계정 삭제 안내: `/auth/revoke`; `.p8`+Services ID 는 Android PKCE Apple 로그인에도 필요) — `account-delete` EF 가 `deleteUser` 전에 `https://appleid.apple.com/auth/revoke` 호출; **Google Play 계정 삭제 웹 링크**(Play User Data 정책, 2024-04-15 전면 시행 — 계정을 만드는 앱은 앱 내 삭제 경로와 앱 밖 웹 링크 둘 다 요구하고 그 URL 을 Play Console → App content → Data safety → "데이터 삭제" 항목에 기재해야 한다): 로그인 없이 열리는 신설 `apps/web/src/app/account/delete-request/page.tsx`(삭제 절차 안내 + `/mypage/edit`(`delete-account-button.tsx`) 로그인 유도) 를 URL 로 등록하고 §5 geo-block 면제 목록에 포함(`/mypage/edit` 자체도 차단 대상이라 안내 페이지가 필요); ATT 문구·App Privacy(광고 식별자·진단 데이터 + **크래시·분석 SDK 가 수집하는 식별자(IDFV·광고 ID)를 App Privacy·Play Data safety·`/privacy` 5항 위탁표에 기재**); Android Data safety("광고 포함" 신고 포함); **UGC 신고·차단**(Apple 1.2 — 게시판·건의·채팅 출시 전 `report_post`/`block_user`); 개인정보처리방침 URL(`https://gongmoa.kr/privacy`, App Store Connect·Play 콘솔 동일) + **웹 `/privacy`·`/terms` 개정**(§12 Phase 4·5 — 앱 SDK 고지, 7일 사전 공지); **해외 IP 심사자 geo-block 403 대응 = `/terms`·`/privacy`·`/.well-known`·`/app-ads.txt`·`/account/delete-request` 면제 목록 등록**(§5; 우회 토큰 링크·앱 내 정적 사본은 채택하지 않음); AASA/assetlinks; `app-ads.txt`(스토어 등록정보의 "개발자 웹사이트" 가 `https://gongmoa.kr` 이어야 크롤링됨); AdMob UMP — 배포 국가에 EEA/UK 포함 여부 결정·기록(§8.4); 아이콘 초록 재생성; 스크린샷(다크·라이트, 폰만 — `supportsTablet: false`); iOS 16.4+ 최소; `ITSAppUsesNonExemptEncryption=false`; IAP 심사 노트(Phase 5); 연령 등급.
- **아직 남은 콘솔 작업**(mobile-audit 리포트 + Phase 별 재배치 — 이들이 Phase 1 종료 조건(설치)의 실제 병목이다):
  - **Phase 0 전(소유자)**: Apple Developer Program 가입(Mac + $99/년, SETUP.md §4-1·§6-B) + App Store Connect 앱 레코드(Bundle ID `com.gongmoa.app` 등록 — 없으면 `eas build -p ios` 가 자격 생성에서 막힘, SKU) + ASC API 키(`eas.json submit.production.ios.ascAppId/ascApiKeyPath` — 현행 `submit.production` 은 `{}`); Play 콘솔 개발자 계정·앱 생성·내부 테스트 트랙(신규 개인 계정이면 폐쇄 테스트 14일 요건 확인); `eas credentials` 로 Android 키스토어 생성 후 **그 SHA-1** 로 Google Android 클라이언트, **그 키 해시**로 Kakao Android 플랫폼 등록(로컬 keytool 값 아님 — SETUP.md §3 61행·76행); Google Web/iOS/Android 클라이언트 ID(`app.json` `iosUrlScheme` 가 `PLACEHOLDER_REVERSED_CLIENT_ID`); Kakao Developers OIDC ON + 네이티브 앱 키를 Supabase Kakao client-ID 목록에; Apple Services ID·`.p8`·Authorized Client `com.gongmoa.app`(Sign In with Apple capability 는 EAS 가 자동, Services ID 는 수동); Supabase 제공자 3종 활성화 + Auth Redirect URLs 에 `gongmoa://auth/callback`; `EXPO_TOKEN` 재발급(SECURITY.md §4); GitHub secrets(`EXPO_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY`, `EXPO_PUBLIC_WEB_URL`); Edge 9+신설 배포 + `ANTHROPIC_API_KEY`(`diagnosis-request` 채택 시 Edge 쪽은 불필요); `sync_nickname_from_auth`·`trg_create_membership` 프로덕션 적용 확인; Sentry 프로젝트·DSN.
  - **Phase 4 전**: 스토어 등록정보 "개발자 웹사이트" = `https://gongmoa.kr`(`app-ads.txt` 크롤링 조건), AdMob 앱·단위 ID·ATT 문구, Play App Signing SHA-256(assetlinks), Apple Team ID(AASA).
  - **Phase 5 전**: Play Data safety·광고 신고·계정 삭제 URL, ASC App Privacy·연령등급·암호화 수출 답변, IAP 상품 3종(Apple 비자동갱신 / Google 일회성)·세금/은행 정보, 사업자 정보(`lib/business.ts`), RevenueCat(채택 시).
  - **푸시 도입 시(Phase 6)**: FCM V1·APNs.

---

## 12. 단계별 로드맵

| Phase | 범위 | 종료 조건 | 의존 |
|---|---|---|---|
| **0. 백엔드 단일화 + 네이티브 스파이크 (2–3주, 병행)** | (백엔드) `core/server.ts`·`rules/*`(CBT 시작 행 원자 회수·복습 세션 선점 포함, §6.6)·`data/*`·`edge/contracts.ts`·`badge-classes.ts`·`nav-items.ts`·`diagnosis-progress.ts`; `bundle-edge.mjs`(supabase-js external + `--check`) + `_shared/core.mjs`; 웹 서버 액션을 어댑터로 교체; Edge 9개를 번들 기반으로 재작성(`mix` source, media 페이지네이션, status-targets 통일, 30분 재사용 제거 + `review_sessions.request_id` 컬럼·부분 유니크 인덱스(신설 SQL), `cbt-submit diagnosisProgress`, `review-submit` 응답 확장); `_shared/cbt.ts` 의 `corsHeaders`·`json`·`isUuid` 를 `_shared/http.ts` 로 이동(+`Access-Control-Allow-Headers` 에 `x-gongmoa-app-build`·`x-gongmoa-platform`); RPC `own_wrong_answers(p_items jsonb)`·`paper_identity_signals`·`paper_explanation_counts`; EF `membership-get`; `packages/design-tokens` + 웹 `@import` 전환(drift 테스트 diff 0); geo-block 면제 목록에 `/.well-known`·`/app-ads.txt`·`/terms`·`/privacy`·`/account/delete-request`; 웹 Apple 로그인 버튼; `/api/app/config` 라우트 + `APP_MIN_BUILD_*`; `supabase/config.toml`·`seed.sql` 구조 신설 + `docs/dev-workflow.md`; §10 문서 목록(`apps/mobile/AGENTS.md`, `docs/agents/{edge-core-bundle,contract-tests,mobile-parity}.md`, 기존 4개 갱신). (스파이크) 기존 트리를 SDK 57 dev build 로 부팅(§10 의 JS 최소 수정 포함: `expo-file-system/legacy`, url-polyfill 제거, kakao 교체, netinfo 12, `@types/react` 19)해 pdf 7·Skia·Kakao `aud`·google-signin 16·Uniwind Metro 통합·§4.2 폰트/Intl 체크리스트 판정(폴백 결정 포함) | 계약 테스트 워크플로 green(동시 제출 케이스·fuzz 시드 포함); 웹 동작 변화 없음(회귀 E2E·스크린샷); `_shared/{status,status-targets,membership,attendance,explanations,media}.ts` 삭제 + `_shared/cbt.ts` 는 `http.ts` 분리 후 삭제; **`_shared/srs.ts`·`_shared/review-pick.ts`·`_shared/profanity.ts` 는 이 Phase 에서 삭제하지 않고 `_shared/core.mjs` re-export 한 줄로 바꿔 둔다 — 삭제는 §13 질문 9 승인 후 AGENTS.md 문구 수정과 같은 PR 에서만**(§3.2 금지선 박스); Android/iOS dev build 가 기기에서 뜨고 3개 provider 로그인이 스테이징에서 성공; 문서 목록 반영 | 콘솔: §11 "Phase 0 전" 항목(Apple 가입·ASC 레코드·Play 앱·EAS 키스토어 기준 SHA-1/키 해시·Redirect URLs·`EXPO_TOKEN`) |
| **1a. 설치 가능한 앱 — Android preview APK (3주)** | SDK 57 재스캐폴드, `app/_layout.tsx`(Providers·persister·`ErrorBoundary`·`ForceUpdateScreen`)·`+not-found.tsx`, Sentry, 크롬(헤더·드로어·테마·푸터·FAB 자리), 게스트 모드(§7.0), 로그인 Google/Kakao + `/onboarding/nickname` + 탈퇴, `/papers`(검색·제안·그룹·dedup·24/페이지), `/subjects`·`[slug]`, `/papers/[id]`(이력·정답지·난이도·댓글·관련), PDF 뷰어(문제·정답, 보기 전용 + 저장/공유 시트), CBT 문제별(카운트다운 상태기계·필기·툴바 전체·스와이프·핏·세트·잠금·이탈 확인(`gestureEnabled:false`)·결과 모달) + 전체보기(보기 전용, OMR 시트), 해설 페이지(`lockReason`·`remainingToday`·#24 요소), `/mypage` 4탭(출석 게이트, 스탯, 기록, 즐겨찾기, 오답노트 목록), `/mypage/attempts/[id]`(정답 `own_wrong_answers`), `/membership` 상태 화면(`MEMBERSHIP_FAQ_APP`), 슬러그 해석, 스켈레톤·§6.9 오류 정책, 오프라인 읽기·OTA 유지, 잠금 UI, 접근성 라벨(§4.2) | `eas build -p android --profile preview` APK 가 소유자 폰에 설치(Play **내부 테스트** 트랙); Google/Kakao 로그인·`/papers` 검색·CBT 제출·`/mypage?tab=history`·응시 상세 정답까지 **수동 시나리오** 통과; 웹에서 푼 응시가 앱에, 앱에서 푼 응시가 웹에 보임(`scripts/parity-check.mjs`); Sentry 에 테스트 크래시 1건 수신; `ForceUpdateScreen` 동작 확인; 웹 `/papers`·상세·CBT 문제별과 픽셀 비교(§11 사양) 통과 | Phase 0 |
| **1b. iOS TestFlight (+1–2주)** | 1a + Apple 네이티브 로그인 + Android Apple PKCE 경로(§7.1) + Apple revoke(`account-delete`) | TestFlight **내부** 테스터 그룹에 설치(외부 TestFlight 금지 — §11); 1a 시나리오 + Apple 로그인 통과 | 1a + Apple Developer 가입·`.p8`·Services ID·ASC 레코드 완료 |
| **2. 학습 파리티 (3–4주)** | 랜딩 `/`·팝업, `/exams*`, 과목 페이지 탭, `review-create/history` 확장(shuffle 전 변형·재개·`requestId`), 복습 솔버 완성(임시저장·재도전·#23 결과 화면), 응시 상세·오답노트 해설(`explanations-get context`, 형제 매핑), 오답노트 3화면 완전 이식(정렬·필터·undo·복구·선택 바), 문항 신고 RPC(SD 공통 규칙), CBT 전체보기 필기·분할 OMR(기기 검증 후), 회독 평균 비교(로그인 시만 RPC), `/mypage/edit`(아바타 제외), `/mypage/payments` | 웹 `/mypage/wrong-notes/**` 와 앱의 오답 수·극복 수·정답이 같은 계정에서 일치(스크립트 검증); 웹에서 만든 shuffle 세션을 앱에서 이어 풀고 반대도 됨; **Maestro 로그인→CBT→응시 상세 green**(스테이징 이메일 provider, §13 질문 10 확정 후) | Phase 1a(iOS 항목은 1b) |
| **3. SRS·믹스 (3주)** | EF `review-due`, `review-prefs`(설정 쓰기 전부), `review-guessed`, `mix-create`, `daily_limit`·`study_phase` DB check; 오늘의 복습 카드·설정·밀린 복습·복구·예보·FAB·홈 넛지·`study-phase` 헤드라인; `/mix`·`/subjects/[slug]/mix`·믹스 기록·재도전; 상태 전용 오답 합산 | 웹과 앱에서 같은 날 같은 `todayCount`·`forecast`; 앱 제출 후 웹 `srs_due_at` 일치(계약 테스트) | Phase 2 |
| **4. 계정·알림·진단·광고·링크 (2–3주)** | `avatar-upload`·`avatar_paths` + `account-delete` 스토리지 객체 정리 확장(§7.1), 알림 RPC 3종 + 벨 + 목록, `diagnosis-request/aggregate` + 진단 2화면(`ai-diagnose` 폐기), 공지·댓글, AdMob(ATT → UMP → init, 3배치, `app-ads.txt` 라우트), 유니버설 링크(AASA/assetlinks), 출석 카드(열릴 때); **웹 `/privacy` 개정(웹 변경)**: 배포 최소 7일 전 공지사항 + 5항 위탁표에 Google AdMob(광고 식별자·ATT)·크래시 리포팅 SDK, 9항에 "앱에서는 쿠키 대신 광고 식별자·기기 식별자", 1항에 Apple 로그인(이메일 릴레이), `ADSENSE_POLICY_EFFECTIVE_DATE`(`privacy/page.tsx:18`) 패턴대로 시행일 상수 갱신 | 웹에서 받은 게시판 댓글 알림이 앱 벨에 60초 내 표시; 광고가 CBT/복습에 절대 안 뜸(Maestro 단언); 딥링크 `gongmoa.kr/papers/<slug>` 오픈; `/privacy` 개정본 시행 | Phase 1a(AASA 는 1b·Apple Team ID) |
| **5. 커뮤니티·IAP·스토어 (3–4주)** | `board-write`·`toggle_board_like`·`report_post`·`block_user`·`suggestions`·`chat-send`; 게시판/건의/채팅 화면 + **자체 22태그 `RichTextContent` 렌더러**(#31 — `react-native-render-html` 불채택); IAP 3 SKU(Apple 비자동갱신 / Google 일회성) + `store_transactions` 원장 + `iap-verify/iap-webhook` + 플랜 카드; **웹 `/terms` 개정(웹 변경)**: 인앱 결제·스토어 환불 조항과 시행일(`terms/page.tsx:278-282` 현행 2026-08-17; 불리한 변경은 30일 공지); Play Data safety·계정 삭제 URL·ASC App Privacy; 스토어 제출 체크리스트 전부 ✓ → 심사 제출 | 앱 IAP 샌드박스 구매가 웹 `/mypage/payments` 와 `memberships` 에 반영; 웹 Toss 구매가 앱에서 프리미엄; 환불 → `revoke_paid_membership`; 탈퇴→재가입 후 영수증 재검증이 원장 충돌로 거절됨(테스트); 심사 통과 | Phase 4, 사업자 정보(`lib/business.ts` 공란)·스토어 계약, `FREE_UNTIL` 이전 |
| **6. 선택** | 원격 푸시(`device_tokens` 신설, FCM V1·APNs), `notifications` Realtime, SDK 58 이행(GH 3, expo-router 58 대응), NativeWind 5 재평가, 태블릿 정식 지원(§4.4) | — | — |

Phase 1a 가 끝나면 "쓸모 있는 설치 가능한 앱"(검색·CBT·채점·기록·정답·해설)이 Android 에 존재하고, 1b 는 Apple 콘솔 작업이 끝나는 대로 따라온다(§1 목표 5 의 "Phase 1 종료" 는 1a 기준 — Android APK 를 분리하지 않으면 첫 설치가 Apple 가입·`.p8` 에 묶여 Phase 0+1 합산 6–8주 뒤로 밀린다). 이후 Phase 는 독립 배포 가능하다. Phase 0 의 백엔드 작업은 앱 없이도 웹 품질(Edge 파리티 버그 수정)을 올린다.

---

## 12-1. Phase 0 진행 상황 (2026-09-15, 브랜치 `claude/app-version-redesign-t5t8c5`)

**들어간 것** — 전부 typecheck·테스트 통과(core 446, web 155, design-tokens 6, `bundle-edge --check` 최신).

| 항목 | 상태 | 위치 |
|---|---|---|
| 디자인 토큰 정본 분리 | ✅ 웹 컴파일 CSS byte 동일 확인 | `packages/design-tokens/`(theme.css·gen·drift 테스트), `globals.css` 는 `@import` |
| 배지 클래스·내비 항목·진단 진행 계산 | ✅ | `packages/core/src/{badge-classes,nav-items,diagnosis-progress}.ts`, 웹은 re-export |
| `@gongmoa/core/server` + `rules/*` | ✅ CBT·문항 상태·출석·멤버십·해설 접근·상태 대상·복습 세션·복습 큐·섞어풀기·복습 설정 | `packages/core/src/server.ts`, `rules/`, `data/` |
| Edge 번들 | ✅ esbuild → `_shared/core.mjs` + `core-types/*.d.ts`, CI 게이트 | `packages/core/scripts/bundle-edge.mjs` |
| Edge 복사본 삭제 | ✅ `_shared/{cbt,status,status-targets,membership,attendance,explanations,media}.ts` 삭제, `http.ts` 신설 | `_shared/{srs,review-pick,profanity}.ts` 는 re-export 로 유지(§13 질문 9 승인 전) |
| 파리티 수정 | ✅ mix source, media 페이지네이션, status-targets core 판, 30분 재사용 제거 + `request_id`, `cbt-submit diagnosisProgress`, `explanations-get remainingToday`, review-* 응답 확장 | `supabase/functions/*` |
| 이중 제출 차단 | ✅ CBT 시작 행 delete…returning 선회수, 복습 세션 update…returning 선점 | `rules/cbt-attempt.ts`, `rules/review-session.ts` |
| RPC·SQL | ✅ `paper_identity_signals`, `paper_explanation_counts`, `own_wrong_answers`, `review_sessions.request_id`+부분 유니크, `daily_limit` check | `supabase/schema.sql` 말미 "Phase 0" 절 — **운영 DB 미적용** |
| EF `membership-get` | ✅ | `supabase/functions/membership-get/` |
| Edge 계약 타입·`invokeEdge` | ✅ | `packages/core/src/edge/{contracts,invoke}.ts` |
| 웹 변경 | ✅ geo-block 면제(/.well-known·/terms·/privacy·/app-ads.txt·/account/delete-request), Apple 로그인 버튼, `/api/app/config`, `/account/delete-request` | `apps/web` |
| 계약 테스트 | ✅ 하네스 7케이스 + Actions 워크플로 | `packages/core/scripts/contract-tests.mjs`, `.github/workflows/contract-tests.yml` |
| 로컬 개발·문서 | ✅ `supabase/config.toml`·`seed.sql`, `docs/dev-workflow.md`, `docs/agents/{edge-core-bundle,contract-tests,mobile-parity}.md`, `apps/mobile/AGENTS.md` | |

**아직 안 된 것(이 환경에서 불가 또는 소유자 작업)**
- 네이티브 스파이크(SDK 57 dev build, pdf 7·Skia·Kakao `aud`·google-signin 16·Uniwind Metro) — 실기기·EAS 필요.
- Edge Function 의 Deno 타입검사·`functions serve` — Deno·Supabase CLI 없음. 번들 export 목록과 손으로 대조했다. **첫 `supabase functions serve` 에서 `@ts-types` 지시문·`deno.json` import map 동작을 확인할 것.**
- `schema.sql` Phase 0 절의 운영 적용(RPC 3개·`request_id`·check) — 적용 전에는 앱의 `own_wrong_answers` 등이 없고, `review-create` 의 `requestId` 는 컬럼이 없어 insert 가 실패한다(웹은 `request_id` 를 보내지 않아 무관).
- 계약 테스트의 실제 실행(Actions 에서 첫 실행 후 `supabase status -o env` 파싱·`-x` 서비스 이름 확인).
- §11 "Phase 0 전" 콘솔 작업 전부, `EXPO_TOKEN` 재발급.
- 문서 갱신 잔여: `docs/agents/{adsense,board-rich-text}.md` 의 앱 관련 문구, §9 매트릭스의 Phase 0 반영.

**앱에 영향을 주는 Edge 동작 변화**(기존 앱 코드 기준): `review-create` 는 30분 재사용이 없어져 연타 시 새 세션이 생기므로 앱은 `requestId` 를 보내야 한다; 후보 규칙이 웹과 같아져(dedup 대표·삭제 표시 제외) 세션 내용이 달라진다; `review-submit` 이중 제출은 400 "이미 채점된 세션이에요."; `cbt-submit` 은 응답에 `diagnosisProgress`, `explanations-get` 은 `remainingToday`·`lockReason` 을 준다.

---

## 12-2. 소유자 결정 기록 (2026-09-15)

§13 질문에 대한 답. 아래 결정은 본문보다 우선한다(본문 갱신은 해당 Phase 착수 때).

| # | 결정 | 설계 반영 |
|---|---|---|
| 1 | **하단 탭 + 햄버거 드로어** 병행 | §4.4·§5 수정 필요: 하단 탭 4개(홈 `/` · 기출문제 `/papers` · 오답노트 `/mypage?tab=wrong-notes` · 마이페이지 `/mypage`)를 두고, 드로어에는 웹 `PRIMARY_NAV`/`ACCOUNT_NAV` 전체를 그대로 둔다. 탭은 `expo-router` 의 `Tabs`(native-tabs 는 SDK 58 안정화 후), 몰입 화면에서는 숨김. 웹과 갈라지는 유일한 크롬이며 탭에 있는 항목도 드로어에서 빠지지 않는다(웹과 같은 입구 유지) |
| 2 | `_shared/srs.ts`·`review-pick.ts`·`profanity.ts` 삭제 **승인** | 같은 커밋에서 삭제 + AGENTS.md 문구 갱신 완료 |
| 3 | `schema.sql` Phase 0 절 운영 적용 — 머지 전 필요 | 순서: 운영 DB 에 SQL 적용 → Edge 배포 → 앱. 웹은 SQL 없이도 동작하므로 웹 배포는 순서 무관 |
| 4 | 분석 **넣는다** | Sentry + GA4 앱 스트림(`@react-native-firebase/analytics`). App Privacy·Data safety·`/privacy` 5항에 광고 식별자·기기 식별자 고지 |
| 5 | 로그인 직후·앱 첫 화면 = **랜딩 `/`** | 웹과 동일 |
| 6 | Apple 로그인·`.p8` — **보류** | 웹 Apple 버튼은 코드만 있고 대시보드 프로바이더는 켜지 않는다(버튼은 노출하지 않도록 Phase 1 에서 플래그 처리). iOS 빌드(1b)는 Apple 결정 후 |
| 7 | **Android 먼저 완성 후 iOS** | 이미 1a(Android)/1b(iOS) 분리. 태블릿(iPad) 지원은 iOS 이후 별도 — `supportsTablet:false` 유지 |
| 8 | 과목 배지 슬롯 0 — 설명 후 재결정 | 보류. 기본값: 앱도 웹과 동일하게 렌더(고치면 양쪽 동시) |
| 9 | `review_preferences` RLS 쓰기 회수 | 보류(비개발자 결정 불필요). 기본값: 지금처럼 웹은 세션 클라이언트, 앱은 EF `review-prefs` 경유 |
| 10 | Maestro 테스트 계정 | 보류. 기본값: 스테이징 프로젝트에만 이메일 로그인 활성(운영은 그대로) |
| 11 | AI 진단 즉시 생성 폐기 | 보류. 기본값: 웹 Batches 로 통일(앱도 최대 1시간 대기) |
| 12 | Storage 이미지 변환 가능 여부 | **소유자 확인 필요**: Supabase 대시보드 → Settings → Billing 의 플랜(Pro 이상이면 Image Transformation 사용 가능). 코드로는 알 수 없음 |
| 13 | IAP 는 Phase 5, 그 전 구매 UI 없음 — **동의** | 유지. `expo-iap` 직접 검증 기본, Google 일회성 상품 기본 |
| 14 | AdMob **Phase 5 로 미룸** | §12 Phase 4 의 광고 항목을 Phase 5 로 이동. `app-ads.txt`·ATT·UMP 도 함께 |
| 15 | 원격 푸시 | 보류. 기본값: 도입하지 않음(로컬 20시 리마인더만 유지) |
| 16 | UGC 신고·차단 **웹에도 넣는다** | `report_post`/`block_user` 를 웹 게시판·건의·채팅에도 적용(Phase 5) |
| 17 | 탈퇴 시 **본인 글만 삭제, 타인 답글은 유지** | `board_posts`·`suggestions`·`chat_messages` 의 `on delete cascade` 를 버리고, 본인 글은 내용을 비워 "탈퇴한 회원의 글" 로 남기되 타인 댓글은 유지(댓글 익명화 정책과 동일 방향). `payments` 도 탈퇴 전 스냅샷(원장) 유지. 스키마 변경은 Phase 4(계정) 에서 |
| 18 | Google 로그인 SDK Original vs Universal | 보류. 기본값: Original(무료) 유지, Play Services 제거 공지 시 전환 |
| 19 | SDK 58 이행 | 보류. 기본값: 57 로 출시 후 58 정식 안정화 뒤 이행 |
| 21 | **Phase 1 착수 보류** | 소유자 지시 전까지 앱 코드 작업 없음 |

---

## 12-3. Phase 1a 진행 상황 (2026-09-15, 코드 완료 · 실기기 미검증)

앱 트리는 SDK 57 로 재스캐폴드됐고 아래 화면이 웹 URL 과 같은 경로로 존재한다. 전부 `tsc`·`expo lint`·
`expo export --platform android`·`expo prebuild --platform android`·`expo-doctor 21/21` 을 통과했다. **실기기·에뮬레이터
실행은 이 환경에서 못 했다** — 첫 Android preview APK 가 그 검증이다.

| 영역 | 화면 | 비고 |
|---|---|---|
| 크롬 | `AppHeader`(65px)·`NavDrawer`(core nav-items)·하단 탭 4개(§12-2 #1)·`AppFooter`·테마 토글 | 몰입 화면(CBT·PDF)은 탭·헤더 없음 |
| 계정 | `/login`(Google·Kakao, Apple 미노출), `/onboarding/nickname`, `/mypage/edit`(닉네임·CBT 시작 모드·리마인더·탈퇴) | 아바타 업로드 Phase 4 |
| 홈 | `/`(웹 랜딩 5블록), `/diagnosis` 소개 | 팝업 슬라이더 Phase 2, 광고 Phase 5 |
| 카탈로그 | `/papers`(검색·제안·그룹·즐겨찾기·24/페이지·dedup), `/subjects`, `/subjects/[slug]`, `/papers/[id]`(10블록), `/papers/[id]/pdf`, `/papers/[id]/explanations` | `/exams*` Phase 2 — 링크는 `/papers?type&level` 로 우회 |
| CBT | `/papers/[id]/cbt` 문제별(카운트다운·Skia 필기·툴바·세트·잠금·이탈 확인·결과 모달), 전체보기(PDF 보기 + OMR 시트) | 전체보기 분할 OMR·필기 Phase 2, 문항 신고 Phase 2 |
| 마이페이지 | `/mypage` 4탭·스탯·NextAction·멤버십 타일, `/mypage/attempts/[id]`(정답 `own_wrong_answers`), `/membership` 상태 화면 | 오답노트 상세·오늘의 복습·결제 내역은 Phase 2~3 |
| 인프라 | Uniwind + design-tokens, TanStack Query 퍼시스터(정답·해설·멤버십 비퍼시스트), `invokeEdge` 오류 정책, `/api/app/config` 강제 업데이트, Sentry(DSN 있을 때), analytics 스텁(GA4 는 google-services.json 뒤) | |

**검토 반영(2026-09-15)**: 데이터·런타임·파리티 3관점 검토 31건 전부 수정(커밋 28e8d65). 대표: Uniwind 아이콘 색 매핑,
Modal 안 RNGH 루트, 드래프트 복원 키, 타임아웃 → `recoverAttempt`, 다크 배경 토큰, `/subjects` 웹 파리티.

**운영 DB 재적용 필요 SQL**: `paper_explanation_counts` 를 anon 에 개방(schema.sql 과 동일, 비로그인도 "해설 열기" 표시).
적용 전에는 비로그인 상세 화면에서 그 버튼만 안 보인다.

**Phase 1a 종료 조건까지 남은 것(소유자·기기 작업)**: §11 "Phase 0 전" 콘솔 작업(EAS 키스토어 SHA-1·키 해시 → Google Android
클라이언트·Kakao 플랫폼, Supabase 프로바이더, `EXPO_TOKEN` 재발급, GitHub secrets) → Actions "앱 빌드 (EAS)" preview/android →
폰 설치 → 수동 시나리오(로그인 → 검색 → CBT → 채점 → 기록 → 응시 상세 정답) → 웹·앱 교차 확인 → Sentry 테스트 크래시.
Edge Function 배포(§12-1)가 선행돼야 채점·해설·멤버십 호출이 새 계약으로 응답한다.

---

## 12-4. Phase 2 진행 상황 (2026-09-16, 코드 완료 · 실기기 미검증)

Phase 1a 는 실기기에서 확인됐다(소유자 확인). Phase 2 는 코드가 끝났고 아래가 들어갔다. 전부
`tsc`·`expo lint`·`expo export --platform android`·루트 `typecheck`/`test`(core 496) 통과.

| 영역 | 들어간 것 |
|---|---|
| 복습 | `/mypage/wrong-notes/[slug]/review/[sessionId]` 솔버·결과 화면(카운트다운·최소시간 없음, 드래프트, 이중 제출 시 채점 뷰 폴백) |
| 오답노트 | `[slug]`(시험지별·문항 모아보기 두 뷰, 필터·정렬·선택 바·되돌리기·핀·메모), `[slug]/[paperId]`(+회독 평균), `[slug]/mix/[sessionId]` |
| 해설 | 오답노트·응시 상세 해설 = EF `explanations-get context:"wrong-note"`(프리미엄 + 본인이 답한 문항만, 하루 3장 쿼터 미차감, 메모리 전용) |
| 시험별 | `/exams`, `/exams/[exam]?year=` — 카탈로그 캐시에서 계산, 홈·과목·푸터의 죽은 링크 해소 |
| 홈 | 팝업 슬라이더 4종(“오늘 하루/다음부터 보지 않기” kv, 웹 sessionStorage 키는 메모리 전용) |
| 결제 | `/mypage/payments`(구매·환불 UI 없음) |
| CBT | 전체보기 PDF 위 Skia 펜·지우개(페이지별 정규화 좌표), 좌우 분할 OMR(비율 kv), 문항 신고 버튼 |
| 백엔드 | EF `review-history view:"mix-note"`, RPC `submit_question_report`, 계약 타입은 추가만 |

**검토 반영**: 데이터·런타임·파리티 2관점 검토에서 19건을 전부 수정(다크모드 아이콘·팝업 헤더,
섞어풀기 죽은 링크 4곳 통일, `state.fail()` 무효 호출·제스처 동시성, 오답노트 무효화 과다,
해설 호출 팬아웃 4건 제한, 분할 바 프레임마다 리렌더, Uniwind `divide-y` 미지원 등).

**운영 DB 적용 필요 SQL 2건**(적용 전에는 해당 기능만 조용히 비활성):
`paper_explanation_counts` anon 개방(Phase 1a 검토分), `submit_question_report`(Phase 2).
`scratchpad/phase2-sql-delta.sql` 와 `schema.sql` 말미 절이 정본.

**Phase 3 로 넘긴 것**: 섞어풀기 허브·재도전(EF `mix-create`), 오늘의 복습(EF `review-due`,
찍었어요·복습 일정·홈 넛지), 믹스 기록 목록, 상태 전용 오답 합산.

---

## 13. 리스크·미결 사항

| 리스크 | 완화 |
|---|---|
| Kakao 네이티브 id_token `aud` 거부(supabase/auth#1715 미해결) | Phase 0 스테이징 스파이크; 실패 시 PKCE 웹 플로우(`expo-web-browser`) 폴백 — 계정 아이덴티티는 동일 |
| Google Original SDK 가 레거시 Android Sign-In 의존(Play Services 제거 예정) | 출시 전 Universal(유료) 전환 여부 결정; 코드 경계는 `auth.ts` 한 파일, `signInWithIdToken` 이라 교체 비용 낮음 |
| Apple 로그인이 릴레이 이메일로 별도 계정 생성 → 웹 기록과 분리; iOS Apple 가입 계정이 Android 앱에 로그인 경로 없음; 릴레이 계정은 체험 원장과도 별개 | 로그인 화면 안내; 웹 Apple 버튼 추가; **Android 앱 PKCE Apple 경로**(§7.1); 수동 계정 연결은 미지원; 체험 재개 허용 여부 §13 질문 3 |
| IAP 영수증 멱등키가 `payments.order_id` 뿐인데 `payments.user_id` 가 cascade → 탈퇴·재가입 후 같은 트랜잭션 재부여, 타 계정 재사용 미거절 | `store_transactions` 원장(auth FK 없음) 선점 + `on conflict do nothing`(§8.2); 탈퇴 후 환불 웹훅은 로그·관리자 알림 |
| `explanations-get` 이 호출마다 로그를 써 캐시 정책에 따라 정상 사용자가 40/h 잠금 | 페이지 모드 전용 쿼리 옵션(§6.3: `staleTime Infinity`·포커스/재연결 재조회 off·`retry:false`·무효화 없음) |
| CBT/복습 이중 채점(read-then-write) | 시작 행 원자 회수·세션 선점 update 를 core 규칙으로, 계약 테스트 동시 제출 케이스(§6.6, §11) |
| iOS 3.1.3(b): IAP 없이 웹 결제 멤버십을 인정하면 리젝 | 전면 무료 기간 중 출시 → 잠금 기능 없음; `FREE_UNTIL` 전에 Phase 5 완료; 앱 내 웹 결제 언급 0 |
| 재스캐폴드·서버 액션 어댑터 전환 중 웹 회귀 | Phase 0 이 계약 테스트·웹 E2E·토큰 drift 테스트를 먼저 green 으로; `globals.css` 전환은 텍스트 diff 0 확인 후 |
| `react-native-pdf` 7 이슈 백로그(382건)·`pdf-pen-viewer.tsx` 미검증 | Phase 0 실기기 판정; Phase 1 보기 전용; 폴백 = 서버 페이지 이미지(`expo-image`) |
| Uniwind 무료 티어 한계(className 애니메이션 없음, Pro 유료)·Metro 충돌 | 애니메이션은 Reanimated `style` 로만; 토큰은 CSS 라 라이브러리 교체 시 화면 className 유지; 폴백 `StyleSheet`+`tokens.ts` |
| `_shared/core.mjs` 번들이 Deno 런타임에서 esm 호환 안 됨 | esbuild `format: esm, platform: neutral`; 계약 테스트가 첫날 잡음 |
| Edge 번들 도입이 AGENTS.md "두 파일 함께 수정" 규칙과 표면적 충돌 | 번들 게이트 전까지 규칙 유지; 이후 생성물 검사로 의도 보장; 문구 갱신은 소유자 승인 |
| `_shared/status-targets.ts` 교체로 기존 앱 채점 결과 차이 | 문항 수 다른 형제 문제지 픽스처 계약 테스트 후 교체 |
| 해설 응답 캐시로 무료 한도 우회 | §6.5 비퍼시스트 규칙(`shouldDehydrateQuery`), 메모리만 |
| 웹훅 유실로 IAP 권한 미반영 | 앱 시작 시 영수증 재검증 → `iap-verify` 가 원장 + `apply_paid_membership 'already'` 로 멱등 재적용 |
| Google Play 에 비자동갱신 구독 유형이 없음 → 검증 API·RTDN·환불 해석이 상품 유형에 따라 갈림 | 일회성(managed, 소비) 상품으로 결정, `purchases.products.get/consume` + `oneTimeProductNotification`(§8.2); PBL ≥ 8 |
| 스토어 UGC 요건(Apple 1.2) — 웹에 게시글 신고·차단 없음 | Phase 5 `report_post`/`block_user` 최소 구현, 차단은 앱 전용 필터로 시작 |
| 해외 IP 심사자(App Review·Play)가 `/terms`·`/privacy`·`.well-known`·계정 삭제 안내에서 403(geo-block) | `lib/geo-block.ts` 면제 목록에 `/terms`·`/privacy`·`/app-ads.txt`·`/account/delete-request`(`INFRA_FILES`)·`/.well-known`(`INFRA_DIRS`) 추가(§5). 우회 토큰 링크는 `GEO_BLOCK_BYPASS_TOKEN` 을 앱 번들에 싣는 선택이라 **금지**, 정적 사본은 법적 문서 두 벌 문제로 배제 |
| expo-router 58 이 `beforeRemove` preventable·`redirect`·`initialRouteName` 제거; iOS 스와이프 뒤로가기·Android 예측 뒤로가기는 `BackHandler` 로 못 잡음 | 57 에서 `unstable_settings` 만 쓰고 이탈 확인은 자체 뒤로가기 + `BackHandler` + 몰입 화면 `gestureEnabled:false`/`fullScreenGestureEnabled:false`(§4.4) |
| `react-native-render-html` 6.3.4(2022-01)가 함수 컴포넌트 `defaultProps` 를 써 React 19 에서 기본값 미적용 | 채택하지 않음; Phase 5 에 `ALLOWED_TAGS` 22종 자체 렌더러(#31) |
| 기존 트리 SDK 57 스파이크가 "설정 차이뿐" 이 아님(`offline.ts` 레거시 FS API, seoul kakao 플러그인 옵션 등) | §10 JS 최소 수정 목록을 스파이크 일정에 포함 |
| 릴리스 크래시가 어디에도 남지 않음(`FatalErrorScreen` 스크린샷뿐) | Sentry(§3.1) Phase 1a 부터; 크래시 payload 에 정답·해설·`user_metadata` 금지 |
| `supportsTablet: true` 상태로 첫 iOS 빌드 → iPad 스크린샷·심사 요구, 레이아웃 임의 결정 | `supportsTablet: false` + 폰 전용(§4.4); iPad 는 §13 질문 13 |
| 계약 테스트가 Docker 의존 | Actions 전용; 로컬은 core 단위 테스트만 |
| Deno 이미지 처리(아바타) | WASM 코덱 검증; 실패 시 Next route handler(bearer JWT) |
| `explanation_excluded_subjects`·`exam-papers` 버킷 정책·`concepts` 테이블이 레포에 없거나 스크립트에만 있음 | 앱 영향 없음(읽기 공개); 배포 스크립트에 주석; 운영 적용 여부 확인 |
| 무료 이벤트 종료(2027-07-01) 시 잠기는 기능 급증 | 게이팅은 전부 서버 판정이라 앱 코드 변경 없음; 잠금 UI 는 Phase 1 부터; 시계 주입 테스트 |
| 유출된 `EXPO_TOKEN`(SECURITY.md §4) | Phase 0 전에 재발급 |

**소유자만 답할 수 있는 질문**

1. 하단 탭 없이 웹과 동일한 헤더+드로어 IA 로 가는 것(설계 기본값)을 수용하는가, 아니면 `expo-router/native-tabs` 를 허용하는가(웹과 갈라짐)?
2. 결제: IAP 를 Phase 5(`FREE_UNTIL` 전)로 두고 그 전까지 앱에 구매 UI 를 두지 않는 데 동의하는가? `expo-iap` 직접 검증 vs RevenueCat? Google 상품 유형 — 설계 기본값 **일회성 상품(managed, 소비)** vs 선불 기본 요금제(prepaid base plan, Play 가 "구독"으로 취급)? 사업자 정보(`lib/business.ts`)·스토어 계약 시점은? Google 로그인 Universal(유료) 전환 의사는?
3. Apple 계정 정책: 웹에 Apple 버튼을 추가해도 되는가? Supabase 프로젝트의 identity linking 설정 상태는? 릴레이 이메일 계정을 별도로 둘지, 계정 병합 기능을 만들지? 릴레이 이메일 계정이 `trial_consumptions` 원장과 별개라 `FREE_UNTIL` 이후 체험 60일이 다시 켜지는 것을 허용하는가?
4. 과목 배지 팔레트 슬롯 0 이 웹에서 초록으로 렌더되는 현상을 앱도 그대로 따를지, 양쪽을 함께 고칠지?
5. AdMob 을 출시부터 켤지(체험·전면무료 사용자에게 광고) 아니면 Phase 5 이후로 미룰지? AdMob 계정이 AdSense `pub-1367114332344973` 과 같은 게시자인가(`app-ads.txt` 값)?
6. 원격 푸시(`device_tokens` 신설, FCM/APNs) 도입 여부와 시점 — 웹에도 없는 기능. 로컬 20시 리마인더 유지 여부.
7. Apple `.p8` 키 **발급 시점**(가능 여부가 아니라 — 탈퇴 시 토큰 revoke 는 스토어 제출 전 필수이고 Android PKCE Apple 로그인·Apple 프로바이더 활성화에도 필요하므로 Phase 1b 전에 있어야 한다).
8. 앱 게시판 작성을 서식 없는 텍스트+이미지+기본 서식 축소판으로 한정해도 되는가? UGC 신고·차단을 웹에도 함께 넣을지?
9. Edge 번들 도구(esbuild 기본)와 AGENTS.md `srs.ts` 동시 수정 문구 갱신 승인 — 승인 전까지 `_shared/srs.ts`·`review-pick.ts`·`profanity.ts` 는 삭제하지 않고 re-export 로만 둔다(§3.2, §12 Phase 0). `ai-diagnose` 를 폐기하고 웹 Batches 파이프라인으로 통일하면 앱 진단이 "즉시"가 아니라 "최대 1시간 대기"가 된다 — 허용되는가?
10. 운영 DB 상태 확인: 닉네임·멤버십 트리거, `explanation_excluded_subjects`, `concepts` 테이블 적용 여부; `EXPO_TOKEN` 재발급과 Supabase 프로바이더 3종 활성 여부; Maestro 용 테스트 계정(이메일/비밀번호 provider 를 스테이징에만 켤지 — 답이 없으면 Phase 2 의 Maestro 종료 조건이 성립하지 않는다).
11. SDK 58 정식(≈2026 Q4) 시점에 바로 옮길지, 57 로 출시 후 옮길지. 홈 초기 화면을 웹처럼 랜딩(`/`)으로 둘지, 앱에서는 `/papers` 로 바로 열지 — 로그인 직후 기본 목적지(웹은 `/`, §7.1)와 함께 결정.
12. 관측: Sentry 크래시 리포팅은 Phase 1a 기본(§3.1, §12)으로 두되, 제품 분석은 GA4 앱 스트림(`@react-native-firebase/analytics`)을 넣을지 분석 없이 출시할지 — 선택이 ATT·App Privacy·`/privacy` 문구를 바꾼다. Sentry 자체를 빼려면 §12 Phase 1a 종료 조건("테스트 크래시 1건 수신")도 함께 바꿔야 한다.
13. iPad 지원 시점: 폰 전용(`supportsTablet: false`)으로 출시하고 태블릿(웹 `md:`/`lg:` 분기 재현, iPad 스크린샷)은 Phase 6 으로 미루는 데 동의하는가(§4.4)?
14. Supabase 플랜에 Storage 이미지 변환(`/render/image/`)이 포함되는가 — 포함되면 문항 이미지(lossless WebP ×3, 수백 KB)를 폰 폭에 맞춰 축소 전송할 수 있다(§6.2 문항 이미지 행).
15. `review_preferences` 의 RLS insert/update 정책(schema.sql:1804-1823)을 회수할지 — 웹 서버 액션이 세션 클라이언트로 쓰고 있어 회수하려면 웹 어댑터도 admin 클라이언트로 바꿔야 한다(§6.7 #13).
16. 탈퇴 정책: `board_posts`·`chat_messages`·`suggestions` 등의 cascade 삭제(타인 댓글 동반 삭제)를 유지할지 익명 계정 id 로 이전할지; cascade 로 지워지는 `payments` 를 결제 분쟁 대응용으로 탈퇴 전 스냅샷할지(§7.1).

---

## 부록: 근거 파일 색인

| 결정 | 근거 파일 |
|---|---|
| 브랜드 초록 토큰·다크 오버라이드·`@custom-variant dark`·모션 keyframe·`.board-content` | `apps/web/src/app/globals.css`(7–17행 `:root`/`@theme inline`, 28–67행 토큰 블록, 122–165행 loading-*, 255–334행 skeleton/modal/drawer, 347–402행 promo-*, 410–470행 `.board-content`), `apps/web/src/components/theme-toggle.tsx`, `apps/web/src/app/layout.tsx` |
| 헤더 65px·드로어·내비 항목·FAB | `apps/web/src/components/site-header.tsx`, `site-header-gate.tsx`, `mobile-nav.tsx`, `site-nav-items.ts`, `user-menu.tsx`, `review-fab.tsx`, `chat-fab.tsx`, `site-footer.tsx` |
| 배지·티어·과목 팔레트 | `apps/web/src/lib/level-colors.ts`, `exam-type-colors.ts`, `subject-colors.ts`, `round-tier.ts`, `streak.ts`, `exam-type-icons.ts`, `packages/core/src/tiers.ts`, `subject-color.ts`; 모바일 `src/theme/badges.ts`, `exam-type-icons.ts` |
| CBT 규칙·OMR 분할·보기 모드·드로잉 | `apps/web/src/components/cbt-solver.tsx`, `single-question-view.tsx`, `question-view-gestures.ts`, `cbt-omr-panel.tsx`, `cbt-drawing-toolbar.tsx`, `cbt-view-mode-lock.tsx`, `cbt-result-modal.tsx`, `pdf-canvas-viewer.tsx`, `apps/web/src/lib/cbt-omr-split.ts`, `cbt-view-mode.ts`, `cbt-attempt.ts`, `apps/web/src/app/papers/actions.ts`, `supabase/functions/cbt-start`, `cbt-submit`, `_shared/cbt.ts` |
| SRS·복습 세션·due 큐·mix | `packages/core/src/srs.ts`, `review-queue.ts`, `review-pick.ts`, `review-resume.ts`, `mix-practice.ts`, `study-phase.ts`; `apps/web/src/lib/review-session.ts`, `review-queue.ts`, `review-preferences.ts`, `mix-practice.ts`, `question-status.ts`, `status-targets.ts`, `dedup-papers.ts`; `apps/web/src/app/mypage/wrong-notes/actions.ts`; `supabase/functions/review-create`, `review-submit`, `review-history`, `_shared/status.ts`, `_shared/status-targets.ts`, `_shared/srs.ts`, `_shared/review-pick.ts`, `_shared/media.ts` |
| 오답노트·해설 접근 | `apps/web/src/lib/wrong-notes.ts`(284–405행 해설 정규화, `includeExplanations`), `explanation-rate-limit.ts`, `apps/web/src/app/papers/[id]/explanations/page.tsx`, `components/explanation-body.tsx`, `explanation-lock.tsx`, `wrong-note-question-card.tsx`, `wrong-note-mark-actions.tsx`; `supabase/functions/explanations-get`, `_shared/explanations.ts`; `packages/core/src/wrong-notes.ts` |
| 멤버십·체험·결제·광고 | `packages/core/src/membership.ts`, `pricing.ts`, `payment.ts`, `attendance.ts`; `apps/web/src/lib/membership.ts`, `payments.ts`, `toss.ts`, `business.ts`, `ads.ts`, `adsense.ts`, `ad-slots.ts`, `attendance.ts`; `apps/web/src/app/membership/*`, `payments/toss/*`, `api/payments/toss/webhook/route.ts`; `supabase/functions/_shared/membership.ts`, `_shared/attendance.ts`; `supabase/schema.sql`(`memberships`, `payments`:1873 `provider`, `trial_consumptions`, `start_trial_if_eligible`, `apply_paid_membership`, `revoke_paid_membership`, `record_attendance_day`, `grant_attendance_membership`); `apps/web/docs/agents/adsense.md` |
| 인증·닉네임·아바타·탈퇴 | `apps/web/src/app/actions.ts`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `app/onboarding/nickname/page.tsx`, `lib/safe-redirect.ts`, `lib/avatars.ts`; `packages/core/src/nickname.ts`, `avatar.ts`; `supabase/schema.sql`(`sync_nickname_from_auth`, `trg_create_membership`, `is_nickname_taken`, `is_admin`); `supabase/functions/account-delete`; 모바일 `src/lib/auth.ts`, `secure-storage.ts`, `profile.ts`, `account.ts`, `providers/auth-provider.tsx`, `app/_layout.tsx` |
| 커뮤니티·알림·채팅·진단 | `packages/core/src/board.ts`, `rich-text.ts`, `notices.ts`, `suggestions.ts`, `chat.ts`, `notifications.ts`, `comments.ts`, `profanity.ts`; `apps/web/src/app/board/actions.ts`, `suggestions/actions.ts`, `chat/actions.ts`, `notifications/actions.ts`, `mypage/actions.ts`; `apps/web/src/lib/board.ts`, `suggestions.ts`, `notifications.ts`, `ai-diagnosis.ts`, `ai-diagnosis-thresholds.ts`, `diagnosis-limits.ts`, `diagnosis-live.ts`, `diagnosis-batch.ts`; `apps/web/src/app/api/cron/diagnosis/route.ts`; `supabase/functions/ai-diagnose`, `comments-write`; `apps/web/docs/agents/board-rich-text.md` |
| 라우트·URL·dedup·검색 | `apps/web/src/app/**/page.tsx`, `route.ts`(`download/[id]`, `api/version`, `attendance-promo.png`), `next.config.ts`, `robots.ts`; `apps/web/src/lib/paper-href.ts`, `paper-slug-map.ts`, `paper-search.ts`, `home-data.ts`, `all-papers.ts`, `download-counting.ts`, `apps/web/src/app/papers/[id]/page.tsx`(상세 데이터 조회는 페이지 안 인라인 — `paper-detail-data.ts` 는 존재하지 않음); `packages/core/src/paper-slug.ts`, `search.ts`, `hangul.ts`, `dedup-papers.ts`, `exam-level-tier.ts`; `apps/web/docs/agents/dedup-papers.md` |
| geo-block·심사자 403·`.well-known` | `apps/web/src/proxy.ts`, `apps/web/src/lib/geo-block.ts`(`INFRA_DIRS`, `INFRA_FILES`), `apps/web/.env.local.example`(`GEO_BLOCK_BYPASS_TOKEN`), `apps/web/docs/agents/geo-block.md` |
| 관측·오류·개인정보 고지 | `apps/web/src/app/layout.tsx`(Analytics·GA·Clarity), `apps/web/src/app/privacy/page.tsx`, `terms/page.tsx`; `apps/mobile/app/_layout.tsx`(`ErrorBoundary`), `src/components/fatal-error-screen.tsx`; `supabase/functions/_shared/clients.ts`(`requireUser`/`getOptionalUser`), `_shared/cbt.ts`(`corsHeaders`/`json`) |
| 모바일 현재 상태·중복·KEEP/DROP | `apps/mobile/package.json`, `app.json`, `eas.json`, `metro.config.js`, `.gitignore`, `README.md`, `SETUP.md`, `SECURITY.md`, `scripts/check-build-env.mjs`, `.github/workflows/eas-build.yml`; `apps/mobile/src/lib/*.ts`(27개 — `offline.ts`, `download.ts`, `reminders.ts`, `legal.ts`, `updates.ts` 포함), `src/components/*.tsx`(11개), `src/theme/*.ts`, `app/**`(22개); `apps/mobile/src/lib/mypage.ts:55` 와 `apps/web/src/app/mypage/page.tsx:82`(`computeAttemptRounds` 중복) |
| 스택 버전 | landscape 리포트(npm registry·Expo SDK 57 `bundledNativeModules.json`·벤더 문서, 2026-09-15 기준); 레포의 `apps/mobile/package.json`, `apps/web/package.json` |
| 금지선 | `apps/web/AGENTS.md`(체험 시작 RPC, `srs.ts` 동시 수정, 정답 등록(`question_count` 길이·track 복사 금지·`voided_questions`), `sanitizeRichText` 서버 강제, CBT/복습 광고 금지, dedup 표시 유지, 버킷 쓰기 정책, `subjects` 행 추가 금지, AdSense ID 단일 위치 — "정답 비노출" 항목은 AGENTS.md 에 없다); `apps/mobile/SECURITY.md` §8(정답 비공개·IDOR — 정답·해설 RLS 차단의 출처) |
