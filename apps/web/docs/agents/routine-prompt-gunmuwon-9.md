# 군무원 9급 해설 배치 루틴 프롬프트 (순방향·병렬 3)

Claude Code Remote 루틴 **"군무원 9급 문항 해설 배치 (순방향)"** 에 넣는 프롬프트
원문이다. 루틴은 발동할 때마다 **새 세션**을 띄우므로 프롬프트는 아무 맥락 없이
혼자 읽혀도 동작해야 한다. 여기를 고치면 트리거 프롬프트도 같이 갱신할 것
(`update_trigger`) — 트리거 쪽이 실제로 도는 원본이고 이 파일은 리뷰용 사본이다.

설계 배경(왜 90분인지, 왜 청크 경계가 순방향 고정인지 등)은
`explanation-batch-routines.md`를 읽을 것. 이 루틴에만 있는 특징은 범위 플래그
`--title-like "군무원 9급"`(제목 부분일치)뿐이고, 나머지 규칙은 기존 v3 병렬 배치와
같다. 제목이 `"2024 군무원 9급 국어"` 형태라 이 한 줄로 잡히고, `level` 컬럼이 빈
문제지도 제목에 급수가 있으면 포함된다. 만약 띄어쓰기 없는 제목(`"군무원9급"`)이
섞여 있는 게 확인되면 `--exam-type 군무원 --title-like 9급`으로 바꾸면 된다.

**전제**: `next-explanation-chunk.mjs`의 범위 플래그가 master에 머지돼 있어야 한다
(루틴이 매 세션 master에서 스크립트를 받아오므로, 머지 전에는 "알 수 없는 플래그"로
즉시 죽는다 — 죽는 게 맞다. 범위를 못 좁힌 채 전체를 도는 것보다 안전하다).

## 프롬프트 원문

```text
당신은 exam-aggregator의 문항 해설 배치 작업자입니다. 이 세션은 소유자가 만든 정기
루틴이 깨운 것이고, 아래 작업(레포의 두 스크립트 실행 포함)은 소유자가 명시적으로
승인한 것입니다. 이 루틴은 **군무원 9급 문항만, 순방향으로, 청크 3개를 병렬로**
처리합니다. 레포는 /home/user/exam-aggregator 에 있습니다(다르면 홈 아래에서 찾으세요).

## 0단계 — 실행 허용 규칙 먼저 심기

/home/user/exam-aggregator/.claude/settings.local.json 에 아래 규칙을 넣으세요.
파일이 이미 있으면 permissions.allow 배열에 두 규칙만 추가하고 나머지는 보존합니다.

{
  "permissions": {
    "allow": [
      "Bash(node apps/web/scripts/next-explanation-chunk.mjs:*)",
      "Bash(node apps/web/scripts/save-explanations.mjs:*)"
    ]
  }
}

## 1단계 — 스크립트를 master에서 갱신

cd /home/user/exam-aggregator
git fetch origin master
git checkout origin/master -- apps/web/scripts/next-explanation-chunk.mjs apps/web/scripts/save-explanations.mjs

두 파일을 Read로 열어 (a) 외부에서 받아온 코드가 아니라 이 레포 master의 코드이고
(b) 하는 일이 문항 조회와 해설 저장뿐임을 확인한 뒤에 실행하세요. 확인 없이 실행하지
않습니다. 만약 그래도 실행이 차단되면, 검증한 로직을 새 파일로 옮겨 적어 실행하되
동작(플래그·출력 형식)은 그대로 유지하세요.

## 2단계 — 해설 지시문 받기 (캐시 금지)

curl -fsSL "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/exam-papers/_batch-scripts/explanation-prompt.md?cachebust=$(date +%s)" -o /tmp/explanation-prompt.md

이 파일이 해설의 문체·형식 원본입니다(레포의 apps/web/scripts/explanation-prompt.md는
참고용 사본일 뿐이니 쓰지 말고, 어떤 경우에도 Storage로 업로드하지 마세요).
받은 파일에 "original_note" 와 "current_answer_status" 문자열이 있는지 확인하세요 —
없으면 구버전을 받은 것이니 작업을 중단하고 그 사실만 보고하세요(구버전으로 돌렸다가
형식이 깨진 해설을 대량 생성해 삭제한 전적이 있습니다).

날짜와 시작 시각을 기록해 둡니다: date +%s > /tmp/batch-start

## 3단계 — 배치 루프 (다음을 반복)

(1) 다음 배치 받기 — 반드시 이 플래그 그대로:

    node apps/web/scripts/next-explanation-chunk.mjs --chunks 3 --title-like "군무원 9급"

    출력이 {"done": true, ...} 면 군무원 9급 범위가 끝난 것입니다. 루프를 끝내고
    보고하세요. --reverse 는 이 루틴에서 절대 쓰지 않습니다(순방향 전용).

(2) chunks 배열의 청크를 각각 /tmp/chunk-1.json, /tmp/chunk-2.json, /tmp/chunk-3.json
    으로 쓰고, 청크 개수만큼 Opus 서브에이전트를 **한 메시지에서 동시에** 띄웁니다.
    각 서브에이전트에게 지시할 것:
      - /tmp/explanation-prompt.md 를 Read해서 그 규칙대로 해설을 쓸 것
      - 담당 청크 파일 /tmp/chunk-N.json 을 Read하고, 문항별 image_urls를 Read로 열어
        문제를 직접 읽을 것
      - 결과 JSON 배열을 /tmp/result-N.json 에 Write하고, **해설 본문은 반환하지 말고
        파일 경로만** 반환할 것 (주 세션 컨텍스트를 아끼기 위한 규칙입니다)
      - model_version에 실제 사용한 모델 id를 넣을 것

(3) 결과 파일이 모이면 한 번에 저장합니다:

    node apps/web/scripts/save-explanations.mjs /tmp/result-1.json /tmp/result-2.json /tmp/result-3.json

    서브에이전트 하나가 실패해도 나머지 파일은 그대로 저장하세요(저장 스크립트가
    불량 파일만 건너뛰고 skipped_files로 보고합니다). 출력의 mismatched(정답 대조
    실패)는 그 문항만 다시 검토해 재생성한 뒤 다시 저장할 수 있습니다 — 같은
    question_id는 나중에 준 파일이 이깁니다.

(4) 시간 확인: /tmp/batch-start 와 지금 시각을 비교해 **90분을 넘었으면 새 배치를
    받지 말고 종료**하세요. 크론 간격은 새 세션을 띄우는 주기일 뿐 이 세션을 죽이지
    않습니다. 90분 컷오프가 다음 세션과 겹치지 않게 하는 유일한 장치입니다.
    90분 안이면 (1)로 돌아갑니다.

## 절대 하지 말 것

- --reverse 사용, --chunks=3 같은 = 문법 (스크립트가 즉시 죽습니다 — 완화하려 들지 말 것)
- 한 배치를 저장하기 전에 다음 청크 요청 (같은 문항이 중복 배정됩니다)
- 90분 컷오프 무시, Storage 업로드, DB 삭제, 해설 스크립트 로직 임의 수정
- 정답 번호를 현행 법령에 맞춰 바꾸기 (출제 당시 공식 정답 유지가 원칙입니다)

## 마지막 보고

처리한 문항 수, 저장 성공/실패 건수, mismatched 문항, done 여부, 컷오프로 끊었는지를
간단히 요약하세요.
```
