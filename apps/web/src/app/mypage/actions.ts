"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";
import {
  requestWeeklyDiagnosis,
  getLastAnalyzedDate,
  analysisWindowDays,
  DIAGNOSIS_CYCLE_DAYS,
} from "@/lib/ai-diagnosis";
import { runDiagnosisForUser } from "@/lib/diagnosis-generate";
import {
  getExcludedDiagnosisSubjectSlugs,
  setDiagnosisSubjectPaused,
} from "@/lib/review-preferences";
import { isPremium } from "@/lib/membership";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";

export type RequestDiagnosisResult = {
  error?: string;
  status?: "ready" | "pending";
};

// 진단에서 분석할 과목 켜기/끄기. 맞춤 극복법은 과목당 7개·전체 20개 개념까지만
// 만들어서(개념 수 = 요금), 준비하지 않는 과목이 그 자리를 차지하면 정작 필요한 과목이
// 얕아진다. 저장만 하고 생성은 하지 않는다 — 고르는 동안 요금이 나가면 안 된다.
export async function toggleDiagnosisSubject(
  subjectId: string,
  include: boolean,
): Promise<{ error?: string; excludedSubjectIds?: string[] }> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!isDiagnosisDevAllowed(user.email)) return { error: "AI 약점 진단은 아직 준비 중이에요." };

  const res = await setDiagnosisSubjectPaused(supabase, user.id, subjectId, !include);
  if (res.error) return { error: res.error };
  revalidatePath("/mypage/diagnosis");
  return { excludedSubjectIds: res.pausedSubjectIds };
}

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

  const res = await requestWeeklyDiagnosis(supabase, user.id);
  if (res.error) return res;

  // 이미 이번 주 리포트가 있으면(주 1회) 그대로 둔다.
  if (res.status === "ready") {
    revalidatePath("/mypage");
    revalidatePath("/mypage/diagnosis");
    return res;
  }

  // 요청 행(report=null)의 id를 찾아 온디맨드 생성. 주기가 "받은 날부터 7일"이라
  // 날짜를 특정할 수 없으므로, 주기 안의 가장 최근 행을 집는다(= 방금 만든 행이거나
  // 생성이 실패해 pending 으로 남아 있던 행).
  const since = new Date();
  since.setDate(since.getDate() - (DIAGNOSIS_CYCLE_DAYS - 1));
  const { data: row } = await supabase
    .from("ai_diagnoses")
    .select("id")
    .eq("user_id", user.id)
    .gte("diagnosis_date", since.toISOString().slice(0, 10))
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 분석 창: 마지막으로 리포트가 나온 날부터 오늘까지, 최대 2주. 9일 전에 받았으면
  // 9일치, 한 달을 쉬었어도 14일치까지만 훑는다 — 창이 곧 프롬프트 크기이자 요금이다.
  const windowDays = analysisWindowDays(await getLastAnalyzedDate(supabase, user.id));

  let status: "ready" | "pending" = "pending";
  let genError: string | undefined;
  if (row?.id) {
    try {
      const gen = await runDiagnosisForUser(
        row.id as string,
        user.id,
        windowDays,
        await getExcludedDiagnosisSubjectSlugs(supabase, user.id),
      );
      status = gen.status;
      genError = gen.error;
    } catch {
      status = "pending";
    }
  }

  revalidatePath("/mypage");
  revalidatePath("/mypage/diagnosis");
  // 생성기가 이유를 말해 주면(예: 그 기간에 틀린 게 없음) 그대로 화면에 올린다.
  return genError ? { status, error: genError } : { status };
}
