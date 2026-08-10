import { getSubjectBySlug } from "@gongmoa/core";
import { createPublicClient } from "@/lib/supabase/public";
import { renderOgCard, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "공모아 과목별 기출문제";
export const size = { width: 1200, height: 630 };
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // 카드 내용이 로그인 여부와 무관하므로 쿠키를 읽지 않는 공개 클라이언트를 쓴다.
  const subject = await getSubjectBySlug(createPublicClient(), slug);

  if (!subject) {
    return renderOgCard({
      title: "공무원 기출문제 무료 자료실",
      subtitle: "국가직 · 지방직 · 법원직 · 경찰 · 소방",
    });
  }

  return renderOgCard({
    title: `${subject.name} 기출문제 모음`,
    subtitle: "과목별 기출문제 모아보기",
    chips: ["연도별", "급수별", "정답 · 해설 무료"],
  });
}
