import { subjectColor, type UnresolvedBySubject, type WrongNoteSubjectGroup } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { BookOpenCheck, ChevronRight, Shuffle } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { HowItWorksStrip } from "./how-it-works-strip";
import { ReviewDueCard } from "./review-due-card";
import { AppText } from "../app-text";
import { Button } from "../button";
import { openSubjectMix } from "../../lib/mix-href";
import { themedIcon } from "../../theme/icons";

// "오답노트" 탭(웹 mypage/page.tsx WrongNotesTab:701): 과목별로 틀린 문제 수를 요약해서 보여주고,
// 과목을 누르면 문제 이미지까지 모아둔 과목 오답노트 페이지로 이어준다.
//
// 과목 카드의 목적지 `/mypage/wrong-notes/[slug]`(과목 오답노트)는 Phase 2 에서, 기출 섞어풀기
// `/subjects/[slug]/mix` 는 Phase 3 에서 붙었다 — 섞어풀기로 보내는 자리는 `openSubjectMix`
// (lib/mix-href.ts) 한 곳으로 모여 있다. 이 파일은 목록 수준(과목 요약 카드)만 그린다.
const BookIcon = themedIcon(BookOpenCheck);
const ChevronIcon = themedIcon(ChevronRight);
const ShuffleIcon = themedIcon(Shuffle);

function wrongNotesHref(slug: string): Href {
  return `/mypage/wrong-notes/${slug}` as Href;
}

function sortByUnresolved(list: UnresolvedBySubject[]) {
  return [...list].sort((a, b) => b.unresolved - a.unresolved || a.name.localeCompare(b.name, "ko"));
}

