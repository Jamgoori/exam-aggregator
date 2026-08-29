import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DIAGNOSIS_CYCLE_DAYS } from "@/lib/ai-diagnosis";
import { ResetDiagnosisForm } from "./reset-form";

// AI 약점 진단 초기화(관리자 전용).
//
// 진단은 주 1회라 검수하려면 같은 계정으로 여러 번 돌려야 하고, "생성이 실패했는데 이번
// 주를 다 썼다"는 문의도 여기서 되돌린다. 화면은 관리자만 보지만, 실제 방어선은 서버
// 액션의 is_admin 검사다 — 이 페이지의 리다이렉트는 길 안내일 뿐이다.
export default async function AdminDiagnosisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/admin/login");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16">
      <Link href="/admin/upload" className="text-sm text-blue-600 underline dark:text-blue-400">
        ← 관리자 홈
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">AI 약점 진단 초기화</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          진단은 {DIAGNOSIS_CYCLE_DAYS}일에 1회입니다. 기록을 지우면 그 계정이 즉시 다시 받을
          수 있어요.
        </p>
      </div>
      <ResetDiagnosisForm adminEmail={user.email ?? null} />
    </div>
  );
}
