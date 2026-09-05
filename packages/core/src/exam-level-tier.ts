// 급수 없는 시험을 "몇 급 수준"으로 묶는 규칙 — 웹·모바일 공유(순수 함수).
//
// `exam_papers.level` 은 9급·7급처럼 급수가 있는 시행처에만 채워진다. 경찰(순경)·
// 해경·소방·계리직은 계급직이라 급수 자체가 없어 null 이다. 그런데 기출 섞어풀기처럼
// **난도로 범위를 좁히는** 화면에서는 그 null 들이 "급수 없음" 한 칸에 뭉쳐, 정작
// 순경 준비생이 자기 시험을 고를 수 없게 된다(9급 칩은 자기 것이 아니라고 읽고,
// "급수 없음" 칩은 소방·계리직·승진시험까지 한 덩어리다).
//
// 그래서 표시·필터 단계에서만 난도 등급을 부여한다. **DB 의 level 을 채워 넣지 말 것** —
// 업로드 시점의 사실 기록이고, 경찰 문제지에 "9급"을 써 넣으면 제목·배지·과목명 규칙
// (subject-label.ts 는 "시행처 급수" 키로 갈린다)까지 조용히 어긋난다.
//
// 등급 판단 근거(수험 시장의 통용 구분이자 채용 요건):
//   순경·소방사·해경 순경 공채/경채, 계리직 → 9급 상당
//   경찰·소방 간부후보생 → 7급 상당 (대졸 수준, 과목·난도가 공채와 다르다)
//   승진시험(소방위 승진 등) → 어느 채용 급수와도 대응되지 않는다. 묶지 않고 "기타"로 둔다.
//
// 새 시행처를 넣을 때는 반드시 실제 채용 요건을 확인할 것. 모르면 넣지 않는다 —
// 틀린 등급으로 묶이면 9급 준비생 세션에 7급 문항이 조용히 섞인다.

export type ExamLevelTierInput = {
  // exam_papers.level (있으면 그대로 등급이 된다).
  level: string | null | undefined;
  // exam_types.name — "경찰"·"소방"·"해경"·"계리직" 등.
  examTypeName: string | null | undefined;
  // exam_papers.track — "간부후보"·"소방위 승진" 등. 같은 시행처 안에서 등급을 가른다.
  track?: string | null;
};

// 급수 없는 시행처의 기본 등급.
const TIER_BY_EXAM_TYPE: Record<string, string> = {
  경찰: "9급",
  해경: "9급",
  소방: "9급",
  계리직: "9급",
};

// 직류(track)에 이 말이 들어 있으면 등급이 갈린다. 부분 일치로 본다 — 같은 뜻을
// "간부후보"·"간부후보생"처럼 조금씩 다르게 적어 왔다.
const CADET_TRACK = "간부후보";
const PROMOTION_TRACK = "승진";

// 문제지 하나의 난도 등급. 등급을 매길 수 없으면 null(화면에서 "기타"로 묶인다).
export function examLevelTier(paper: ExamLevelTierInput): string | null {
  const level = paper.level?.trim();
  // 급수가 적혀 있으면 그게 곧 등급이다(국회직 8급·군무원 7급 등).
  if (level) return level;

  const type = paper.examTypeName?.trim();
  if (!type) return null;
  const track = paper.track ?? "";

  // 승진시험은 채용 급수와 대응되지 않는다 — 9급으로 묶으면 승진 대상자용 문항이
  // 순경 준비생 세션에 섞인다.
  if (track.includes(PROMOTION_TRACK)) return null;
  if (track.includes(CADET_TRACK)) {
    // 간부후보는 급수 없는 시행처에서만 7급 상당으로 본다(급수가 적힌 문제지는 위에서
    // 이미 돌아갔다).
    return TIER_BY_EXAM_TYPE[type] ? "7급" : null;
  }
  return TIER_BY_EXAM_TYPE[type] ?? null;
}

// 그 등급이 "실제 급수"인지 "급수 없는 시험을 묶은 것"인지. 화면이 라벨에 "수준"을
// 붙일지 정하는 데 쓴다 — 경찰 준비생에게 "9급"은 자기 시험이 아니라는 신호로 읽히고,
// "9급 수준"은 포함 신호로 읽힌다.
export function isApproxLevelTier(paper: ExamLevelTierInput): boolean {
  return !paper.level?.trim() && examLevelTier(paper) !== null;
}
