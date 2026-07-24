import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripTrackFromTitle } from "@/lib/paper-title";

// 같은 시험지를 직류(track)만 다르게 중복 업로드한 행을 하나로 합치기 위한 도구.
//
// 배경: bulk-upload.mjs가 --track 값마다 별도 exam_papers 행을 만들면서 title에도
// " (전산서기보)" 같은 접미사를 붙인다. 법원직처럼 한 직렬 안에 여러 직류가 있는
// 시험은 공통과목(국어·한국사·영어)이 직류가 달라도 문제지가 완전히 동일한데,
// 직류별로 한 번씩 올리면 같은 시험지가 (전산서기보)/(사서서기보)처럼 여러 카드로
// 중복 노출된다.
//
// 합치는 기준:
//   1) 메타데이터: track을 뺀 (과목·직렬·연도·회차·급수)가 같아야 한다. 직류 전용
//      과목은 subject_id 자체가 달라 여기서 이미 걸러진다. 공무원 시험은 한
//      (직렬·연도·회차·급수)에서 과목당 시험지가 하나뿐이라, 이 값이 다 같은 여러
//      행은 사실상 직류만 다르게 중복 업로드한 것으로 본다.
//   2) 다르다는 증거가 있으면 분리: 같은 메타데이터라도 정답 배열(paper_answers.
//      answers)이 둘 다 등록돼 있는데 값이 다르면 다른 시험지로 보고 분리한다.
//      정답이 아직 없거나 한쪽만 있으면(예: 법원직 서기보) 같은 시험지로 보고
//      합친다. 즉 정답은 "잘못된 병합을 막는 안전장치"로만 쓰고, 합치기의 전제
//      조건으로 쓰지는 않는다(그렇게 했더니 정답 미등록 문제지가 안 합쳐졌다).

type DedupablePaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  level: string | null;
  title: string;
  // 아래 둘은 있으면 대표 선택/제목 정리에 쓰고, 없으면(LightPaper 등) 무시한다.
  track?: string | null;
  created_at?: string;
};

// 두 문제지가 같은지 확인하는 데 쓰는 내용 신호.
export type PaperIdentitySignal = {
  // 실제 등록된 문항 수 (questions는 공개 읽기라 익명 클라이언트로도 센다).
  questionCount: number;
  // 정답 배열 + 전항정답 번호의 지문(JSON). 같으면 동일 시험지로 확정한다.
  // paper_answers는 정답 유출 방지로 RLS가 anon/일반 사용자 읽기를 막아둬서
  // service_role로만 읽는다. 없으면(미등록/권한없음) null.
  answerSignature: string | null;
  // 정답 개수(= 문항 수). 정답이 있으면 이 값을, 없으면 questionCount를 대체
  // 신호로 쓴다.
  answerLength: number | null;
};

// track을 뺀 (과목·직렬·연도·회차·급수)가 같으면 "같은 시험지 후보"로 본다.
export function paperDedupKey(p: DedupablePaper): string {
  // 구분자는 공백. 필드가 UUID·정수·짧은 급수 문자열이라 값 안에 공백이 없어 경계
  // 충돌이 나지 않는다.
  return [p.subject_id, p.exam_type_id, p.year, p.round, p.level ?? ""].join(" ");
}

// title 끝의 " (전산서기보)" 같은 track 접미사를 떼어낸다. bulk-upload.mjs가
// title을 `${year} ${examType}${level?} (${track})? ${subject}` 형태로 만들기
// 때문에, track 값을 알면 정확히 그 조각만 안전하게 지울 수 있다(제목 다른 곳에
// 우연히 괄호가 있어도 건드리지 않는다).
// 메타데이터 후보 그룹(같은 키에 2건 이상)에 속한 문제지 id만 모은다. 내용 확인용
// 조회를 "정말 겹칠 수 있는 것"에 대해서만 하기 위한 것 — 대부분의 문제지는 겹치지
// 않아 조회 대상에서 빠진다.
export function collidingPaperIds(papers: DedupablePaper[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const p of papers) {
    const key = paperDedupKey(p);
    const arr = byKey.get(key);
    if (arr) arr.push(p.id);
    else byKey.set(key, [p.id]);
  }
  const ids: string[] = [];
  for (const arr of byKey.values()) {
    if (arr.length > 1) ids.push(...arr);
  }
  return ids;
}

