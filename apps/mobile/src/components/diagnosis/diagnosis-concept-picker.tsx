import { COACH_MAX_TOTAL, DIAGNOSIS_CYCLE_DAYS, type DiagnosisPickerConcept } from "@gongmoa/core";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { handleEdgeError } from "../../lib/edge";
import { hapticSelect } from "../../lib/haptics";
import { useRequestDiagnosis } from "../../queries/diagnosis";
import { palette } from "../../theme";

// 개념 선택창 + 생성 버튼(웹 diagnosis-actions.tsx DiagnosisConceptPicker 1:1).
//
// 예전에는 과목만 고르면 AI가 그 안에서 상위 개념을 알아서 집었다. 그런데 "많이 틀린 개념"과
// "지금 잡고 싶은 개념"은 다르다 — 시험이 코앞인 과목, 이미 버린 단원이 사람마다 다르기
// 때문이다. 개념 수가 곧 요금이라 그 {COACH_MAX_TOTAL}칸을 누가 정하느냐가 곧 이 기능의
// 값어치다. 그래서 체크박스로 사용자가 직접 정한다.
//
// 처음부터 빈 체크박스로 두지는 않는다. 아무것도 안 골라 둔 화면은 "고르는 일"부터 시키는
// 화면이라 대부분 그냥 나간다 — 추천(서버 pickCoachTargets = 자동 선정과 같은 규칙)을 미리
// 체크해 두고 손보게 한다. 그대로 눌러도 자동 선정과 같은 결과가 나온다.
//
// 상한(COACH_MAX_TOTAL)·중복 제거는 서버가 다시 한다(core normalizeConceptSelection). 여기서
// 막는 것은 "고를 수 있게 해 놓고 나중에 잘라 내지 않기" 위해서다.

// 접기 전 보여줄 개념 줄 수. 웹은 목록을 `max-h-96` 스크롤 상자에 넣지만, RN 에서 세로
// ScrollView 를 화면 스크롤 안에 겹치면 제스처가 서로를 먹는다 — 같은 목적(카드가 화면을
// 통째로 밀어내 아래 지난 진단으로 가는 길이 멀어지지 않게)을 접기로 이룬다.
const COLLAPSED_ROWS = 8;

