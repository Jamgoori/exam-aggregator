import { getPaperSlug } from "@gongmoa/core";

// 문제지로 가는 링크는 전부 여기를 거친다. 웹 apps/web/src/lib/paper-href.ts 와 같은 규칙 —
// 앱 라우트 경로 = 웹 URL 경로(설계서 §5)라 같은 문자열이 곧 딥링크다.
//
// 인자가 id 가 아니라 title/round 인 이유는 packages/core/src/paper-slug.ts 참고
// (주소를 DB 에 저장하지 않고 제목에서 계산한다). track 까지 받아야 한다 — 중복 통합이
// 대표 문제지의 title 에서 track 접미사를 떼어내므로, track 없이는 통합 대표와 원래
// 직류 없는 문제지가 같은 주소가 된다.
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