// 겹칠 수 있는 문제지들의 내용 신호(문항 수 + 정답 지문)를 모은다. 정답 "내용"은
// 클라이언트로 나가지 않고, 서버에서 두 문제지가 같은지 비교하는 데만 쓴다.
// service_role 키가 없는 환경에서는 정답 대조를 조용히 건너뛰고 문항 수만 쓴다.
export async function fetchPaperIdentitySignals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<Map<string, PaperIdentitySignal>> {
  const signals = new Map<string, PaperIdentitySignal>();
  if (paperIds.length === 0) return signals;
  for (const id of paperIds) {
    signals.set(id, { questionCount: 0, answerSignature: null, answerLength: null });
  }

  // 문항 수(공개 읽기)와 정답 지문(service_role 전용)은 서로 의존이 없으므로
  // 동시에 조회한다 — 이 함수는 목록 조회 뒤에 이어지는 직렬 구간이라 왕복을
  // 하나라도 줄이는 게 체감 속도에 그대로 반영된다.
  const questionRowsPromise = supabase
    .from("questions")
    .select("paper_id")
    .in("paper_id", paperIds);
  // service_role 키가 없는 환경에서는 정답 대조를 조용히 건너뛰고 문항 수만 쓴다.
  // (여기서 null을 돌려줘야 아래 await 전에 거절된 프로미스가 생기지 않는다.)
  const answerRowsPromise = (async () => {
    try {
      const admin = createAdminClient();
      return await admin
        .from("paper_answers")
        .select("paper_id, answers, voided_questions")
        .in("paper_id", paperIds);
    } catch {
      return null;
    }
  })();

  const { data: questionRows } = await questionRowsPromise;
  for (const row of questionRows ?? []) {
    const s = signals.get((row as { paper_id: string }).paper_id);
    if (s) s.questionCount += 1;
  }

  const answerResult = await answerRowsPromise;
  if (answerResult && !answerResult.error) {
    for (const row of answerResult.data ?? []) {
      const r = row as {
        paper_id: string;
        answers: number[] | null;
        voided_questions: number[] | null;
      };
      const s = signals.get(r.paper_id);
      if (!s) continue;
      const answers = r.answers ?? [];
      s.answerSignature = JSON.stringify([answers, r.voided_questions ?? []]);
      s.answerLength = answers.length;
    }
  }

  return signals;
}

