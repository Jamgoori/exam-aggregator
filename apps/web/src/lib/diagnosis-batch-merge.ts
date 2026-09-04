import type { DiagnosisConceptCoaching } from "@/lib/ai-diagnosis";
import { parseCoachingItems } from "@/lib/diagnosis-coach";

// 배치 경로의 "개념 1개 = 요청 1건" 규칙에서 순수 계산만 떼어 둔 것 — custom_id 를 만들고
// 되읽는 것, 흩어져 돌아온 개념별 결과를 진단 하나의 극복법으로 합치는 것.
//
// diagnosis-batch.ts 에서 분리한 이유는 테스트다. 그 파일은 supabase admin 클라이언트와
// Anthropic 클라이언트를 붙잡고 있어 node --test 에서 그대로 부르기 어렵고, 정작 사고가
// 나는 자리는 여기다: custom_id 를 잘못 되읽으면 남의 진단에 극복법이 붙고, 합치기가
// 어긋나면 개념 순서가 뒤바뀌거나 절반만 저장된다 — 그것도 제출 몇 분 뒤 수거 시점에.

// 진단 하나에 실린 요청들의 custom_id. 진단 행 id 뒤에 개념 순번을 붙인다.
//
// 구분자가 '_' 인 이유: custom_id 는 영숫자·'_'·'-' 만 허용되고(64자 이내), 진단 행 id 는
// UUID 라 '-' 는 들어 있지만 '_' 는 없다. 그래서 마지막 '_' 뒤가 곧 순번이다.
export function batchCustomId(diagnosisId: string, index: number): string {
  return `${diagnosisId}_${index}`;
}

// custom_id → (진단 행 id, 개념 순번). 순번이 없으면 null — 이 설계 이전에 낸 배치는
// 진단 하나가 요청 하나였고 custom_id 가 진단 행 id 그대로였다. 배포 시점에 처리 중이던
// 그 배치도 수거해야 하므로 두 모양을 다 읽는다.
export function parseBatchCustomId(customId: string): { prefix: string; index: number | null } {
  const at = customId.lastIndexOf("_");
  if (at < 0) return { prefix: customId, index: null };
  const suffix = customId.slice(at + 1);
  if (!/^\d+$/.test(suffix)) return { prefix: customId, index: null };
  return { prefix: customId.slice(0, at), index: Number(suffix) };
}

export type ConceptResult = {
  // 요청의 개념 순번. null 이면 구형(진단 하나 = 요청 하나) 결과라 모든 개념이 한 응답에 있다.
  index: number | null;
  // Message Batch 개별 결과의 상태.
  status: "succeeded" | "errored" | "canceled" | "expired";
  // succeeded 일 때 모델이 낸 본문(text 블록을 이어 붙인 것).
  text: string;
};

export type MergedCoaching = {
  // 화면에 저장할 극복법. 물어본 개념 순서(targets 순)대로다 — 배치 결과는 순서를
  // 보장하지 않으므로 여기서 다시 세운다.
  coaching: DiagnosisConceptCoaching[];
  // 만들지 못한 개념들과 그 이유. 비어 있으면 전부 성공.
  failures: string[];
};

// 진단 하나의 개념별 결과들을 극복법 배열 하나로 합친다.
//
// 저장 규칙은 예전(한 응답에 개념 10개)과 같다 — **유효한 것은 남기고, 하나도 없을 때만
// 실패**다. 예전에도 모델이 10개 중 9개만 제대로 쓰면 9개를 저장했다. 요청이 개념별로
// 갈라진 지금은 "한 요청이 errored 로 돌아왔다"가 그 한 개념이 빠지는 것으로 끝나고,
// 나머지 개념은 그대로 사용자에게 간다. 실패 사유는 failures 로 돌려주어 배치 행의 error
// 에 남긴다(어느 개념이 왜 빠졌는지를 로그를 뒤지지 않고 볼 수 있게).
export function mergeConceptResults(
  results: ConceptResult[],
  targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
  }[],
): MergedCoaching {
  const byIndex = new Map<number, DiagnosisConceptCoaching>();
  const failures: string[] = [];
  const answered = new Set<number>();

  for (const r of results) {
    // 이 요청이 맡은 개념. 순번이 targets 밖이면(있어서는 안 되지만) 버린다 — 모르는
    // 개념에 극복법을 붙일 수는 없다.
    const scoped = r.index == null ? targets : targets[r.index] ? [targets[r.index]] : [];
    if (scoped.length === 0) continue;
    const indices = r.index == null ? targets.map((_, i) => i) : [r.index];
    for (const i of indices) answered.add(i);

    if (r.status !== "succeeded") {
      failures.push(`${scoped.map((t) => t.concept).join(", ")}: 배치 결과가 ${r.status} 상태`);
      continue;
    }

    const parsed = parseCoachingItems(r.text, scoped);
    for (const c of parsed) {
      // 개념별 요청은 자기 순번에 그대로 붙인다 — 표시 이름으로 되찾으면 과목이 다른
      // 동명 개념(둘 다 고를 수 있다)이 한 자리에 겹친다. 구형(한 응답에 전부) 결과만
      // 이름으로 되찾는다(그때는 그 방법밖에 없다).
      const i = r.index ?? targets.findIndex((t) => t.concept === c.concept);
      if (i >= 0 && !byIndex.has(i)) byIndex.set(i, c);
    }
    for (const i of indices) {
      if (!byIndex.has(i)) failures.push(`${targets[i].concept}: 모델이 극복법을 만들지 못함`);
    }
  }

  for (const [i, t] of targets.entries()) {
    if (!answered.has(i)) failures.push(`${t.concept}: 배치 결과에 없음`);
  }

  const coaching = targets.map((_, i) => byIndex.get(i)).filter((c): c is DiagnosisConceptCoaching => !!c);
  return { coaching, failures };
}
