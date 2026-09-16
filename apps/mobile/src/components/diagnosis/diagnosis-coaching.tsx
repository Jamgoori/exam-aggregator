import type { DiagnosisBoardConcept, DiagnosisConceptCoaching } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BookOpen, Check, Lightbulb, Target } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { handleEdgeError } from "../../lib/edge";
import { useCreateConceptReview } from "../../queries/diagnosis";
import { themedIcon } from "../../theme/icons";

// 고른 개념의 진단 결과(웹 diagnosis-board.tsx CoachingResults·CoachingCard 1:1).
//
// 예전에는 이 자리에 "많이 틀린 개념 TOP 8" 카드가 순위대로 서 있었는데, 그건 바로 위
// 막대그래프가 이미 말한 것을 한 번 더 늘어놓은 것이라 정작 극복법이 아래로 밀렸다. 이 공간은
// **고른 개념의 진단**만 쓴다.
//
// 본문은 `ai_diagnoses.report` 를 RLS 로 읽은 값이다 — 메모리 쿼리캐시에만 있고(queries/
// diagnosis.ts `meta.persist:false`) 화면을 떠나 앱을 재시작하면 사라진다(§6.5 (5)).

// 같은개념 기출 풀기를 열어줄 최소 코퍼스 문항 수(너무 적으면 연습 가치가 약함).
const MIN_CORPUS_FOR_SOLVE = 2;

const BulbIcon = themedIcon(Lightbulb);
const TargetIcon = themedIcon(Target);
const CheckIcon = themedIcon(Check);
const BookIcon = themedIcon(BookOpen);

export function DiagnosisCoachingResults({
  coaching,
  // 과목 탭이 걸려 있으면 그 과목 것만 남는다(그래프와 함께 좁혀진다).
  subject,
  // 극복법 카드에 숫자(몇 문항 틀림·정답률·기출 수)를 붙일 때 쓰는 조회용 목록.
  concepts,
}: {
  coaching: DiagnosisConceptCoaching[];
  subject: string | null;
  concepts: DiagnosisBoardConcept[];
}) {
  // 정본 개념 id 가 있으면 그 축으로, 없으면 표기+과목으로 찾는다(웹 statByKey 와 같은 규칙).
  const statByKey = useMemo(() => {
    const m = new Map<string, DiagnosisBoardConcept>();
    for (const c of concepts) {
      if (c.conceptId) m.set(c.conceptId, c);
      m.set(`kw:${c.concept}###${c.subjectSlug ?? ""}`, c);
    }
    return m;
  }, [concepts]);

  if (coaching.length === 0) return null;
  const shown = subject ? coaching.filter((c) => c.subjectSlug === subject) : coaching;
  if (shown.length === 0) {
    return (
      <AppText variant="xs" className="px-1 text-zinc-400 dark:text-zinc-600" pretty>
        이 과목은 이번 진단에서 고르지 않았어요. 다른 과목 탭에 극복법이 있어요.
      </AppText>
    );
  }
  return (
    <View className="gap-3">
      {shown.map((c, i) => (
        <CoachingCard
          key={`${c.concept}-${i}`}
          coaching={c}
          stat={
            (c.conceptId ? statByKey.get(c.conceptId) : undefined) ??
            statByKey.get(`kw:${c.concept}###${c.subjectSlug ?? ""}`) ??
            null
          }
        />
      ))}
    </View>
  );
}

