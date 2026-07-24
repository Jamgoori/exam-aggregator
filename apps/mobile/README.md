# 공모아 모바일 앱 (Expo / React Native)

공모아 웹(`exam-aggregator`)과 **같은 Supabase 프로젝트**를 백엔드로 쓰는 네이티브 앱 뼈대.
DB·인증·스토리지·RLS·RPC를 그대로 재사용한다. 앱은 새 클라이언트만 구현한다.

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
    cbt.ts                채점 Edge Function 호출 래퍼 (start/submit)
    format.ts             formatDuration (웹과 동일 표기)
    storage.ts            공개 URL 헬퍼
    types.ts              웹 types.ts 복사본 (스키마 바뀌면 동기화)
  providers/auth-provider.tsx  세션 컨텍스트 + 자동 갱신
  components/
    single-question-view.tsx   문제별 보기 (이미지 핀치줌 + 선택지 + 이전/다음)
    omr-panel.tsx              OMR 답안지 (채점 후 정/오답 색)
    cbt-result-modal.tsx       점수·소요시간 결과
    pdf-pen-viewer.tsx         전체 PDF + 펜 필기 (react-native-pdf + Skia)
  theme/colors.ts         웹 팔레트 최소 토큰
supabase/functions/       서버 백엔드 (Deno Edge Functions)
  cbt-start/              CBT 시작시각 기록 (service_role)
  cbt-submit/             CBT 정답 조회·채점·응시 기록 (service_role)
  review-create/          섞어풀기 세션 생성 (내 오답 중 이미지 있는 것 무작위)
  review-submit/          섞어풀기 채점 (정답 비공개, source='review' 상태 갱신)
  ai-diagnose/            AI 약점 진단 (Claude 호출 → 리포트 생성·저장)
  _shared/                상수·검증·클라이언트·상태갱신·이미지
```

## 서버 백엔드 (Edge Functions) — 배포 필요

정답(`paper_answers`)·응시/세션 기록은 **클라이언트가 직접 못 다룬다**: 정답은 RLS 로
앱에 완전 차단(커닝 방지)돼 있고, 점수·시작시각·회독 위조를 막기 위해 쓰기도
service_role 전용이다. 그래서 웹 서버 액션과 동일 로직을 Edge Function 으로 옮겼다.
service_role 키는 함수 런타임에만 있고 앱 번들엔 절대 넣지 않는다.

```bash
supabase functions deploy cbt-start
supabase functions deploy cbt-submit
supabase functions deploy review-create
supabase functions deploy review-submit
supabase functions deploy ai-diagnose
supabase functions deploy explanations-get

# AI 진단은 Claude 를 부르므로 키가 필요하다(함수 런타임 시크릿, 앱엔 안 들어감):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# 모델 바꾸려면(선택): supabase secrets set DIAGNOSIS_MODEL=claude-sonnet-5
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 는 Edge 런타임이
자동 주입한다. 앱은 `supabase.functions.invoke("cbt-submit", ...)` 로 호출하며 로그인
사용자의 JWT 가 자동 첨부된다.

## 현재 구현 상태

- ✅ 인증(네이티브 소셜), 세션, 탭 네비, 문제지 목록/상세
- ✅ **CBT 문제별 풀기**: 5초 카운트다운 → 서버 시작기록 → 문항 이미지 핀치줌 +
  OMR 답안지 + 최소 3분 검증 + Edge Function 채점 + 결과. 세트문제(공통지문) 묶음 지원.
- ✅ **전체 PDF + 펜 필기** (`pdf-pen-viewer.tsx`): react-native-pdf 로 페이지 렌더 +
  Skia 오버레이 필기. 이동/펜/지우개, 색·굵기, 페이지 이동, 줌·팬. 획은 페이지 정규화
  좌표로 저장(줌해도 페이지에 붙어 있음). 크롭 이미지 없는 문제지도 PDF 로 풀 수 있다.
- ✅ **마이페이지**: 통계(CBT 응시·연속 학습 스트릭·남은 오답) + 탭 3종 —
  기록(응시 이력, N회독), 즐겨찾기(북마크), 오답노트(과목별 남은 오답 요약).
  화면 진입 시마다 새로고침(`useFocusEffect`)돼 채점 직후 갱신된다.
- ✅ **오답노트 상세** (`app/wrong-notes/[slug].tsx`): 과목 → 문제지별 틀린 문항
  이미지 + 극복/미극복 배지 + "다시 풀기"(해당 CBT 로). 이미지 탭하면 확대(핀치줌).
  정답은 표시하지 않는다(RLS 차단·커닝 방지) — 극복 판정은 CBT 재응시 때 서버가 한다.
- ✅ **검색** (`app/(tabs)/search.tsx`): 과목·연도·급수 + **초성 검색**(예: `ㄱㅇ`).
  300ms 디바운스 + 경합 방지. 웹 전체목록 다운로드 대신 서버 쿼리로 좁힌다
  (`search.ts`: matchSubjectIds/parseSearchQuery 는 웹 규칙 그대로 포팅).
