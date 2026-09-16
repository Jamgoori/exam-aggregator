import { getPaperDisplayTitle, type ExamCombo } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { groupPapersByYear, type ExamComboPaper } from "../../lib/exam-index";
import { paperHref } from "../../lib/paper-href";
import { themedIcon } from "../../theme/icons";

// 시험 한 칸의 "전체 목록"(웹 exams/exam-page-parts.tsx ExamAllYearsList·ExamAllPapersList).
//
// 웹에서 이 목록의 용건은 크롤러다 — 카드 그리드는 ?year= 한 해만 보여 주고 다른 연도
// 링크는 nofollow 라, 문제지 4천여 장이 사이트맵에만 매달려 있었다(2026-09 실측 3,776건
// "발견됨 - 현재 색인되지 않음"). 앱에는 크롤러가 없으므로 남는 건 사람 쪽 용건 하나다:
// "다른 해 것도 한눈에". 그래서 웹과 같이 연도마다 접어 두고(details), 펼치면 그 해의
// 과목별 문제지가 제목만으로 늘어선다.

const ChevronDownIcon = themedIcon(ChevronDown);
const ChevronUpIcon = themedIcon(ChevronUp);

function PaperLinkRow({ paper }: { paper: ExamComboPaper }) {
  const title = getPaperDisplayTitle(paper.title, paper.track);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => router.push(paperHref(paper) as Href)}
      hitSlop={4}
      className="py-1"
    >
      <AppText variant="sm" numberOfLines={1} className="text-zinc-700 dark:text-zinc-300">
        {title}
      </AppText>
    </Pressable>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="rounded-xl border border-zinc-200 dark:border-zinc-700">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="flex-row items-center gap-2 px-4 py-3"
      >
        <AppText variant="sm" weight="medium" className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200">
          {label}
        </AppText>
        {open ? (
          <ChevronUpIcon size={16} colorClassName="text-zinc-400" />
        ) : (
          <ChevronDownIcon size={16} colorClassName="text-zinc-400" />
        )}
      </Pressable>
      {open && (
        <View className="gap-y-1 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">{children}</View>
      )}
    </View>
  );
}

/** 연도별로 접어 놓은 전체 목록 (공무원 기출 — 연도가 목록을 가르는 축인 시험). */
export function ExamAllYearsList({ combo, papers }: { combo: ExamCombo; papers: ExamComboPaper[] }) {
  // 웹은 연도마다 독립된 <details> 라 여러 해를 동시에 펼쳐 둘 수 있다(한 해를 펼치면 다른
  // 해가 접히는 아코디언이 아니다) — 연도끼리 비교하려는 것이 이 목록의 용건이라 Set 으로 둔다.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  if (papers.length === 0) return null;
  const groups = groupPapersByYear(papers);

  return (
    <View className="mt-6 gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
      <AppText variant="lg" weight="semibold">
        연도별 전체 목록
      </AppText>
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" pretty>
        {combo.label} 기출문제 {papers.length.toLocaleString()}건을 연도별로 모았습니다. 연도를 누르면 그 해의 과목별 문제지가 펼쳐집니다.
      </AppText>
      <View className="gap-2">
        {groups.map((group) => (
          <Disclosure
            key={group.year}
            label={`${group.year}년 ${combo.label} 기출문제 ${group.papers.length}건`}
            open={open.has(group.year)}
            onToggle={() =>
              setOpen((prev) => {
                const next = new Set(prev);
                if (!next.delete(group.year)) next.add(group.year);
                return next;
              })
            }
          >
            {group.papers.map((p) => (
              <PaperLinkRow key={p.id} paper={p} />
            ))}
          </Disclosure>
        ))}
      </View>
    </View>
  );
}

/** 연도로 나누지 않은 전체 목록 (한능검처럼 연도가 축이 아닌 시험). */
export function ExamAllPapersList({ combo, papers }: { combo: ExamCombo; papers: ExamComboPaper[] }) {
  const [open, setOpen] = useState(false);
  if (papers.length === 0) return null;

  return (
    <View className="mt-6 gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
      <Disclosure
        label={`${combo.label} 기출문제 전체 목록 ${papers.length.toLocaleString()}건`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      >
        {papers.map((p) => (
          <PaperLinkRow key={p.id} paper={p} />
        ))}
      </Disclosure>
    </View>
  );
}