// 한 메타데이터 그룹 안에서 "정말 다른 시험지"만 갈라낸다.
//
// 기본 방침: 같은 (과목·직렬·연도·회차·급수)면 같은 시험지로 보고 합친다. 공무원
// 시험은 한 (직렬·연도·회차·급수)에서 과목당 실제 시험지가 하나뿐이라, 이 값이
// 모두 같은 여러 행은 사실상 직류만 다르게 중복 업로드한 것이다. 정답이 아직
// 등록되지 않았거나 한쪽만 있어도(예: 법원직 서기보) 합친다.
//
// 유일하게 분리하는 경우: 서로 "다르다는 확실한 증거"가 있을 때 — 즉 정답 배열이
// 둘 다 등록돼 있는데 값이 다른 경우다(정답 전체가 다르면 다른 시험지가 확실).
// 문항 수는 크롭이 덜 됐을 때도 달라져 신뢰할 수 없으므로 분리 근거로 쓰지 않는다.
function clusterSamePaper<T extends DedupablePaper>(
  members: T[],
  signals: Map<string, PaperIdentitySignal> | undefined,
): T[][] {
  if (members.length === 1) return [members];

  const distinctSignatures = new Set(
    members
      .map((m) => signals?.get(m.id)?.answerSignature)
      .filter((sig): sig is string => sig != null),
  );

  // 등록된 정답이 서로 다르게 2종 이상 섞여 있지 않으면(0종 또는 1종) 다르다는
  // 증거가 없으므로 메타데이터를 믿고 전부 합친다.
  if (distinctSignatures.size <= 1) return [members];

  // 정답이 서로 다른 시험지가 섞여 있다 → 정답으로 확실히 가른다. 정답 지문이
  // 있는 것은 지문별로 묶고, 어디에 속하는지 알 수 없는(정답 없는) 것은 안전하게
  // 각자 단독으로 둔다.
  const buckets = new Map<string, T[]>();
  for (const m of members) {
    const sig = signals?.get(m.id)?.answerSignature;
    const key = sig != null ? `a:${sig}` : `solo:${m.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(m);
    else buckets.set(key, [m]);
  }
  return [...buckets.values()];
}

// 최종 그룹의 대표: 문항 많은 쪽 > 정답 등록된 쪽 > 먼저 올라온(오래된) 쪽 > id
// 작은 쪽. 뒤의 둘은 값이 항상 정해지는 안정적 타이브레이커다.
function isBetterRepresentative<T extends DedupablePaper>(
  candidate: T,
  current: T,
  signals: Map<string, PaperIdentitySignal> | undefined,
): boolean {
  const sc = signals?.get(candidate.id);
  const su = signals?.get(current.id);
  const qc = sc?.questionCount ?? 0;
  const qu = su?.questionCount ?? 0;
  if (qc !== qu) return qc > qu;
  const ac = sc?.answerSignature != null ? 1 : 0;
  const au = su?.answerSignature != null ? 1 : 0;
  if (ac !== au) return ac > au;
  if (candidate.created_at && current.created_at && candidate.created_at !== current.created_at) {
    return candidate.created_at < current.created_at;
  }
  return candidate.id < current.id;
}

// 문제지 id마다 그 문제지가 속한 그룹의 대표 id를 매핑해 돌려준다. 대표 자신은
// 자기 id로 매핑된다. finalGroupSize는 각 대표가 대표하는 그룹 크기(1이면 단독,
// 2 이상이면 실제로 합쳐진 중복). 표시 통합(collapseDuplicatePapers)과 문항 단위
// 집계(오답노트 모아보기)가 같은 대표 선정 규칙을 공유하도록 여기서 한 번만 계산한다.
export function representativePaperIds<T extends DedupablePaper>(
  papers: T[],
  signals?: Map<string, PaperIdentitySignal>,
): { repByPaperId: Map<string, string>; finalGroupSizeByRepId: Map<string, number> } {
  const metaGroups = new Map<string, T[]>();
  for (const p of papers) {
    const key = paperDedupKey(p);
    const arr = metaGroups.get(key);
    if (arr) arr.push(p);
    else metaGroups.set(key, [p]);
  }

  const repByPaperId = new Map<string, string>();
  const finalGroupSizeByRepId = new Map<string, number>();
  for (const members of metaGroups.values()) {
    for (const subgroup of clusterSamePaper(members, signals)) {
      let best = subgroup[0];
      for (let i = 1; i < subgroup.length; i++) {
        if (isBetterRepresentative(subgroup[i], best, signals)) best = subgroup[i];
      }
      for (const m of subgroup) repByPaperId.set(m.id, best.id);
      finalGroupSizeByRepId.set(best.id, subgroup.length);
    }
  }
  return { repByPaperId, finalGroupSizeByRepId };
}

// 중복(내용까지 확인된 같은 시험지)마다 대표 1건만 남긴다. 입력 순서는 그대로
// 유지하고(정렬은 호출부 책임), 대표가 있던 자리에 대표를 둔다. 실제로 합쳐진
// (2건 이상이던) 그룹의 대표만 title에서 track 접미사를 떼어내고, 그 외에는 제목을
// 손대지 않는다.
export function collapseDuplicatePapers<T extends DedupablePaper>(
  papers: T[],
  signals?: Map<string, PaperIdentitySignal>,
): T[] {
  const { repByPaperId, finalGroupSizeByRepId } = representativePaperIds(papers, signals);

  const result: T[] = [];
  for (const p of papers) {
    if (repByPaperId.get(p.id) !== p.id) continue;
    const wasCollapsed = (finalGroupSizeByRepId.get(p.id) ?? 1) > 1;
    if (wasCollapsed && p.track) {
      result.push({ ...p, title: stripTrackFromTitle(p.title, p.track) });
    } else {
      result.push(p);
    }
  }
  return result;
}