// 웹 선택창에는 "이번 주기는 M/D까지예요" 한 마디가 더 붙는다(요청이 pending 으로 남았을 때
// 선택창과 주기 안내가 함께 뜨는 상태가 웹에는 있다). 앱은 요청 행이 생기는 순간 선택창을 닫고
// 대기 카드로 바꾸므로(diagnosis-board.tsx picker 주석) 그 자리가 없어 옮기지 않았다 — 주기
// 안내는 대기 카드와 아래 문단이 한다.
export function DiagnosisConceptPicker({
  concepts,
  // 극복법이 실제로 훑는 기간(일). 그래프 기간과 다를 수 있어 여기서 밝혀 준다.
  analysisDays,
}: {
  concepts: DiagnosisPickerConcept[];
  analysisDays: number;
}) {
  const recommended = concepts.filter((c) => c.recommended).map((c) => c.key);
  const [selected, setSelected] = useState<Set<string>>(new Set(recommended));
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 선택창의 과목 탭. 위쪽 대시보드의 과목 탭과 따로 논다 — "그래프는 국어를 보면서 극복법은
  // 전 과목에서 고르는" 것이 자연스럽고, 반대로 묶어 두면 그래프를 좁혔다는 이유로 고를 수
  // 있는 개념이 조용히 사라진다.
  const [tab, setTab] = useState<string | null>(null);
  // 요청이 받아들여진 뒤 화면이 대기 카드로 바뀌기까지는 요청 행을 다시 읽는 한 박자가 있다.
  // 그동안 버튼이 되살아나면 같은 진단을 두 번 누른다 — 이 컴포넌트가 사라질 때까지 잠가 둔다.
  const [submitted, setSubmitted] = useState(false);
  const request = useRequestDiagnosis();

  const pending = request.isPending || submitted;
  const full = selected.size >= COACH_MAX_TOTAL;

  function toggle(key: string) {
    if (pending) return;
    hapticSelect();
    setConfirming(false);
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      // 상한은 체크박스가 직접 막는다 — 20개를 고르게 해 놓고 나중에 "10개만 됐어요" 라고
      // 말하면, 잘려 나간 10개를 사용자가 고른 줄 알고 기다리게 된다.
      else if (next.size < COACH_MAX_TOTAL) next.add(key);
      return next;
    });
  }

  async function go() {
    if (pending || selected.size === 0) return;
    setError(null);
    const picked = concepts
      .filter((c) => selected.has(c.key))
      .map((c) => ({ conceptId: c.conceptId, concept: c.concept }));
    try {
      // ready(이번 주기 리포트가 이미 있다)든 pending(요청 행이 생겼다)든 할 일은 같다 —
      // 요청 행이 캐시에 들어오면(훅의 무효화) 화면이 스스로 선택창을 닫고 대기 카드나 지난
      // 진단으로 바뀐다. 여기서 따로 말할 것이 없다.
      await request.mutateAsync(picked);
      setSubmitted(true);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: "/mypage/diagnosis" });
      setConfirming(false);
      if (handled.redirected) return;
      setError(handled.message || "극복법 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  // 과목 탭 목록. 개념이 있는 과목만 세운다(고를 것이 없는 탭은 만들지 않는다).
  const tabs: { slug: string; name: string }[] = [];
  for (const c of concepts) {
    const slug = c.subjectSlug ?? "";
    if (tabs.some((t) => t.slug === slug)) continue;
    tabs.push({ slug, name: c.subject ?? "기타" });
  }

  const visible = tab == null ? concepts : concepts.filter((c) => (c.subjectSlug ?? "") === tab);
  // 지금 탭에 안 보이지만 이미 골라 둔 개수. 탭을 옮겨 다니며 고르면 "왜 3개라고 하지"가
  // 되므로 밝혀 준다.
  const hiddenSelected = concepts.filter(
    (c) => selected.has(c.key) && !visible.some((v) => v.key === c.key),
  ).length;

  // 접힌 상태에서는 앞에서부터 COLLAPSED_ROWS 줄만. 순서는 받은 그대로(많이 틀린 순)다.
  const shown = expanded ? visible : visible.slice(0, COLLAPSED_ROWS);
  const foldedAway = visible.length - shown.length;

  // 과목별로 묶되 순서는 받은 그대로를 따른다.
  const groups: { subject: string; items: DiagnosisPickerConcept[] }[] = [];
  for (const c of shown) {
    const name = c.subject ?? "기타";
    const g = groups.find((x) => x.subject === name);
    if (g) g.items.push(c);
    else groups.push({ subject: name, items: [c] });
  }

  return (
    <View className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900/50 dark:bg-violet-950/20">
      <View className="flex-row items-center gap-1.5">
        <AppText variant="sm" weight="bold" className="text-violet-900 dark:text-violet-200">
          맞춤 극복법
        </AppText>
        <View className="rounded-full bg-violet-600 px-1.5 py-0.5">
          <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white">
            주 1회
          </AppText>
        </View>
      </View>
      {/* 마지막 한 마디만 웹과 다르다. 웹은 "보통 5~10분"이라고 적는데 그건 버튼을 누른 그
          자리에서 배치를 제출하기 때문이고, 앱 요청은 크론이 집어 갈 때까지 기다린다
          (diagnosis-generating.tsx 머리말 — 소유자 결정 대기). 나머지 문장은 웹 그대로다. */}
      <AppText variant="xs" className="mt-1 leading-relaxed text-violet-700/80 dark:text-violet-300/70" pretty>
        고른 개념마다 <AppText variant="xs" weight="bold" className="text-violet-700/80 dark:text-violet-300/70">내가 실제로 고른 오답</AppText>을 하나씩 짚어 왜 그렇게 골랐는지
        분석하고, 오늘부터의 극복 계획과 시험장 체크리스트까지 만들어드려요.{" "}
        <AppText variant="xs" weight="bold" className="text-violet-700/80 dark:text-violet-300/70">한 번에 {COACH_MAX_TOTAL}개까지</AppText> 고를 수 있고, 최근 {analysisDays}일 안에 틀린
        문제에서 고른 개념만 분석해요. 만드는 데 시간이 걸려요(최대 두 시간) — 다 되면 이 화면에
        나타나요.
      </AppText>

      {/* 과목 탭: 고를 개념이 여러 과목에 걸쳐 있으면 목록이 길어져 스크롤로만 찾게 된다.
          준비 중인 과목부터 고르는 사람이 대부분이라 탭이 곧 "지금 급한 과목"이다. */}
      {tabs.length > 1 && (
        <View className="mt-2.5 flex-row flex-wrap gap-1.5">
          <PickerTab active={tab == null} onPress={() => setTab(null)}>
            전체 과목
          </PickerTab>
          {tabs.map((t) => (
            <PickerTab key={t.slug} active={tab === t.slug} onPress={() => setTab(t.slug)}>
              {t.name}
            </PickerTab>
          ))}
        </View>
      )}

      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
        <SmallAction
          disabled={pending}
          tone="violet"
          label={`추천 ${recommended.length}개로 되돌리기`}
          onPress={() => {
            setSelected(new Set(recommended));
            setConfirming(false);
          }}
        />
        <SmallAction
          disabled={pending}
          tone="zinc"
          label="전체 과목 해제"
          onPress={() => {
            setSelected(new Set());
            setConfirming(false);
          }}
        />
      </View>

      <View className="mt-2.5 rounded-lg bg-white/70 p-1 dark:bg-zinc-900/50">
        {groups.map((g) => (
          <View key={g.subject} className="mb-1">
            <AppText
              variant="11"
              weight="bold"
              className="px-2 pb-1 pt-1.5 text-violet-700/70 dark:text-violet-300/60"
            >
              {g.subject}
            </AppText>
            {g.items.map((c) => (
              <ConceptRow
                key={c.key}
                concept={c}
                checked={selected.has(c.key)}
                disabled={pending || (!selected.has(c.key) && full)}
                onPress={() => toggle(c.key)}
              />
            ))}
          </View>
        ))}
        {(foldedAway > 0 || expanded) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded((v) => !v)}
            className="items-center rounded-lg py-2 active:bg-violet-100/70 dark:active:bg-violet-900/20"
          >
            <AppText variant="11" weight="bold" className="text-violet-700 dark:text-violet-300">
              {expanded ? "접기" : `개념 ${foldedAway}개 더 보기`}
            </AppText>
          </Pressable>
        )}
      </View>

      <AppText variant="xs" className="mt-2 text-violet-700/60 dark:text-violet-300/50" pretty>
        {selected.size === 0
          ? "개념을 하나 이상 골라주세요."
          : `${selected.size}/${COACH_MAX_TOTAL}개 선택${full ? " (상한이에요)" : ""}`}
        {tab != null && hiddenSelected > 0 ? ` · 다른 과목에서 고른 ${hiddenSelected}개 포함` : ""}
      </AppText>

      {error && (
        <AppText variant="xs" className="mt-1.5 text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      {/* 주 1회라 되돌릴 수 없다 — 누르기 전에 한 번 되묻는다. 별도 모달(시트)을 띄우지 않는
          이유는 고른 목록이 바로 위에 보여야 확인이 의미가 있기 때문이다. */}
      {confirming ? (
        <View className="mt-2.5 rounded-xl border border-violet-300 bg-white px-3 py-2.5 dark:border-violet-800 dark:bg-zinc-900">
          <AppText variant="xs" className="leading-relaxed text-zinc-600 dark:text-zinc-300" pretty>
            고른 <AppText variant="xs" weight="bold" className="text-zinc-600 dark:text-zinc-300">{selected.size}개 개념</AppText>으로 만들어요. 이번 주기({DIAGNOSIS_CYCLE_DAYS}일)에는 다시
            만들 수 없어요.
          </AppText>
          <View className="mt-2 flex-row gap-2">
            <Button
              variant="outline"
              label="더 고를게요"
              disabled={pending}
              onPress={() => setConfirming(false)}
              className="flex-1 rounded-lg bg-zinc-100 dark:bg-zinc-800"
            />
            <Button
              label={pending ? "요청하는 중이에요…" : "이대로 만들기"}
              pending={pending}
              onPress={() => void go()}
              className="flex-[2] rounded-lg bg-violet-600 active:bg-violet-700"
            />
          </View>
        </View>
      ) : (
        <Button
          label={`고른 ${selected.size}개 개념으로 극복법 받기`}
          disabled={pending || selected.size === 0}
          onPress={() => setConfirming(true)}
          className="mt-2.5 bg-violet-600 active:bg-violet-700"
        />
      )}
    </View>
  );
}

