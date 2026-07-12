<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 문제 이미지 크롭 작업 시 필독

`scripts/crop-question-images.mjs` / `scripts/batch-crop-questions.mjs`로 PDF에서
문항 이미지를 잘라 `question_images`에 등록하는 작업(새 시험유형 요청 포함)은
**절대 한 번 돌리고 성공/실패 개수만 보고 끝내지 말 것.** 이 두 스크립트는 이미
2단/1단 레이아웃, 세트문제(공통지문/지시문 재사용) 자동 판별, "문" 신뢰 기반
마커 인식 등 여러 실측 버그를 거쳐 완성된 상태이지만, 매번 새로운 PDF 조판
변형이 나올 수 있다. 실제로 검증 없이 돌렸다가 결과가 나쁘게 나온 세션이
있었다 — 아래 순서를 반드시 지킬 것:

1. **샘플 검증**: 대상 시험유형/급수에서 무작위 25~60개를 `extractQuestionsFromPdf`로
   (업로드 없이) dry 테스트해서 `cropped.length === question_count`가 다 맞는지 확인.
2. **전체 배치 실행**: 문제없으면 `npm run batch-crop-questions -- --exam-type X --level Y`.
   개수가 안 맞는 문제지는 자동으로 업로드가 스킵된다(반쪽만 잘린 이미지를 "성공"으로
   잘못 표시하지 않기 위한 안전장치).
3. **전체 재검증**: 전체 문제지를 다시 dry 테스트해서 실패/주의 0건 확인. 여기서
   문제가 나오면 원인(마커 인식, 안내문 인식, 레이아웃 등)을 찾아 고친 뒤 **이미
   완료했던 다른 시험유형/급수도 전부 재검증** — 한 곳을 고치면 다른 곳이 깨질 수
   있다(실측: hasMun 로직 하나 바꿨다가 다른 3개 문제지가 새로 깨진 적 있음).
4. **병합 세트 스크린샷 확인**: 세트문제로 병합된 것 중 최소 1~2개는 실제로
   Read 도구로 이미지를 열어 지문+문제가 온전히 다 보이는지 눈으로 확인.
5. **DB 완전성 확인**: `question_images` 개수가 `question_count`와 정확히 일치하는
   문제지 수를 세어 미크롭/불완전 0건 확인.
6. 이 전부를 통과한 뒤에만 커밋/빌드/푸시.

"개수만 맞으면 성공"이라고 판단하지 말 것 — 실제로 반쪽만 잘렸는데 문항 수만
우연히 맞아떨어져 "성공"으로 표시된 사례가 있었다(1단 레이아웃 문제지). 의심스러운
케이스는 반드시 스크린샷으로 원본과 대조할 것.

# 문항 해설 배치 루틴 (자동 반복 작업) 필독

`문항 해설 배치 처리`(순방향)와 `문항 해설 배치 처리 (역방향)` 두 개의 정기 루틴이
Claude Code Remote 스케줄(cron)로 떠서 exam-aggregator 문항에 AI 해설을 자동
생성한다. 이 루틴이나 관련 스크립트를 건드릴 일이 있으면 아래를 먼저 알아둘 것:

- **스크립트는 이 레포에 없다.** `scripts/next-explanation-chunk.mjs`,
  `scripts/save-explanations.mjs`, `scripts/explanation-prompt.md`는 git에 커밋된
  게 아니라 **Supabase Storage**에 있고, 각 루틴 세션이 부팅할 때 그걸 받아온다.
  레포에 안 보인다고 없는 게 아니다 — 고치려면 루틴 세션(환경
  `env_011UL7sPM6VGLPJ9nJdKXYut`)을 새로 하나 띄워 Storage 원본을 읽고 수정한
  뒤 검증(dry 테스트)하고 나서 같은 경로에 다시 업로드해야 반영된다.
- **순방향/역방향은 양 끝에서 좁혀오는 방식.** 순방향은 문항 목록 앞에서부터,
  역방향은 `--reverse` 플래그로 뒤에서부터 진행해 중간에서 만난다(`done:true`).
  서로 반대 방향이라 동시에 돌아도 안전하지만, **같은 방향끼리 겹치면 같은 쪽
  청크를 중복 처리**하니 그게 항상 진짜 위험 지점이다.
