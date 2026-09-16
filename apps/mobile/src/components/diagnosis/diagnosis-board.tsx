import type {
  DiagnosisAggregateResponse,
  DiagnosisBoardConcept,
  DiagnosisBoardSubjectGroup,
  DiagnosisConceptCoaching,
} from "@gongmoa/core";
import { nextDiagnosisDate } from "@gongmoa/core";
import { BarChart3, Flame } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { DiagnosisCoachingResults } from "./diagnosis-coaching";
import { DiagnosisConceptPicker } from "./diagnosis-concept-picker";
import { DiagnosisGeneratingCard, type DiagnosisGenerating } from "./diagnosis-generating";
import { AppText } from "../app-text";
import { hapticSelect } from "../../lib/haptics";
import type { DiagnosisCycleRow } from "../../queries/diagnosis";
import { themedIcon } from "../../theme/icons";

// 진단 대시보드의 본문(웹 diagnosis-board.tsx 1:1): 과목 탭 → 틀린 개념 막대그래프 → 맞춤
// 극복법(선택창 또는 결과). 앱은 언제나 좁은 화면이라(§4.4) 웹의 한 열 레이아웃을 그대로 쓴다.
//
// 과목 필터는 여기서 배열을 거르는 것으로 끝난다(즉시). 웹도 같은 이유로 서버 왕복을 버렸다 —
// 과목 칩이 링크였을 때는 한 번 누를 때마다 계정 전체 오답을 훑는 집계가 다시 돌았다. 기간 칩만
// 다른 데이터라 다시 받아 온다(앱은 쿼리 키가 갈린다).

// 과목별 막대 개수. 한 과목만 골라 봤을 때는 그 과목을 깊게 보려는 것이므로 더 세운다.
const BARS_PER_SUBJECT = 6;
const BARS_WHEN_FOCUSED = 20;

const BarChartIcon = themedIcon(BarChart3);
const FlameIcon = themedIcon(Flame);

export type DiagnosisRangeChoice = { key: string; label: string };