// 체크박스 한 줄. 체크박스는 고를 근거(몇 문항 틀림·정답률·예상 점수)가 같이 보일 때만 의미가
// 있다 — 개념 이름만 스무 개 늘어놓으면 무엇을 고를지 알 수 없다.
function ConceptRow({
  concept: c,
  checked,
  disabled,
  onPress,
}: {
  concept: DiagnosisPickerConcept;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={c.concept}
      disabled={disabled}
      onPress={onPress}
      className={[
        "flex-row items-start gap-2 rounded-lg px-2 py-1.5",
        checked ? "bg-violet-100/70 dark:bg-violet-900/20" : "active:bg-zinc-50 dark:active:bg-zinc-800/50",
        disabled && !checked ? "opacity-50" : "",
      ].join(" ")}
    >
      <View
        className={[
          "mt-0.5 h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked ? "border-violet-600 bg-violet-600" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900",
        ].join(" ")}
      >
        {checked && <Check size={12} color={palette.white} strokeWidth={3} />}
      </View>
      <View className="min-w-0 flex-1">
        <AppText variant="13" weight="semibold" className="leading-snug text-zinc-800 dark:text-zinc-200" pretty>
          {c.concept}
        </AppText>
        <AppText variant="11" className="text-zinc-500 dark:text-zinc-500">
          {c.wrongCount}문항 틀림
          {c.accuracyPct != null ? ` · 정답률 ${c.accuracyPct}%` : ""}
          {c.scoreGainPct != null && c.scoreGainPct >= 0.5 ? ` · 잡으면 +${c.scoreGainPct}점` : ""}
        </AppText>
      </View>
    </Pressable>
  );
}