- **스케줄은 2시간 간격, UTC 기준.** 순방향은 짝수 UTC시(=KST 홀수시), 역방향은
  홀수 UTC시(=KST 짝수시) 59분에 발동해서 매시간 한쪽이 새로 뜬다. 루틴 화면의
  "반복" 목록 UI는 시간대 변환 없이 UTC 숫자를 그대로 표시하는 버그가 있다 —
  실제 다음 발동 시각은 반드시 "다음 실행" 필드로 확인할 것.
- **세션은 2시간에 저절로 안 멈춘다.** 크론 간격은 "몇 시간마다 새 세션을
  띄운다"는 뜻이지 "기존 세션을 몇 시간 뒤에 죽인다"는 뜻이 아니다. 그래서 각
  루틴 세션은 시작 시각을 `date +%s`로 기록해두고, 청크를 하나 저장할 때마다
  경과 시간을 확인해 **100분을 넘기면 그 청크까지만 마치고 정상 종료**하도록
  프롬프트에 명시돼 있다(같은 방향 세션끼리 겹치는 걸 막는 장치). 루틴 프롬프트를
  다시 만들 일이 있으면 이 규칙을 꼭 유지할 것 — 뺐다가 겹침 사고가 실제로
  재발한 적 있다.
- **`question_explanations` RLS**: 해설봇 계정
  (`explanation-bot@exam-aggregator.internal`, uid
  `5a3f5fc5-fd81-4728-91ae-c90cb2934d17`)이 이 테이블에 쓸 수 있도록 admins 등록
  + uid 기반 INSERT/UPDATE 정책을 걸어뒀다. 이 테이블 RLS나 `admins` 화이트리스트를
  다시 손볼 일이 있으면 이 봇 계정의 쓰기 권한이 안 깨지는지 반드시 확인할 것
  (한 번 스키마 변경으로 조용히 깨진 전적이 있음).
- **`question_explanations_question_uidx` unique 인덱스**: `question_id`에 걸려
  있다. `save-explanations.mjs`는 순수 INSERT가 아니라
  `.upsert(..., { onConflict: "question_id" })`를 쓰는데, PostgREST의 upsert가
  `ON CONFLICT (question_id)`를 실행하려면 그 컬럼에 매칭되는 unique/exclusion
  제약이 반드시 있어야 한다 — 이 인덱스가 그 전제조건이다. 지웠다간 저장 자체가
  안 되거나 중복 저장이 다시 가능해지니 절대 손대지 말 것.
- **제외 과목**: `next-explanation-chunk.mjs`는 `explanation_excluded_subjects`
  테이블을 매 실행(청크 하나 요청할 때마다 새 프로세스로 뜸)마다 조회해서, 거기
  등록된 subject_id를 가진 문제지는 통째로 건너뛴다. **스크립트에 과목을
  하드코딩하는 방식이 아니다** — 제외할 과목을 바꾸고 싶으면 이 테이블에
  INSERT/DELETE만 하면 되고, 스크립트 수정이나 Storage 재업로드는 전혀 필요 없다
  (심지어 지금 돌고 있는 세션의 다음 청크 요청부터 바로 반영된다). 러시아어,
  불어, 수학, 중국어, 스페인어, 독어, 과학, 일어의 subject_id가 이 테이블에
  등록돼 있다. 이걸 스크립트 쪽 필터로 착각해서 `next-explanation-chunk.mjs`를
  고치려 하다가 애먼 Storage 업로드 권한 문제로 여러 세션을 낭비한 전적이 있다
  (해설봇 계정은 이 스크립트에 대해 읽기 전용이고, Storage에 이 스크립트가 있는
  `exam-papers` 버킷은 쓰기 정책이 0개라 서비스 롤 없이는 애초에 못 쓴다).
- **Batch API 전환 검토 이력**: 남은 물량이 많아 속도를 올리고 싶다면 Anthropic
  Batch API로 전환하는 방법도 검토했었다 — 품질은 동일(같은 Opus 모델), 5시간
  세션 한도와 무관하게 병렬로 처리돼 훨씬 빠르지만, Max 구독 한도가 아니라
  별도의 실비 API 과금(토큰당, 배치 50% 할인)이 새로 발생한다. 또한 Claude Code의
  Agent 도구는 `effort` 파라미터를 노출하지 않아 지금 구조에서는 급수별로 effort를
  낮추는 등의 세밀한 조절이 불가능하다 — 이건 raw API/Batch로 옮겨야만 가능해진다.
