"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signUpUser(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const nickname = String(formData.get("nickname") ?? "").trim();

  if (!nickname) {
    redirect(`/signup?error=${encodeURIComponent("닉네임을 입력해주세요")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nickname } },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (!data.session) {
    redirect(
      `/login?message=${encodeURIComponent("가입 확인 이메일을 보냈어요. 메일함을 확인해주세요")}`,
    );
  }

  redirect("/");
}

export async function signInUser(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent("이메일/비밀번호를 확인해주세요")}`);
  }

  redirect("/");
}

export async function signOutUser() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
