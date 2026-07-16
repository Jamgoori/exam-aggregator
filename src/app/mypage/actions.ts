"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";
import { requestTodayDiagnosis } from "@/lib/ai-diagnosis";

export type RequestDiagnosisResult = {
  error?: string;
  status?: "ready" | "pending";
};

// "AI 약점 진단 받기" 버튼. 자격을 확인하고 오늘 진단 요청(report=null 행)을 만든다.
// 실제 리포트 생성은 별도 생성기가 채우므로 여기서는 요청만 기록한다.
export async function requestDiagnosis(): Promise<RequestDiagnosisResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const res = await requestTodayDiagnosis(supabase, user.id);
  if (!res.error) {
    revalidatePath("/mypage");
    revalidatePath("/mypage/diagnosis");
  }
  return res;
}
