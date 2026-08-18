import { getPaperDisplayTitle } from "@gongmoa/core";
import { createPublicClient } from "@/lib/supabase/public";
import { resolvePaperId } from "@/lib/paper-slug-map";
import { renderOgCard, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "공모아 기출문제";
export const size = { width: 1200, height: 630 };
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 주소 조각은 이제 제목 기반 slug 다("2019-국가직-9급-영어"). 그대로 id 열에
  // 넣으면 UUID 가 아니라 조회가 실패해, 모든 문제지가 사이트 대표 카드로 나갔다
  // (실측: 서로 다른 문제지의 opengraph-image 응답 바이트가 완전히 동일했다).
  // 옛 UUID 주소도 그대로 통과시켜야 하므로 표를 거쳐 id 로 바꾼다.
  const paperId = await resolvePaperId(id);

  // 로그인 여부와 무관하게 같은 카드를 그리므로 쿠키를 읽는 서버 클라이언트 대신
  // 무상태 공개 클라이언트를 쓴다 (상세페이지 본문의 getPaper 와 캐시를 공유하지
  // 않는 별도 라우트라 어차피 따로 한 번 조회한다).
  const supabase = createPublicClient();
  const { data: paper } = paperId
    ? await supabase
        .from("exam_papers")
        .select("title, track, question_count, subjects(name)")
        .eq("id", paperId)
        .single<{
          title: string;
          track: string | null;
          question_count: number | null;
          subjects: { name: string } | null;
        }>()
    : { data: null };

  // 없는 문제지라도 이미지 라우트가 깨지면 안 된다 — 상세페이지 쪽에서 notFound()가
  // 나므로 여기서는 사이트 대표 카드로 대신한다.
  if (!paper) {
    return renderOgCard({
      title: "공무원 기출문제 무료 자료실",
      subtitle: "국가직 · 지방직 · 법원직 · 경찰 · 소방",
    });
  }

  // 제목에 이미 "2026 지방직 9급 국어"처럼 연도·시행처·급수·과목이 다 들어 있어서
  // 칩에 같은 정보를 또 넣지 않는다.
  return renderOgCard({
    title: getPaperDisplayTitle(paper.title, paper.track),
    subtitle: "기출문제 · 정답 · 해설",
    chips: [
      ...(paper.subjects ? [paper.subjects.name] : []),
      ...(paper.question_count ? [`${paper.question_count}문항`] : []),
      "무료 열람",
    ],
  });
}
