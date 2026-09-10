import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { formatDuration, KST_TIME_ZONE } from "@gongmoa/core";

export type MyCbtRecordItem = {
  id: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
  durationSeconds: number | null;
};

export type RoundAverage = {
  round: number;
  avgPct: number;
  attemptCount: number;
};

// 이 정도까지는 펼쳐두고, 그보다 오래된 회독은 <details> 안으로 접는다. 한 시험지를
// 열 번 넘게 푼 사람이 있어서, 다 펼치면 아래의 난이도 평가·댓글이 화면 밖으로
// 밀려난다. 서버 컴포넌트인 채로 접으려고 native <details> 를 쓴다(이 카드 하나
// 때문에 클라이언트 번들을 늘리지 않는다).
const INLINE_LIMIT = 4;

/**
 * 문제지 상세페이지의 "내 시험 기록" — 이 시험지를 언제 풀어서 몇 점을 받았는지
 * 회독 순서대로 보여준다.
 *
 * 예전에는 같은 데이터를 버튼 줄 끝의 "내 기록보기" 모달에 숨겨뒀는데, 다시 풀지
 * 말지를 정하는 데 가장 필요한 정보가 한 번 더 눌러야 나오는 자리에 있었다.
 * 그래서 열기 버튼들(문제·정답·해설)과 체감 난이도 사이에 제 구역으로 펼쳐둔다.
 *
 * 서버 컴포넌트다. 값이 이미 페이지 데이터(getPaperDetailData)에 실려 오므로
 * 상태가 필요 없고, 접기도 <details> 로 끝난다.
 */
export function MyPaperHistory({
  attempts,
  roundAverages,
}: {
  attempts: MyCbtRecordItem[];
  roundAverages: RoundAverage[];
}) {
  if (attempts.length === 0) return null;

  const averageByRound = new Map(roundAverages.map((r) => [r.round, r]));

  // 들어올 때는 오래된 순(1회독부터)이다. 화면에는 최신 회독을 맨 위에 둔다 —
  // "지금 내가 몇 점인가"가 먼저고, 1회독은 굳이 찾아 내려가는 값이다.
  const rows = attempts
    .map((a) => ({
      ...a,
      pct:
        a.totalQuestions > 0
          ? Math.round((a.score / a.totalQuestions) * 100)
          : 0,
    }))
    .reverse();

  const latest = rows[0];
  const previous = rows[1];
  const bestPct = Math.max(...rows.map((r) => r.pct));
  // 지난 회독 대비 변화. 첫 응시라 비교 대상이 없으면 자리를 비운다.
  const gain = previous ? latest.pct - previous.pct : null;

  const recent = rows.slice(0, INLINE_LIMIT);
  const older = rows.slice(INLINE_LIMIT);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 px-3.5 py-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm font-bold text-zinc-700 dark:text-zinc-300">
          <Trophy size={14} className="shrink-0 text-amber-500" />내 시험 기록
          <span className="font-medium text-zinc-400 dark:text-zinc-500">
            {rows.length}회 응시
          </span>
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          최고{" "}
          <span className="font-bold text-zinc-700 dark:text-zinc-300">
            {bestPct}점
          </span>
          {gain !== null && (
            <>
              {" · 지난 회독보다 "}
              {/* 오르내림은 "잘했다/못했다"가 아니라 위치를 알려주는 값이라,
                  내려갔을 때도 오답 색(빨강)을 쓰지 않는다(round-average-compare 와 같은 규칙). */}
              <span
                className={`font-bold ${
                  gain > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {gain > 0 ? `+${gain}` : gain === 0 ? "±0" : gain}점
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col">
        {recent.map((row) => (
          <AttemptRow
            key={row.id}
            row={row}
            average={averageByRound.get(row.round) ?? null}
          />
        ))}
      </div>

      {older.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400">
            이전 기록 {older.length}개 더보기
            <span className="group-open:hidden"> ▾</span>
            <span className="hidden group-open:inline"> ▴</span>
          </summary>
          <div className="flex flex-col">
            {older.map((row) => (
              <AttemptRow
                key={row.id}
                row={row}
                average={averageByRound.get(row.round) ?? null}
              />
            ))}
          </div>
        </details>
      )}

      <p className="px-2 pt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
        회독을 누르면 그때 틀린 문제만 모아 볼 수 있어요
      </p>
    </div>
  );
}

// 회독 한 줄. 누르면 그 회차의 오답만 모아둔 페이지로 간다 — 점수만 다시 보는
// 것보다, 그때 틀린 문제로 곧장 들어가는 쪽이 다음 행동이다.
function AttemptRow({
  row,
  average,
}: {
  row: MyCbtRecordItem & { pct: number };
  average: RoundAverage | null;
}) {
  // 표본이 모자란 회독은 DB 함수(avg_score_by_round)가 아예 안 내려준다 —
  // 두세 명짜리 평균을 "평균"이라 내밀지 않기 위한 기준이라 여기서는 자리만 비운다.
  const diff = average ? Math.round((row.pct - average.avgPct) * 10) / 10 : null;

  return (
    <Link
      href={`/mypage/attempts/${row.id}`}
      className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
    >
      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        {row.round}회독
      </span>
      <span className="min-w-0 truncate text-xs text-zinc-400 dark:text-zinc-600">
        {/* 서버는 UTC 로 돌기 때문에 timeZone 을 빼면 밤에 푼 기록이 어제로 보인다. */}
        {new Date(row.createdAt).toLocaleDateString("ko-KR", {
          timeZone: KST_TIME_ZONE,
        })}
        {/* 좁은 화면에서는 날짜만 남긴다 — 붙여두면 "2026. 9. 9. · 2…" 처럼
            소요 시간이 잘린 채로 남아 날짜까지 읽기 어려워진다. */}
        {row.durationSeconds != null && (
          <span className="hidden sm:inline">
            {` · ${formatDuration(row.durationSeconds)}`}
          </span>
        )}
      </span>

      <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
        <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">
          {row.pct}점
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">
          {row.score}/{row.totalQuestions}
        </span>
      </span>

      {diff !== null && (
        <span
          className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold sm:inline ${
            diff > 0
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
          title={`같은 ${row.round}회독을 푼 다른 회원 평균 ${average!.avgPct}점 (${average!.attemptCount}명)`}
        >
          평균 {diff > 0 ? `+${diff}` : diff === 0 ? "±0" : diff}
        </span>
      )}

      <ChevronRight
        size={15}
        className="shrink-0 text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
      />
    </Link>
  );
}
