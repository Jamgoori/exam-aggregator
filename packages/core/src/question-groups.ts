// 세트문제(공통지문 공유) 묶기 — 웹 cbt-solver.tsx 의 questionGroups 와
// wrong-note-question-card.tsx 의 groupRowsBySharedImages 가 각자 들고 있던 같은 규칙을
// 한 곳에 둔다(설계서 §4.5 #22 "세트 묶기").
//
// 근거: 크롭 스크립트가 세트에 속한 문제들에 **완전히 같은 이미지 경로 배열**을 저장한다.
// 그래서 바이트를 비교할 필요 없이 "연속된 번호의 이미지 배열이 원소까지 동일한가"만 보면
// 같은 세트다. 이미지가 없는 문항(빈 배열)은 절대 묶지 않는다 — 크롭 전 문제지에서
// 전 문항이 한 세트로 뭉치는 것을 막는다.

export function haveSameImages(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((src, i) => src === b[i]);
}

// 문제번호 → 그 번호가 속한 세트의 번호 목록(오름차순, 자기 자신 포함). 세트가 아니면
// [n] 하나. 1..totalQuestions 모든 번호가 키로 들어간다(이미지가 없는 번호도 [n]).
export function groupQuestionsBySharedImages(
  totalQuestions: number,
  questionImages: Readonly<Record<number, readonly string[] | undefined>>,
): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  let i = 1;
  while (i <= totalQuestions) {
    const images = questionImages[i] ?? [];
    let end = i;
    while (end + 1 <= totalQuestions && haveSameImages(images, questionImages[end + 1] ?? [])) {
      end++;
    }
    const numbers: number[] = [];
    for (let n = i; n <= end; n++) numbers.push(n);
    for (const n of numbers) groups.set(n, numbers);
    i = end + 1;
  }
  return groups;
}

// 오답노트 카드용: 순서대로 늘어놓은 행들 중 앞 행과 이미지가 같은 행을 한 카드로 합친다.
// (같은 지문을 두 번 그리지 않기 위함.) 이미지가 없는 행은 앞 행과 절대 합쳐지지 않는다.
export function groupRowsBySharedImages<T extends { images: string[] }>(
  items: readonly T[],
): { images: string[]; rows: T[] }[] {
  const groups: { images: string[]; rows: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && haveSameImages(last.images, item.images)) {
      last.rows.push(item);
    } else {
      groups.push({ images: item.images, rows: [item] });
    }
  }
  return groups;
}
