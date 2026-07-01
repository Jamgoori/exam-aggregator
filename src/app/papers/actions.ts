"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function postComment(formData: FormData) {
  const paperId = String(formData.get("paper_id") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const nickname = user
    ? ((user.user_metadata?.nickname as string | undefined) ??
      user.email?.split("@")[0] ??
      "회원")
    : String(formData.get("nickname") ?? "").trim();

  if (!content || !nickname) {
    redirect(`/papers/${paperId}?error=${encodeURIComponent("내용과 닉네임을 입력해주세요.")}`);
  }

  const { error } = await supabase.from("comments").insert({
    paper_id: paperId,
    user_id: user?.id ?? null,
    nickname,
    content,
  });

  if (error) {
    redirect(`/papers/${paperId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/papers/${paperId}`);
  redirect(`/papers/${paperId}`);
}

export async function postRating(
  paperId: string,
  score: number,
  guestToken: string | null,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("difficulty_ratings").insert({
    paper_id: paperId,
    user_id: user?.id ?? null,
    guest_token: user ? null : guestToken,
    score,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "이미 평가했어요." : error.message,
    };
  }

  revalidatePath(`/papers/${paperId}`);
  return { success: true };
}
