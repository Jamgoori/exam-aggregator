import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pin } from "lucide-react";
import { NoticeComments } from "@/components/notice-comments";
import { NoticeDeleteButton } from "@/components/notice-delete-button";
import { JsonLd } from "@/components/json-ld";
import { SITE_URL, absoluteUrl } from "@/lib/site-url";
import { countNoticeView, fetchNotice, fetchNoticeComments, getNoticeViewer } from "@/lib/notices";

// 검색 결과에 실리는 설명문. 네이버가 80자에서 잘라내므로 본문 앞머리를 그
// 길이에 맞춰 한 문단으로 눌러 담는다(줄바꿈이 남으면 스니펫이 지저분해진다).
function toDescription(content: string) {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const notice = await fetchNotice(id);
  if (!notice) return { title: "공지사항" };

  const canonical = `/notices/${notice.id}`;
  const description = toDescription(notice.content);

  return {
    title: notice.title,
    description,
    // 공지는 목록에서만 링크되는데 목록은 ?page= 로 갈라진다. 자기 주소를 정본으로
    // 못 박아 두어야 어떤 경로로 들어와도 한 주소로 색인이 모인다.
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: notice.title,
      description,
      publishedTime: notice.createdAt,
      ...(notice.updatedAt ? { modifiedTime: notice.updatedAt } : {}),
    },
  };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notice = await fetchNotice(id);
  if (!notice) notFound();

  const viewer = await getNoticeViewer();
  const [, comments] = await Promise.all([
    countNoticeView(id),
    fetchNoticeComments(id, viewer),
  ]);
  const canWrite = viewer.isAdmin;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      {/* 공지 한 건은 글 한 편이다 — 제목·작성 시각·발행 주체가 분명하니
          Article 로 표시해 두면 검색 결과에 날짜가 함께 뜨고, 빵부스러기가
          주소 대신 "공모아 > 공지사항 > 제목" 경로를 보여준다. 작성자는 항상
          운영자(관리자만 쓸 수 있는 게시판)라 Organization 을 그대로 가리킨다. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "공지사항",
                  item: absoluteUrl("/notices"),
                },
                { "@type": "ListItem", position: 3, name: notice.title },
              ],
            },
            {
              "@type": "Article",
              headline: notice.title,
              url: absoluteUrl(`/notices/${notice.id}`),
              mainEntityOfPage: absoluteUrl(`/notices/${notice.id}`),
              inLanguage: "ko-KR",
              datePublished: notice.createdAt,
              dateModified: notice.updatedAt ?? notice.createdAt,
              author: { "@id": `${SITE_URL}/#organization` },
              publisher: { "@id": `${SITE_URL}/#organization` },
              description: toDescription(notice.content),
              isAccessibleForFree: true,
            },
          ],
        }}
      />
      <Link
        href="/notices"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 공지사항
      </Link>

      <article className="flex flex-col gap-4">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
          {notice.isPinned && (
            <span className="flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <Pin size={11} />
              고정
            </span>
          )}

          <h1 className="text-xl font-bold break-words">{notice.title}</h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">
            <span>{formatDateTime(notice.createdAt)}</span>
            {notice.updatedAt && <span>(수정됨)</span>}
            <span>조회 {notice.viewCount}</span>
          </div>
        </header>

        <p className="min-h-24 text-sm leading-7 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {notice.content}
        </p>

        {canWrite && (
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/notices/${notice.id}/edit`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
            >
              수정
            </Link>
            <NoticeDeleteButton id={notice.id} />
          </div>
        )}
      </article>

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
        <NoticeComments noticeId={notice.id} comments={comments} loggedIn={viewer.loggedIn} />
      </div>
    </div>
  );
}