// 선택창 안의 과목 탭 하나. 위 대시보드 칩과 색이 다른 건 여기가 보라색(극복법) 카드 안이라서다 —
// 같은 파란 칩을 쓰면 카드 밖 그래프 칩과 헷갈린다.
function PickerTab({
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
        active
          ? "bg-violet-600"
          : "bg-white active:bg-violet-100 dark:bg-zinc-900 dark:active:bg-violet-950/40",
      ].join(" ")}
    >
      <AppText
        variant="11"
        weight="bold"
        className={active ? "text-white" : "text-violet-700 dark:text-violet-300"}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

// "추천 N개로 되돌리기"·"전체 과목 해제" 알약 버튼(웹 ring-1 알약).
function SmallAction({
  label,
  tone,
  disabled,
  onPress,
}: {
  label: string;
  tone: "violet" | "zinc";
  disabled: boolean;
  onPress: () => void;
}) {
  const box =
    tone === "violet"
      ? "border-violet-200 active:bg-violet-100 dark:border-violet-900/60"
      : "border-zinc-200 active:bg-zinc-100 dark:border-zinc-700";
  const text = tone === "violet" ? "text-violet-700 dark:text-violet-300" : "text-zinc-500 dark:text-zinc-400";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={["rounded-full border bg-white px-2.5 py-1 dark:bg-zinc-900", box, disabled ? "opacity-60" : ""].join(" ")}
    >
      <AppText variant="11" weight="bold" className={text}>
        {label}
      </AppText>
    </Pressable>
  );
}