export function DiagnosisBoard({
  board,
  ranges,
  rangeKey,
  onChangeRange,
  // 과목 필터. 상태를 화면이 들고 있는 이유는 기간 칩을 누르면 집계가 다시 로딩되면서 이
  // 컴포넌트가 잠깐 스켈레톤으로 바뀌기 때문이다 — 여기서 들고 있으면 그때 선택이 풀린다
  // (웹은 기간 링크에 ?subject 를 실어 같은 것을 지킨다).
  subject,
  onChangeSubject,
  // 이미 만들어진 맞춤 극복법과 그것을 받은 날(ai_diagnoses.report — 메모리 전용).
  coaching,
  coachingDate,
  // 이번 주기 요청 행(`ai_diagnoses` RLS 조회). 있으면 이번 주기는 이미 썼다(pending 이면
  // 기다리는 중). 아직 못 읽었으면 cycleLoaded 가 false 고, 그때는 집계가 실어 준 주기 상태를 쓴다.
  cycle,
  cycleLoaded,
  // 지금 배치가 도는 중이면 그 요청 시각과 개념 수(집계 응답). 앱은 `ai_diagnosis_batches` 를
  // 못 읽으므로 이 값이 없을 때는 요청 행으로 근사한다.
  generating,
  polling,
}: {
  board: DiagnosisAggregateResponse;
  ranges: DiagnosisRangeChoice[];
  rangeKey: string;
  onChangeRange: (key: string) => void;
  subject: string | null;
  onChangeSubject: (slug: string | null) => void;
  coaching: DiagnosisConceptCoaching[];
  coachingDate: string | null;
  cycle: DiagnosisCycleRow | null;
  cycleLoaded: boolean;
  generating: DiagnosisGenerating | null;
  polling: boolean;
}) {
  const shownGroups = subject
    ? board.bySubject.filter((g) => g.subjectSlug === subject)
    : board.bySubject;
  const maxWrong = Math.max(1, ...board.bySubject.flatMap((g) => g.concepts.map((c) => c.wrongCount)));
  const subjectName = board.subjects.find((s) => s.slug === subject)?.name ?? null;

  // 주기 상태는 두 곳에서 온다. 정본은 요청 행(cycle)이고 — 요청 직후 그쪽만 다시 읽기 때문이다 —
  // 그걸 아직 못 읽었을 때만 집계가 실어 준 값으로 떨어진다. 둘은 같은 행을 본다.
  const requestedThisCycle = cycleLoaded ? cycle != null : board.cycle.requestedThisCycle;
  const nextDate = cycle ? nextDiagnosisDate(cycle.date) : board.cycle.nextDate;

  // 대기 카드에 실을 값. 배치 정보(generating)가 정확하지만 그건 크론이 요청을 집어 배치를
  // 만든 뒤에야 생긴다 — 앱은 요청과 제출 사이가 최대 한 시간이라(diagnosis-generating.tsx
  // 머리말) 그 사이를 요청 행으로 메운다. 둘 다 없으면 대기 중이 아니다.
  const waiting: DiagnosisGenerating | null =
    generating ??
    (cycle?.status === "pending"
      ? { requestedAt: cycle.requestedAt, conceptCount: cycle.conceptCount }
      : null);

  // 선택창은 **이번 주기 요청 행이 없을 때만** 그린다. 서버(picker)는 웹과 같은 조건으로 판정
  // 하는데(주기 미사용 ∧ 배치 없음 ∧ 최근 7일 오답 ∧ 자격), 웹은 버튼을 누른 그 자리에서
  // 배치를 만들어 선택창이 즉시 닫히는 반면 앱은 크론이 집을 때까지 배치가 없어 선택창이 계속
  // 열려 있게 된다 — 대기 카드 옆에 선택창이 남으면 같은 진단을 두 번 요청하게 된다.
  // 웹이 이 자리에 남겨 둔 "pending 으로 실패한 요청 재시도"는 앱에 필요 없다: 제출은 크론이
  // 매시간 다시 시도하고, 다시 눌러 봐야 고른 개념만 갈릴 뿐 제출을 앞당기지 못한다.
  const picker = requestedThisCycle ? null : board.picker;

  return (
    <View className="gap-6">
      {/* 과목 탭. 그래프와 극복법 결과가 함께 좁혀진다 — 한 과목만 파고들 때 화면 전체가 그
          과목이 되는 편이, 위는 좁고 아래는 전 과목인 것보다 읽기 쉽다. */}
      {board.subjects.length > 1 && (
        <View className="flex-row flex-wrap gap-1.5 px-1">
          <BoardChip
            active={subject == null}
            onPress={() => onChangeSubject(null)}
          >
            전체 과목
          </BoardChip>
          {board.subjects.map((s) => (
            <BoardChip
              key={s.slug}
              active={subject === s.slug}
              onPress={() => onChangeSubject(s.slug)}
            >
              {s.name}
            </BoardChip>
          ))}
        </View>
      )}

      {/* A. 과목별 틀린 개념 막대그래프 */}
      <View className="rounded-2xl border border-zinc-100 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <View className="flex-row items-center gap-1.5 px-1">
          <BarChartIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
          <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            {rangeLabel(board.window.days)} 틀린 개념
          </AppText>
        </View>
        <AppText variant="xs" className="mt-1 px-1 text-zinc-500 dark:text-zinc-500" pretty>
          {board.window.widened
            ? "선택한 기간에 푼 문제가 없어 기간을 넓혔어요."
            : "막대가 길수록 그 개념에서 더 많이 틀렸어요."}
        </AppText>
        <View className="mt-3 flex-row gap-1.5 px-1">
          {ranges.map((r) => (
            <BoardChip key={r.key} active={r.key === rangeKey} onPress={() => onChangeRange(r.key)}>
              {r.label}
            </BoardChip>
          ))}
        </View>
        <View className="mt-4 gap-5">
          {shownGroups.length === 0 ? (
            <AppText variant="sm" className="px-1 text-zinc-500 dark:text-zinc-400" pretty>
              {subjectName
                ? `${rangeLabel(board.window.days)} ${subjectName}에서 틀린 문제가 없어요.`
                : "이 기간에 틀린 문제가 없어요."}
            </AppText>
          ) : (
            shownGroups.map((g) => (
              <SubjectBars
                key={g.subjectSlug ?? g.subject}
                group={g}
                maxWrong={maxWrong}
                limit={subject ? BARS_WHEN_FOCUSED : BARS_PER_SUBJECT}
              />
            ))
          )}
        </View>
      </View>

      {/* B. 맞춤 극복법 — 선택창(아직 안 받았으면) 또는 고른 개념의 진단 결과. */}
      <View className="gap-3">
        <View className="flex-row items-center gap-1.5 px-1">
          <FlameIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
          <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            맞춤 극복법
          </AppText>
        </View>
        {waiting && <DiagnosisGeneratingCard generating={waiting} polling={polling} />}
        {picker && picker.length > 0 && (
          <DiagnosisConceptPicker concepts={picker} analysisDays={board.analysisDays} />
        )}
        {coaching.length > 0 && coachingDate && (
          <AppText variant="xs" className="px-1 text-zinc-400 dark:text-zinc-600" pretty>
            {formatMonthDay(coachingDate)}에 고른 {coaching.length}개 개념의 진단이에요.
          </AppText>
        )}
        <DiagnosisCoachingResults coaching={coaching} subject={subject} concepts={board.concepts} />
        {/* 고를 것도 보여줄 것도 없는 상태. 주기를 이미 쓴 쪽은 웹에서 거의 안 나오지만(완료
            리포트에는 극복법이 따라온다) 앱은 그 상태에서도 "왜 선택창이 없는지"를 말해야 한다 —
            서버는 200 + 주기 잠금을 주는데 화면이 아무 말도 없으면 고장으로 읽힌다. */}
        {!picker && coaching.length === 0 && waiting == null && (
          <AppText variant="xs" className="px-1 text-zinc-400 dark:text-zinc-600" pretty>
            {requestedThisCycle && nextDate
              ? `이번 주기 진단은 이미 받았어요. 다음 진단은 ${formatMonthDay(nextDate)}부터 받을 수 있어요.`
              : `최근 ${board.analysisDays}일 안에 틀린 문제가 쌓이면 여기서 개념을 골라 극복법을 받을 수 있어요.`}
          </AppText>
        )}
      </View>

      <AppText variant="xs" className="px-1 text-center text-zinc-400 dark:text-zinc-600" pretty>
        그래프는 {rangeLabel(board.window.days)} 오답 기록이에요. 맞춤 극복법은 주 1회, 최근{" "}
        {board.analysisDays}일 안에 틀린 문제에서 고른 개념을 분석해요.
        {coaching.length > 0 && nextDate ? ` 다음 진단은 ${formatMonthDay(nextDate)}부터.` : ""}
      </AppText>
    </View>
  );
}

