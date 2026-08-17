import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SuggestionForm } from "@/components/suggestion-form";
import { fetchSuggestion, getSuggestionViewer } from "@/lib/suggestions";

export const metadata: Metadata = {
  title: "건의 수정",
  robots: { index: false, follow: false },
};

export default async function EditSuggestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getSuggestionViewer();
  const result = await fetchSuggestion(id, viewer);

  if (result.status === "not_found") notFound();
  // 볼 수 없는 글(남의 비밀글)은 수정 화면도 없다. 본인 글이면 로그인부터.
  if (result.status === "forbidden") {
    if (!viewer.loggedIn) {
      redirect(`/login?next=${encodeURIComponent(`/suggestions/${id}/edit`)}`);
    }
    redirect(`/suggestions/${id}`);
  }
  // 수정 권한은 서버 액션이 다시 검사한다 — 여기 검사는 화면을 안 보여주기 위한 것.
  if (!result.suggestion.canEdit) redirect(`/suggestions/${id}`);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href={`/suggestions/${id}`}
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 돌아가기
      </Link>

      <h1 className="text-2xl font-bold">건의 수정</h1>

      <SuggestionForm
        suggestion={{
          id: result.suggestion.id,
          title: result.suggestion.title,
          content: result.suggestion.content,
          isSecret: result.suggestion.isSecret,
          isPinned: result.suggestion.isPinned,
        }}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
