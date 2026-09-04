import Link from "next/link";
import { BrainCircuit, ChevronRight } from "lucide-react";
import { computeDiagnosisProgress } from "@/lib/diagnosis-progress";

// "AI 약점 진단까지 응시 2/3" 진행 바.
//
// 처음 온 수험생이 세 번 돌아오게 만드는 장치다 — 진단은 응시 3회(또는 오답 15개)
// 뒤에야 열리는데, 그 사실을 /diagnosis 의 접힌 표 안에서만 말하면 아무도 세 번 오지
// 않는다. 그래서 채점 직후(결과 모달)·마이페이지·진단 소개에 같은 모양으로 붙인다.
//
// 자격이 되면 바 대신 "진단 받기" 링크로 바뀐다. 이미 이번 주기에 받았는지는 여기서
// 모른다(weekly 는 서버만 안다) — 필요한 자리는 eligibleHref/eligibleLabel 로 넘긴다.
//
// 서버 전용 import 가 없다: 결과 모달(클라이언트)에서도 그린다.
export function DiagnosisProgress({
  attemptCount,
  wrongCount,
  // 자격이 됐을 때 가는 곳과 문구. 기본은 진단 대시보드.
  eligibleHref = "/mypage/diagnosis",
  eligibleLabel = "AI 약점 진단 받기",
  // 아직 자격이 안 될 때 눌러 가는 곳. 기본은 소개 페이지 — "이게 뭔데 세 번을
  // 풀라는 건지"가 먼저 닿아야 한다.
  lockedHref = "/diagnosis",
  compact = false,
}: {
  attemptCount: number;
  wrongCount: number;
  eligibleHref?: string;
  eligibleLabel?: string;
  lockedHref?: string;
  // 결과 모달처럼 좁은 자리용. 여백과 글자를 줄인다.
  compact?: boolean;
}) {
  const p = computeDiagnosisProgress({ attemptCount, wrongCount });
  const pad = compact ? "px-3.5 py-3" : "px-4 py-3.5";

  if (p.eligible) {
    return (
      <Link
        href={eligibleHref}
        // 대시보드는 진입 즉시 계정 전체 오답을 훑는 무거운 집계를 돌린다. 프리페치는
        // 링크가 화면에 보이기만 해도 그 렌더를 시켜 버리므로 끈다.
        prefetch={false}
        className={`group flex w-full items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 text-left transition-colors hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 ${pad}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
          <BrainCircuit size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-violet-900 dark:text-violet-100">
            {eligibleLabel}
          </span>
          <span className="block text-xs text-violet-700/80 dark:text-violet-300/70">
            틀리는 이유를 개념별로 짚어 드려요
          </span>
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    );
  }

  return (
    <Link
      href={lockedHref}
      className={`block w-full rounded-xl border border-violet-200 bg-violet-50/70 text-left transition-colors hover:bg-violet-100/80 dark:border-violet-900/60 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 ${pad}`}
    >
      <span className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-1.5 font-bold text-violet-900 dark:text-violet-100">
          <BrainCircuit size={15} className="shrink-0" />
          AI 약점 진단까지
        </span>
        <span className="font-bold tabular-nums text-violet-700 dark:text-violet-300">
          {p.label}
        </span>
      </span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.ratio * 100)}
        aria-label={`AI 약점 진단까지 ${p.label}`}
        className="mt-2 block h-2 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/50"
      >
        <span
          className="block h-full rounded-full bg-violet-600 transition-[width]"
          style={{ width: `${Math.max(4, Math.round(p.ratio * 100))}%` }}
        />
      </span>
      {p.remainingHint && (
        <span className="mt-1.5 block text-[11px] text-violet-700/80 dark:text-violet-300/70">
          {p.remainingHint}
        </span>
      )}
    </Link>
  );
}