function rangeLabel(days: number | null): string {
  if (days == null) return "전체 기간";
  return `최근 ${days}일`;
}

// "2026-08-31" → "8월 31일". 주기 안내에 쓴다.
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 대시보드 칩(웹 `rounded-full px-2.5 py-1 text-xs font-semibold`). 공용 Chip 보다 작다 —
// 카드 안에 과목이 여러 줄로 서는 자리라 공용 규격을 쓰면 카드가 칩으로 가득 찬다.
function BoardChip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      className={[
        "rounded-full px-2.5 py-1",
        active ? "bg-blue-600" : "bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700",
      ].join(" ")}
    >
      <AppText
        variant="xs"
        weight="semibold"
        className={active ? "text-white" : "text-zinc-600 dark:text-zinc-300"}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

// 한 과목 그룹의 개념 막대들. 개념이 많으면 상위만 보이고 나머지는 접는다.
function SubjectBars({
  group,
  maxWrong,
  limit,
}: {
  group: DiagnosisBoardSubjectGroup;
  maxWrong: number;
  limit: number;
}) {
  const shown = group.concepts.slice(0, limit);
  const hidden = group.concepts.length - shown.length;
  return (
    <View>
      <View className="mb-2 flex-row items-baseline justify-between px-1">
        <AppText variant="sm" weight="bold" className="min-w-0 flex-1">
          {group.subject}
        </AppText>
        <AppText variant="xs" tabular className="shrink-0 text-zinc-400 dark:text-zinc-500">
          {group.totalWrong}문항 틀림
        </AppText>
      </View>
      <View className="gap-1.5">
        {shown.map((c, i) => (
          <ConceptBar key={`${c.concept}-${i}`} concept={c} maxWrong={maxWrong} />
        ))}
      </View>
      {hidden > 0 && (
        <AppText variant="xs" className="mt-1.5 px-1 text-zinc-400 dark:text-zinc-600">
          외 {hidden}개 개념
        </AppText>
      )}
    </View>
  );
}

// 개념 막대 하나. 라벨을 막대 위에 두는 건 개념 이름이 길기 때문이다 — 좌측 고정폭에 넣으면
// "글의 내용과 일치·불일치 판단"이 "글의 내용과 일치…"로 잘려 정작 알아야 할 정보가 사라진다.
// 막대는 이 기간에 틀린 문항 수만 나타낸다(극복 여부는 세지 않는다).
function ConceptBar({ concept, maxWrong }: { concept: DiagnosisBoardConcept; maxWrong: number }) {
  const pct = Math.max(4, Math.round((concept.wrongCount / maxWrong) * 100));
  return (
    <View>
      <View className="mb-1 flex-row items-baseline justify-between gap-2">
        <AppText variant="13" className="min-w-0 flex-1 leading-snug text-zinc-700 dark:text-zinc-300" pretty>
          {concept.concept}
        </AppText>
        <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-500">
          <AppText variant="sm" weight="bold" tabular className="text-blue-600 dark:text-blue-400">
            {concept.wrongCount}
          </AppText>
          문항
          {concept.accuracyPct != null ? ` · 정답률 ${concept.accuracyPct}%` : ""}
          {concept.scoreGainPct != null && concept.scoreGainPct >= 0.5 ? ` · +${concept.scoreGainPct}점` : ""}
        </AppText>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <View className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}
