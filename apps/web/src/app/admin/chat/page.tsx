import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClearChatForm } from "./clear-form";

// 채팅 기록 초기화(관리자 전용).
//
// 채팅방은 공개된 공간이라 비방·개인정보·도배가 올라오면 지울 수단이 필요하다. 화면은
// 관리자만 보지만, 실제 방어선은 서버 액션의 is_admin 검사다 — 이 페이지의 리다이렉트는
// 길 안내일 뿐이다(진단 초기화 화면과 같은 규칙).
export default async function AdminChatPage() {
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
        <h1 className="text-2xl font-semibold">채팅 기록 초기화</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          채팅방 전체를 비우거나, 특정 계정이 남긴 메시지만 지울 수 있어요. 지운 메시지는
          되돌릴 수 없고, 열려 있는 채팅창에서도 바로 사라져요.
        </p>
      </div>
      <ClearChatForm />
    </div>
  );
}
