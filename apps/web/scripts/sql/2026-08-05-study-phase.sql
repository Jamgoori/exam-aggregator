-- 학습 국면(확장기/정착기) 저장 (2026-08-05)
--
-- 이 서비스는 편차가 아주 큰 사용자를 한 화면으로 받는다. 1회독 30점에 하루 2장을
-- 푸는 사람에게 오답은 "아직 안 배운 범위"이고, 95점인 사람에게 오답은 "진짜 약점"이다.
-- 전자에게 "남은 오답 470"과 "오늘 복습 20문항"을 보여주면 8개월치 부채 통지서가 된다
-- (2026-08-04 시뮬레이션: 하루 40개씩 틀리는 속도에서 상한 20으로는 산술적으로 못
-- 따라잡는다). 그래서 국면을 감지해 헤드라인 숫자와 오늘 카드 CTA를 갈라준다.
--
-- 판정 규칙 정본: packages/core/src/study-phase.ts (웹·모바일 공유, 순수 계산).
-- 재료 조회: apps/web/src/lib/study-phase.ts.
--
-- 왜 저장하는가 — 히스테리시스 때문이다. 진입(유입비 2.5 초과)과 이탈(1.5 미만)
-- 임계가 다른데, 직전 국면을 모르면 사이 구간(1.5~2.5)의 사용자를 매번 새로
-- 판정하게 되어 헤드라인과 CTA가 날마다 뒤집힌다. 사용자는 그걸 고장으로 읽는다.
--
-- 쓰기 정책을 닫지 않는 이유: 이 테이블은 표시 설정만 담는다(schema.sql 주석 참조).
-- 국면도 화면 모드일 뿐이라 사용자가 위조해도 자기 헤드라인이 바뀌는 것 말고는
-- 얻을 게 없다. 실제 복습일(user_question_status.srs_due_at)은 여전히 서버만 쓴다.
--
-- 쓰기는 국면이 바뀐 순간에만 한다(읽을 때마다 쓰지 않는다). study_phase_at은
-- 전환 안내를 한 번만 띄우기 위한 시각이다.
--
-- 적용: Supabase SQL Editor에서 실행. 기존 행은 null로 남고, 다음 판정에서
-- 이력 없음(첫 판정 = 단일 임계 2.0)으로 처리된 뒤 채워진다.

alter table review_preferences add column if not exists study_phase text;
alter table review_preferences add column if not exists study_phase_at timestamptz;

-- 값을 두 개로 못 박는다. 모드가 셋이 되는 순간 사용자도 우리도 어느 모드인지
-- 헷갈리기 시작한다 — 이원화의 핵심 제약이라 스키마에서 막는다.
do $$
begin
  alter table review_preferences
    add constraint review_preferences_study_phase_check
    check (study_phase is null or study_phase in ('expanding', 'settling'));
exception
  when duplicate_object then null;
end $$;
