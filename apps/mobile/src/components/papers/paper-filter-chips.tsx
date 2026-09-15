import { examTypeTabColor, levelColor, type ExamTypeOption } from "@gongmoa/core";
import { Pressable, ScrollView } from "react-native";
import { AppText } from "../app-text";
import { hapticSelect } from "../../lib/haptics";

// 급수·직렬 필터 칩(웹 subjects/[slug]/page.tsx:337,370 · papers/[id] RelatedPapersSection):
// `rounded-full px-4 py-1.5 text-sm font-medium`, "전체" 활성 `bg-zinc-800 text-white`, 급수 활성
// levelColor, 직렬 활성 examTypeTabColor(다중 선택 — 눌린 것만 토글). /papers 의 GROUPS 줄도
// 같은 칩(papersGroupColor)을 쓴다.
export function FilterChip({
  label,
  active,
  activeClass,
  onPress,
}: {
  label: string;
  active: boolean;
  // 활성일 때 배경·글자 클래스(core badge-classes 문자열).
  activeClass: string;
  onPress: () => void;
}) {
  const inactive =
    "border border-zinc-200 active:border-zinc-400 dark:border-zinc-700 dark:active:border-zinc-600";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      className={["shrink-0 rounded-full px-4 py-1.5", active ? activeClass : inactive].join(" ")}
    >
      <AppText
        variant="sm"
        weight="medium"
        className={active ? activeClass : "text-zinc-600 dark:text-zinc-400"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export const ALL_CHIP_CLASS = "bg-zinc-800 text-white dark:bg-zinc-700";

// 가로 스크롤 한 줄(스크롤바 숨김) — 웹 `flex-wrap` 대신 폰 폭 적응(설계서 §4.4).
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4" contentContainerClassName="flex-row gap-2 px-4">
      {children}
    </ScrollView>
  );
}

// 급수 탭(그 과목에 실제 존재하는 급수가 2개 이상일 때만 호출부가 그린다).
export function LevelChips({
  levels,
  value,
  onChange,
}: {
  levels: string[];
  value: string | undefined;
  onChange: (level: string | undefined) => void;
}) {
  return (
    <ChipRow>
      <FilterChip label="전체" active={!value} activeClass={ALL_CHIP_CLASS} onPress={() => onChange(undefined)} />
      {levels.map((lv) => (
        <FilterChip key={lv} label={lv} active={value === lv} activeClass={levelColor(lv)} onPress={() => onChange(lv)} />
      ))}
    </ChipRow>
  );
}

// 직렬 탭 — 여러 개를 동시에 켤 수 있는 다중 선택. "전체"는 전부 해제.
export function ExamTypeChips({
  examTypes,
  selectedIds,
  onChange,
}: {
  examTypes: ExamTypeOption[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <ChipRow>
      <FilterChip label="전체" active={selectedIds.size === 0} activeClass={ALL_CHIP_CLASS} onPress={() => onChange(new Set())} />
      {examTypes.map((et) => {
        const selected = selectedIds.has(et.id);
        return (
          <FilterChip
            key={et.id}
            label={et.name}
            active={selected}
            activeClass={examTypeTabColor(et.name)}
            onPress={() => {
              const next = new Set(selectedIds);
              if (selected) next.delete(et.id);
              else next.add(et.id);
              onChange(next);
            }}
          />
        );
      })}
    </ChipRow>
  );
}

// 필터 파라미터 직렬화(웹 buildFilterHref 와 같은 규칙: level, examTypes=a,b).
export function parseExamTypesParam(raw: string | string[] | undefined): Set<string> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return new Set((value ?? "").split(",").filter(Boolean));
}