export function WrongNotesTab({
  premium,
  // 프리미엄만 계산하는 무거운 집계(극복 진행률). null 이면(무료·아직 집계 전) 남은 오답만 그린다.
  groups,
  unresolvedBySubject,
}: {
  premium: boolean;
  groups: WrongNoteSubjectGroup[] | null;
  unresolvedBySubject: UnresolvedBySubject[];
}) {
  const sorted = useMemo(() => sortByUnresolved(unresolvedBySubject), [unresolvedBySubject]);
  const byId = useMemo(() => new Map(unresolvedBySubject.map((s) => [s.id, s])), [unresolvedBySubject]);

  const header = (
    <>
      <View className="flex-row items-center gap-2">
        <BookIcon size={18} colorClassName="text-blue-600 dark:text-blue-400" />
        <AppText variant="lg" weight="semibold">
          오답노트
        </AppText>
      </View>
      <HowItWorksStrip />
      <MixPracticeEntry subjects={sorted} />
    </>
  );

  const empty = (
    <View className="items-center gap-4 py-12">
      <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
        아직 모인 오답이 없어요. CBT로 문제를 풀면 틀린 문제가 과목별로 자동으로 정리돼요.
      </AppText>
      <Button label="문제 풀러 가기" onPress={() => router.push("/papers" as Href)} className="rounded-lg px-4 py-2" />
    </View>
  );

  const footer = (
    <>
      <ReviewDueCard premium={premium} />
      <DiagnosisEntryLink />
    </>
  );

  // 무료 회원(또는 집계 전): 오답노트는 열람도 정리도 섞어풀기도 그대로 쓴다. 다만 무거운 집계는
  // 돌리지 않았으므로 과목 카드를 이미 계산해 둔 미극복 집계로 그린다 — 극복 진행률 바만 빠지고
  // 이동·기능은 같다. 잠기는 것은 문항 해설과 오늘의 복습뿐이고, 그건 아래 잠금 카드가 알린다.
  if (!premium || groups === null) {
    return (
      <View className="gap-4">
        {header}
        {sorted.length === 0 ? (
          empty
        ) : (
          <View className="gap-3">
            {sorted.map((s) => (
              <SimpleSubjectCard key={s.slug} name={s.name} slug={s.slug} unresolved={s.unresolved} />
            ))}
          </View>
        )}
        {footer}
      </View>
    );
  }

  // 응시 없이 채점된 오답(기출 섞어풀기)만 있는 과목은 응시 기준 집계(groups)에 없다. 통합 상태
  // 기준 집계에만 있는 과목을 앞에 붙여 오답노트에서 사라지지 않게 한다(무료 회원 카드와 같은 모양).
  const onlyInStatus = sorted.filter((s) => !groups.some((g) => g.subject.id === s.id));

  return (
    <View className="gap-4">
      {header}
      {groups.length === 0 && unresolvedBySubject.length === 0 ? (
        empty
      ) : (
        <View className="gap-3">
          {onlyInStatus.map((s) => (
            <SimpleSubjectCard key={s.id} name={s.name} slug={s.slug} unresolved={s.unresolved} />
          ))}
          {groups.map((g) => {
            const stat = byId.get(g.subject.id);
            const unresolved = stat?.unresolved ?? g.unresolvedCount;
            const total = unresolved + g.resolvedCount;
            const pct = total > 0 ? Math.round((g.resolvedCount / total) * 100) : 0;
            const color = subjectColor(g.subject.slug);
            return (
              <Pressable
                key={g.subject.id}
                accessibilityRole="link"
                onPress={() => router.push(wrongNotesHref(g.subject.slug))}
                className="gap-2.5 rounded-xl border border-zinc-200 p-4 active:border-blue-300 active:bg-blue-50/40 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/20"
              >
                <View className="flex-row items-center gap-3">
                  <View className={["shrink-0 rounded px-2 py-0.5", color].join(" ")}>
                    <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
                      {g.subject.name}
                    </AppText>
                  </View>
                  <AppText variant="sm" className="min-w-0 shrink text-zinc-500 dark:text-zinc-500" numberOfLines={1}>
                    <AppText variant="sm" weight="medium" className="text-red-600 dark:text-red-400">
                      남은 오답 {unresolved}
                    </AppText>
                    {g.resolvedCount > 0 && (
                      <>
                        {" · "}
                        <AppText variant="sm" weight="medium" className="text-emerald-600 dark:text-emerald-400">
                          극복 {g.resolvedCount}
                        </AppText>
                      </>
                    )}
                  </AppText>
                  <SeeWrongLink />
                </View>
                {/* 극복 진행률 — "이 바를 초록으로 채우는 게 목표"라는 걸 한눈에 보여준다. */}
                {total > 0 && (
                  <View className="flex-row items-center gap-2">
                    <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <View className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </View>
                    <AppText variant="11" weight="medium" tabular className="shrink-0 text-zinc-400 dark:text-zinc-600">
                      극복 {pct}%
                    </AppText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      {footer}
    </View>
  );
}

function SeeWrongLink() {
  return (
    <View className="ml-auto shrink-0 flex-row items-center gap-1">
      <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
        오답 보기
      </AppText>
      <ChevronIcon size={15} colorClassName="text-blue-600 dark:text-blue-400" />
    </View>
  );
}

// 무료 회원·상태 기준 집계에만 있는 과목의 카드(이름·남은 오답·오답 보기).
function SimpleSubjectCard({ name, slug, unresolved }: { name: string; slug: string; unresolved: number }) {
  const color = subjectColor(slug);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(wrongNotesHref(slug))}
      className="flex-row items-center gap-3 rounded-xl border border-zinc-200 p-4 active:border-blue-300 active:bg-blue-50/40 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/20"
    >
      <View className={["shrink-0 rounded px-2 py-0.5", color].join(" ")}>
        <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
          {name}
        </AppText>
      </View>
      <AppText variant="sm" weight="medium" className="text-red-600 dark:text-red-400">
        남은 오답 {unresolved}
      </AppText>
      <SeeWrongLink />
    </Pressable>
  );
}

// 오답노트 탭 안의 기출 섞어풀기 진입점(웹 MixPracticeEntry:892). 오답을 "다시" 푸는 기능들
// 사이에서 유일하게 "새" 문제를 내는 자리라, 과목 카드 목록과 헷갈리지 않게 한 줄짜리 띠로 둔다.
// 과목 칩은 오답이 있는 과목(= 지금 공부 중인 과목) 순이고, 그 밖의 과목은 과목 목록으로 보낸다.
function MixPracticeEntry({ subjects }: { subjects: { slug: string; name: string }[] }) {
  const chips = subjects.slice(0, 6);
  return (
    <View className="gap-2 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <View className="flex-row items-center gap-2">
        <ShuffleIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
        <AppText variant="sm" weight="semibold" className="text-blue-900 dark:text-blue-200">
          기출 섞어풀기
        </AppText>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {chips.map((s) => (
          <Pressable
            key={s.slug}
            accessibilityRole="link"
            onPress={() => openSubjectMix(s.slug)}
            className="rounded-full border border-blue-200 bg-white px-3 py-1 active:bg-blue-100 dark:border-blue-800 dark:bg-zinc-900 dark:active:bg-blue-950/60"
          >
            <AppText variant="xs" weight="semibold" className="text-blue-700 dark:text-blue-300">
              {s.name}
            </AppText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/subjects" as Href)}
          className="flex-row items-center gap-0.5 rounded-full px-2 py-1"
        >
          <AppText variant="xs" weight="medium" className="text-blue-700 dark:text-blue-300">
            {chips.length > 0 ? "다른 과목" : "과목 고르기"}
          </AppText>
          <ChevronIcon size={13} colorClassName="text-blue-700 dark:text-blue-300" />
        </Pressable>
      </View>
    </View>
  );
}

// 오답노트 탭 안의 AI 약점 진단 진입점(웹 DiagnosisEntryLink:930). 모든 회원에게 보인다 —
// 멤버십이 없는 사람이 눌러도 진단 대시보드(`app/mypage/diagnosis.tsx`, Phase 4)가 멤버십
// 안내를 대신 띄운다.
function DiagnosisEntryLink() {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push("/mypage/diagnosis" as Href)}
      className="flex-row items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 active:border-violet-300 active:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/20 dark:active:bg-violet-950/40"
    >
      <AppText variant="sm" weight="semibold" className="flex-1 text-violet-900 dark:text-violet-200">
        AI 약점 진단
      </AppText>
      <ChevronIcon size={16} colorClassName="text-violet-400" />
    </Pressable>
  );
}
