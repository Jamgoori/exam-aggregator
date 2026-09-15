import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

// 합치는 계산(키·그룹핑·대표 선정)은 @gongmoa/core 로 단일화(모바일과 공유). 이 파일에는
// 정답 대조에 필요한 service_role 조회만 남는다 — paper_answers 는 RLS 로 일반 사용자
// SELECT 가 막혀 있어 서버에서만 읽을 수 있기 때문이다(docs/agents/dedup-papers.md).
export {
  collapseDuplicatePapers,
  collidingPaperIds,
  paperDedupKey,
  representativePaperIds,
  type DedupablePaper,
  type PaperIdentitySignal,
} from "@gongmoa/core";

import type { PaperIdentitySignal } from "@gongmoa/core";
import { fetchPaperIdentitySignals as fetchPaperIdentitySignalsData } from "@gongmoa/core/server";

// 겹칠 수 있는 문제지들의 내용 신호(문항 수 + 정답 지문)를 모은다. 조회 본문은
// packages/core/src/data/dedup-signals.ts 로 옮겼다(Edge review-submit 의 되짚기도 같은
// 함수를 쓴다). 정답 "내용"은 클라이언트로 나가지 않고, 서버에서 두 문제지가 같은지
// 비교하는 데만 쓴다. service_role 키가 없는 환경에서는 정답 대조를 조용히 건너뛰고
// 문항 수만 쓴다.
export async function fetchPaperIdentitySignals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<Map<string, PaperIdentitySignal>> {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }
  return fetchPaperIdentitySignalsData(supabase, paperIds, admin);
}