- ✅ **섞어풀기** (`app/review.tsx` + review-create/submit): 내 오답(이미지 있는)을
  무작위로 모아 다시 풀고 서버 채점. 극복 시 `user_question_status`(source='review') 갱신.
- ✅ **AI 약점 진단** (`app/diagnosis.tsx` + ai-diagnose): 과목별 오답/극복·최근 응시를
  Claude 에 넘겨 요약·약점 개념·과목 추세를 생성. 하루 1회 캐시. 약점 개념 → 오답노트 딥링크.

- ✅ **문제지 상세**: 즐겨찾기 토글, 난이도 평가(평균·내 평가), 원본 PDF 보기,
  댓글(작성·삭제). 모두 RLS 본인 쓰기라 서버 없이 클라이언트에서.
- ✅ **닉네임**: 소셜 로그인 후 없으면 온보딩(`app/nickname.tsx`, `_layout` 게이트),
  마이페이지에서 수정. `is_nickname_taken` RPC 로 중복 확인.
- ✅ **응시 상세** (`app/mypage/attempts/[attemptId].tsx`): 한 응시의 문항별 정/오답 +
  문제 이미지(기본 틀린 문항만). 기록 탭에서 진입.
- ✅ **과목별 보기** (`app/subjects/`): 과목 목록(즐겨찾기 별) → 과목별 문제지. 홈에서 진입.
- ✅ **문항 메모** (`memo-field.tsx`, `question_memos`): CBT 문제별 풀기에서 문항마다
  메모. 자동 저장(포커스 아웃 시). 로그인 사용자만.
- ✅ **해설** (`app/papers/[id]/explanations.tsx` + Edge Function `explanations-get`):
  문항 이미지·정답·해설을 번호순으로. 정답(`paper_answers`)·해설(`question_explanations`)
  둘 다 admin 전용 RLS(일반 select 완전 차단)라 CBT 채점과 같은 이유로 서버(Edge
  Function)에서만 읽는다. 비로그인은 미리보기 2문항, 로그인은 시간당 40회 조회 한도
  넘기면 마찬가지로 미리보기(`explanation_access_log` 로 웹과 동일 규칙).

> 댓글 수정은 지원 안 함(테이블에 update RLS 정책이 없음 — 작성·삭제만).

> 섞어풀기 후보 수집은 v1 단순화(웹의 dedup·수동표시·복습 쿨다운 미반영).
> AI 진단은 웹(요청행만 만들고 배치가 채움)과 달리 앱은 Edge Function 에서 온디맨드로
> 바로 생성한다. 같은 `ai_diagnoses` 테이블·스키마·하루 1회 규칙을 공유한다.

> 마이페이지의 "남은 오답"은 `user_question_status`(마지막 제출 오답) 기준 근사치다.
> 웹은 dedup·수동표시·복습 쿨다운까지 반영한 권위 집계를 쓰므로 숫자가 미세하게 다를 수 있다.

### 정렬 원리 (pdf-pen-viewer)

react-native-pdf 의 **네이티브 줌을 잠그고**(min=max=1), 줌/팬은 reanimated transform 으로
[페이지 + Skia 오버레이]를 **함께** 변환한다. 이러면 두 레이어가 한 몸으로 움직여 획이
페이지에 항상 붙는다. 획은 페이지 박스 기준 0~1 정규화 좌표로 저장한다.

> ⚠️ **기기 검증 필요**: PDF+펜은 이 환경에서 네이티브 빌드를 못 돌려 실기기 테스트가
> 안 됐다. 터치 좌표 매핑·줌 상한·멀티페이지 전환 시 오버레이 동기화는 실기기에서
> 미세조정이 필요할 수 있다. react-native-pdf 는 dev build 전용(Expo Go 불가)이며
> `react-native-blob-util` 피어 의존과 iOS 빌드 설정(expo-build-properties)이 필요할 수 있다.

> 타입 검증: 이 저장소 코드는 내부 타입 일관성만 확인됐다(tsc 통과). 라이브러리 API
> 시그니처 최종 검증은 `npx expo install` 후 `npx tsc --noEmit` 로 할 것.

## 유지보수 주의

- `src/lib/types.ts`는 웹 `src/lib/supabase/types.ts` **복사본**이다. 스키마 변경 시 둘 다 갱신.
- `supabase/functions/` 채점 로직은 웹 `src/app/papers/actions.ts` 와 **동일 규칙**을
  유지해야 한다(최소 응시시간·정답 비공개·service_role 쓰기). 한쪽만 바꾸지 말 것.
- RLS·RPC는 웹과 공유 자원 — 앱에서 스키마를 바꾸지 말 것.
- publishable(anon) 키만 앱에 넣는다. service_role 키는 **절대** 앱 번들에 넣지 말 것.
