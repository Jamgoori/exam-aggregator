import { getPaperSlug } from "@gongmoa/core";

// 문제지로 가는 링크는 전부 여기를 거친다. 주소 규칙이 한 군데에만 있어야
// 링크·canonical·사이트맵·RSS 가 서로 다른 주소를 가리키는 일이 없다.
//
// 인자가 id 가 아니라 title/round 인 이유는 packages/core/src/paper-slug.ts 참고
// (주소를 DB 에 저장하지 않고 제목에서 계산한다).

// track 까지 받아야 한다 — 중복 통합이 대표 문제지의 title 에서 track 접미사를
// 떼어내므로, track 없이는 통합 대표와 원래 직류 없는 문제지가 같은 주소가 된다
// (packages/core/src/paper-slug.ts 참고).
export type PaperHrefSource = {
  title: string;
  round: number;
  track?: string | null;
};

export function paperHref(paper: PaperHrefSource): string {
  return `/papers/${encodeURIComponent(getPaperSlug(paper.title, paper.round, paper.track))}`;
}

export function paperCbtHref(paper: PaperHrefSource): string {
  return `${paperHref(paper)}/cbt`;
}

export function paperExplanationsHref(paper: PaperHrefSource): string {
  return `${paperHref(paper)}/explanations`;
}
