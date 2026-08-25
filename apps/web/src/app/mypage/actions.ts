"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";
import { requestTodayDiagnosis, kstToday } from "@/lib/ai-diagnosis";
import { runDiagnosisForUser } from "@/lib/diagnosis-generate";
import { isPremium } from "@/lib/membership";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";

export type RequestDiagnosisResult = {
  error?: string;
  status?: "ready" | "pending";
};

// "AI 약점 진단 받기" 버튼. 자격을 확인하고 오늘 진단 요청(report=null 행)을 만든 뒤,
// 그 자리에서 온디맨드 AI로 맞춤 극복법을 생성해 채운다. 생성에 실패하면(키 미설정·API
// 오류) 요청 행만 남겨 pending으로 두고 배치 생성기가 나중에 채우게 한다.
export async function requestDiagnosis(): Promise<RequestDiagnosisResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 개발 중 임시 게이트: 이 계정 외에는 AI 호출 자체를 막는다.
  if (!isDiagnosisDevAllowed(user.email)) {
    return { error: "AI 약점 진단은 아직 준비 중이에요." };
  }

  // 진단은 멤버십 기능이다. 배너를 숨기는 것과 별개로 여기서도 막는다 — 생성은
  // AI 호출이 실제로 도는 경로라, 화면을 우회해 부르면 그대로 비용이 나간다.
  if (!(await isPremium(supabase, user.id))) {
    return { error: "AI 약점 진단은 멤버십 기능이에요." };
  }

  const res = await requestTodayDiagnosis(supabase, user.id);
  if (res.error) return res;

  // 이미 오늘 리포트가 있으면(일 1회) 그대로 둔다.
  if (res.status === "ready") {
    revalidatePath("/mypage");
    revalidatePath("/mypage/diagnosis");
    return res;
  }

  // 요청 행(report=null)의 id를 찾아 온디맨드 생성.
  const { data: row } = await supabase
    .from("ai_diagnoses")
    .select("id")
    .eq("user_id", user.id)
    .eq("diagnosis_date", kstToday())
    .maybeSingle();

  let status: "ready" | "pending" = "pending";
  if (row?.id) {
    try {
      const gen = await runDiagnosisForUser(row.id as string, user.id);
      status = gen.status;
    } catch {
      status = "pending";
    }
  }

  revalidatePath("/mypage");
  revalidatePath("/mypage/diagnosis");
  return { status };
}
