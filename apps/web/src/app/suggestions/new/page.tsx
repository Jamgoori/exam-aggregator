import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SuggestionForm } from "@/components/suggestion-form";
import { getSuggestionViewer } from "@/lib/suggestions";

export const metadata: Metadata = {
  title: "건의하기",
  robots: { index: false, follow: false },
};

export default async function NewSuggestionPage() {
  const viewer = await getSuggestionViewer();
  // 글쓰기는 로그인 회원만 — 비밀글의 "본인"을 특정할 수 있어야 한다.
  // 로그인 후 이 화면으로 돌아오게 next 를 실어 보낸다.
  if (!viewer.loggedIn) redirect(`/login?next=${encodeURIComponent("/suggestions/new")}`);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href="/suggestions"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 건의게시판
      </Link>

      <h1 className="text-2xl font-bold">건의하기</h1>

      <SuggestionForm isAdmin={viewer.isAdmin} />
    </div>
  );
}
