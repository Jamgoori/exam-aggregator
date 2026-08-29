import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/admin/actions";
import { UploadForm } from "./upload-form";
import type { Subject, ExamType } from "@gongmoa/core";

export default async function UploadPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  // 로그인만 한 일반 계정이 관리자 화면을 열어보지 못하게 막는다 (데이터 쓰기는
  // 어차피 RLS가 막지만, 관리자 UI 자체를 노출할 이유가 없다).
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    redirect("/");
  }

  const [{ data: subjects }, { data: examTypes }] = await Promise.all([
    supabase.from("subjects").select("*").order("display_order"),
    supabase.from("exam_types").select("*").order("name"),
  ]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">기출문제 업로드</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline dark:text-zinc-500">
            로그아웃
          </button>
        </form>
      </div>
      <Link href="/admin/answers" className="text-sm text-blue-600 underline dark:text-blue-400">
        CBT 정답 입력하기 →
      </Link>
      <Link
        href="/admin/explanations"
        className="text-sm text-blue-600 underline dark:text-blue-400"
      >
        미검증 해설 검수하기 →
      </Link>
      <Link
        href="/admin/reports"
        className="text-sm text-blue-600 underline dark:text-blue-400"
      >
        문항 오류 신고 확인하기 →
      </Link>
      <Link
        href="/admin/diagnosis"
        className="text-sm text-blue-600 underline dark:text-blue-400"
      >
        AI 약점 진단 초기화하기 →
      </Link>
      <UploadForm
        subjects={(subjects ?? []) as Subject[]}
        examTypes={(examTypes ?? []) as ExamType[]}
      />
    </div>
  );
}