function CoachingCard({
  coaching,
  stat,
}: {
  coaching: DiagnosisConceptCoaching;
  stat: DiagnosisBoardConcept | null;
}) {
  const subjectSlug = coaching.subjectSlug ?? stat?.subjectSlug ?? null;
  const canSolve = subjectSlug != null && (stat?.corpusCount ?? 0) >= MIN_CORPUS_FOR_SOLVE;
  return (
    <View className="rounded-2xl border border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <View className="flex-row flex-wrap items-center gap-2">
        {stat && <Pill tone="red" label={`${stat.wrongCount}회 틀림`} />}
        {stat?.accuracyPct != null && <Pill tone="zinc" label={`정답률 ${stat.accuracyPct}%`} />}
        {(stat?.corpusCount ?? 0) > 0 && <Pill tone="amber" label={`기출 ${stat?.corpusCount}문항`} />}
        {/* 예상 점수. 0.5점 미만은 뱃지로 띄우면 오히려 "해봐야 소용없다"로 읽혀 숨긴다. */}
        {stat?.scoreGainPct != null && stat.scoreGainPct >= 0.5 && (
          <Pill tone="emerald" label={`잡으면 +${stat.scoreGainPct}점`} />
        )}
      </View>

      <View className="mt-2.5">
        {coaching.subject && (
          <AppText variant="xs" weight="semibold" className="text-zinc-500 dark:text-zinc-500">
            {coaching.subject}
          </AppText>
        )}
        <AppText variant="base" weight="bold" pretty>
          {coaching.concept}
        </AppText>
      </View>

      {/* 1) 무너지는 지점 */}
      <View className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/10">
        <View className="flex-row items-center gap-1.5">
          <BulbIcon size={13} colorClassName="text-blue-700 dark:text-blue-300" />
          <AppText variant="xs" weight="bold" className="text-blue-700 dark:text-blue-300">
            어디서 무너지고 있나
          </AppText>
        </View>
        <AppText variant="sm" className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
          {coaching.weakPattern}
        </AppText>
        {coaching.rootCause && (
          <>
            <AppText variant="xs" weight="bold" className="mt-3 text-blue-700/80 dark:text-blue-300/80">
              왜 그렇게 골랐을까
            </AppText>
            <AppText variant="sm" className="mt-1 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
              {coaching.rootCause}
            </AppText>
          </>
        )}
      </View>

      {/* 2) 내 오답에서 나온 근거 — 이 기능이 "개념별 풀이법 사전"과 갈리는 지점이다. */}
      {coaching.evidence && coaching.evidence.length > 0 && (
        <View className="mt-3">
          <AppText variant="xs" weight="bold" className="px-1 text-zinc-600 dark:text-zinc-400">
            내가 틀린 문항에서
          </AppText>
          <View className="mt-1.5 gap-2">
            {coaching.evidence.map((e, i) => (
              <View
                key={i}
                className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40"
              >
                <AppText variant="13" weight="semibold" className="leading-snug text-zinc-800 dark:text-zinc-200" pretty>
                  {e.question}
                </AppText>
                {e.myChoice && (
                  <AppText variant="xs" className="mt-1 leading-relaxed text-zinc-500 dark:text-zinc-400" pretty>
                    내 선택 · {e.myChoice}
                  </AppText>
                )}
                <AppText variant="13" className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
                  {e.insight}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 3) 처방 한 줄 + 실행 계획 */}
      <View className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5 dark:border-violet-900/40 dark:bg-violet-950/15">
        <View className="flex-row items-center gap-1.5">
          <TargetIcon size={13} colorClassName="text-violet-700 dark:text-violet-300" />
          <AppText variant="xs" weight="bold" className="text-violet-700 dark:text-violet-300">
            이렇게 극복해요
          </AppText>
        </View>
        <AppText variant="sm" weight="semibold" className="mt-1.5 leading-relaxed text-zinc-800 dark:text-zinc-200" pretty>
          {coaching.howToOvercome}
        </AppText>
        {coaching.steps && coaching.steps.length > 0 && (
          <View className="mt-2.5 gap-2">
            {coaching.steps.map((s, i) => (
              <View key={i} className="flex-row gap-2.5">
                <View className="mt-0.5 h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600">
                  <AppText variant="11" weight="bold" allowFontScaling={false} className="text-white">
                    {i + 1}
                  </AppText>
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-baseline gap-x-1.5">
                    <AppText variant="13" weight="bold" className="text-zinc-800 dark:text-zinc-200">
                      {s.title}
                    </AppText>
                    {s.minutes != null && (
                      <AppText variant="11" weight="semibold" className="text-violet-600 dark:text-violet-400">
                        약 {s.minutes}분
                      </AppText>
                    )}
                  </View>
                  <AppText variant="13" className="mt-0.5 leading-relaxed text-zinc-600 dark:text-zinc-400" pretty>
                    {s.detail}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 4) 시험장 체크리스트 · 함정 */}
      {coaching.checkpoints && coaching.checkpoints.length > 0 && (
        <View className="mt-3">
          <AppText variant="xs" weight="bold" className="px-1 text-zinc-600 dark:text-zinc-400">
            다음에 이 유형을 만나면
          </AppText>
          <View className="mt-1.5 gap-1">
            {coaching.checkpoints.map((c, i) => (
              <View key={i} className="flex-row items-start gap-1.5">
                <View className="mt-0.5">
                  <CheckIcon size={14} colorClassName="text-emerald-600 dark:text-emerald-400" />
                </View>
                <AppText variant="13" className="min-w-0 flex-1 leading-relaxed text-zinc-700 dark:text-zinc-300" pretty>
                  {c}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}
      {coaching.trap && (
        <View className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/20">
          <AppText variant="13" className="leading-relaxed text-amber-900 dark:text-amber-200" pretty>
            <AppText variant="13" weight="bold" className="text-amber-900 dark:text-amber-200">
              자주 걸리는 함정 ·{" "}
            </AppText>
            {coaching.trap}
          </AppText>
        </View>
      )}

      {/* 액션: 틀린 문항 다시 보기 · 같은 개념 기출 풀기 */}
      <View className="mt-3.5 flex-row items-start gap-2">
        {subjectSlug && (
          <Button
            variant="outline"
            label="틀린 문항 보기"
            accessibilityRole="link"
            icon={<BookIcon size={15} colorClassName="text-zinc-700 dark:text-zinc-200" />}
            onPress={() => router.push(`/mypage/wrong-notes/${subjectSlug}?view=questions` as Href)}
            className="rounded-lg py-2"
          />
        )}
        {canSolve && (
          <ConceptSolveButton
            concept={coaching.concept}
            conceptId={coaching.conceptId ?? null}
            subjectSlug={subjectSlug as string}
          />
        )}
      </View>
    </View>
  );
}

// 같은개념 기출 랜덤(기본 5문제) 풀기(웹 diagnosis-actions.tsx ConceptSolveButton). 유저 오답이
// 아니라 기출 전체에서 같은 개념 문항을 뽑아 세션을 만들고 풀이 화면으로 간다. subjectSlug 가
// 없으면 풀이 주소를 만들 수 없어 호출부가 아예 그리지 않는다.
function ConceptSolveButton({
  concept,
  conceptId,
  subjectSlug,
}: {
  concept: string;
  conceptId: string | null;
  subjectSlug: string;
}) {
  const create = useCreateConceptReview();
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (create.isPending) return;
    setError(null);
    try {
      const sessionId = await create.mutateAsync({ concept, conceptId, subjectSlug, limit: 5 });
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${sessionId}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: "/mypage/diagnosis" });
      if (handled.redirected) return;
      setError(handled.message || "문제를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <View className="min-w-0 flex-1">
      <Button
        label={create.isPending ? "준비 중..." : "같은 개념 기출 5문제"}
        pending={create.isPending}
        onPress={() => void go()}
        className="rounded-lg py-2"
      />
      {error && (
        <AppText variant="xs" className="mt-1.5 text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}
    </View>
  );
}

// 카드 머리의 알약 배지(웹 rounded-full px-2.5 py-1 text-xs font-bold).
function Pill({ tone, label }: { tone: "red" | "zinc" | "amber" | "emerald"; label: string }) {
  const cls = {
    red: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  }[tone];
  return (
    <View className={["rounded-full px-2.5 py-1", cls].join(" ")}>
      <AppText variant="xs" weight="bold" allowFontScaling={false} className={cls}>
        {label}
      </AppText>
    </View>
  );
}
