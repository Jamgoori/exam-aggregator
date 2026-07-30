// 보류했던 과목을 다시 켤 때의 재예약 — 웹·모바일 공유(순수 계산).
//
// 복습 과목을 보류하면 그 과목 문항은 큐에도 예보에도 안 나온다. 하지만 스케줄
// 자체는 멈추지 않으므로, 두 달 보류했다가 다시 켜면 그 과목 문항이 전부
// "연체"로 오늘 칸에 쏟아진다. 그 상태가 되면:
//
//   - 예보표 오늘 칸이 "412"로 뜬다. 사용자는 기능이 고장 난 걸로 읽는다.
//   - 큐 우선순위가 연체순이라 그 과목이 하루 상한 20을 통째로 먹고, 다른 과목
//     문항이 몇 주째 안 나온다.
//
// 그래서 보류를 풀 때 밀린 문항을 며칠에 걸쳐 나눠 예약한다. 하루 몫을 큐 상한의
// 절반으로 잡는 건, 다시 켠 과목이 큐 전체를 먹지 않고 원래 보던 과목과 섞이게
// 하기 위해서다.
//
// 문항이 아주 많으면 하루 몫을 늘려서라도 정해진 기간 안에 다 밀어 넣는다 —
// 마지막 날에 몰아 넣으면 결국 같은 문제(그날 400개)가 재현된다.

import { srsDayIndex, srsDayStart } from "./srs";

// 재개 첫날부터 하루에 되살릴 문항 수(기본). 복습 하루 상한(DUE_QUEUE_LIMIT 20)의 절반.
export const RESUME_SPREAD_PER_DAY = 10;

// 재개분을 다 밀어 넣는 최대 기간. 이보다 길어지면 하루 몫을 늘린다.
export const RESUME_SPREAD_MAX_DAYS = 30;

// 밀린 문항 count개를 오늘부터 며칠에 걸쳐 나눠 배치했을 때의 due 시각 목록.
// 반환 배열의 i번째가 "i번째 문항의 새 due"다 — 호출부는 되살릴 문항을 원하는
// 순서(보통 오래 연체된 순)로 정렬해 두고 그대로 짝지으면 된다.
export function spreadResumeDueDates(
  count: number,
  now: Date = new Date(),
  opts: { perDay?: number; maxDays?: number } = {},
): Date[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];

  const maxDays = Math.max(1, opts.maxDays ?? RESUME_SPREAD_MAX_DAYS);
  const basePerDay = Math.max(1, opts.perDay ?? RESUME_SPREAD_PER_DAY);
  // 기간 안에 안 들어가면 하루 몫을 늘린다(마지막 날 몰아넣기 방지).
  const perDay = Math.max(basePerDay, Math.ceil(n / maxDays));

  const today = srsDayIndex(now);
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    out.push(srsDayStart(today + Math.floor(i / perDay)));
  }
  return out;
}
