import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/admin/actions";
import { UploadForm } from "./upload-form";
import type { Subject, ExamType } from "@/lib/supabase/types";

export default async function UploadPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
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
          <button type="submit" className="text-sm text-zinc-500 underline">
            로그아웃
          </button>
        </form>
      </div>
      <Link href="/admin/answers" className="text-sm text-blue-600 underline">
        CBT 정답 입력하기 →
      </Link>
      <UploadForm
        subjects={(subjects ?? []) as Subject[]}
        examTypes={(examTypes ?? []) as ExamType[]}
      />
    </div>
  );
}
