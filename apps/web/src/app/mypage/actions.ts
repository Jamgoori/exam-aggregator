"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";
import {
  requestWeeklyDiagnosis,
  normalizeConceptSelection,
  DIAGNOSIS_CYCLE_DAYS,
  type DiagnosisConceptSelection,
} from "@/lib/ai-diagnosis";
import { runDiagnosisForUser } from "@/lib/diagnosis-generate";
import {
  collectDiagnosisBatches,
  getPendingDiagnosisBatch,
  submitPendingDiagnoses,
} from "@/lib/diagnosis-batch";
import { getExcludedDiagnosisSubjectSlugs } from "@/lib/review-preferences";
import { isPremium } from "@/lib/membership";

export type RequestDiagnosisResult = {
  error?: string;
  // ready   — 이번 주기 리포트가 이미 있다(그대로 보여준다)
  // queued  — 배치에 실렸다. 결과는 몇 분 뒤 진단 페이지에 뜬다
  // pending — 요청 행은 있는데 배치에 싣지 못했다(사유는 error)
  status?: "ready" | "queued" | "pending";
};

// "맞춤 극복법 받기" 버튼. 화면에서 체크한 개념들을 받아 자격을 확인하고 이번 주기 진단 요청(report=null 행)을 만든 뒤,
// 맞춤 극복법을 Message Batches API 에 실어 보낸다(요금 절반·비동기). 결과는 크론이나
// 진단 페이지 진입이 수거해 report 를 채우고, 그때까지 화면에는 무AI 데이터층이 그대로
// 떠 있는다. 배치에 싣지 못하면 요청 행만 pending 으로 남아 다음 크론이 다시 시도한다.
export async function requestDiagnosis(
  // 사용자가 체크한 개념들. 이 목록만 코칭한다(빈 배열이면 생성기가 알아서 고른다).
  // 서버가 다시 상한까지 자른다 — 화면을 우회한 호출이 그대로 요금이 되면 안 된다.
  selectedConcepts: DiagnosisConceptSelection[] = [],
): Promise<RequestDiagnosisResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 진단은 멤버십 기능이다. 배너를 숨기는 것과 별개로 여기서도 막는다 — 생성은
  // AI 호출이 실제로 도는 경로라, 화면을 우회해 부르면 그대로 비용이 나간다.
  if (!(await isPremium(supabase, user.id))) {
    return { error: "AI 약점 진단은 멤버십 기능이에요." };
  }

  const selected = normalizeConceptSelection(selectedConcepts);
  const res = await requestWeeklyDiagnosis(supabase, user.id, selected);
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
    .select("id, selected_concepts")
    .eq("user_id", user.id)
    .gte("diagnosis_date", since.toISOString().slice(0, 10))
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 기본 경로는 배치(Message Batches API)다. 주 1회짜리 기능이라 몇 분 늦게 와도 되고
  // 요금이 절반이며, 서버리스 함수가 모델 응답을 기다리지 않아 타임아웃과도 싸우지
  // 않는다. 결과는 크론(api/cron/diagnosis)이나 진단 페이지 진입이 수거한다.
  //
  // ANTHROPIC_DIAGNOSIS_SYNC=1 이면 예전처럼 그 자리에서 만든다 — 운영 중 결과를 바로
  // 확인해야 할 때의 탈출구다(요금은 2배).
  let status: RequestDiagnosisResult["status"] = "pending";
  let genError: string | undefined;
  if (row?.id) {
    if (process.env.ANTHROPIC_DIAGNOSIS_SYNC === "1") {
      try {
        // 분석 창은 생성기가 정한다 — 언제나 최근 7일(DIAGNOSIS_WINDOW_DAYS)이다.
        const gen = await runDiagnosisForUser(
          row.id as string,
          user.id,
          // 개념을 직접 골랐으면 과목 제외 설정은 볼 필요가 없다(선택이 과목까지 정한다).
          selected.length > 0
            ? new Set<string>()
            : await getExcludedDiagnosisSubjectSlugs(supabase, user.id),
          // 방금 저장한 선택이 정본이다(요청 행에 박혀 있고 배치도 같은 값을 읽는다).
          (row.selected_concepts as DiagnosisConceptSelection[] | null) ?? null,
        );
        status = gen.status;
        genError = gen.error;
      } catch {
        status = "pending";
      }
    } else {
      const res = await submitPendingDiagnoses({ userId: user.id });
      status = res.submitted > 0 ? "queued" : "pending";
      // 제출이 0건인 데는 이유가 있다(그 기간에 오답이 없다·이미 배치에 실려 있다).
      // 앞의 것은 사용자가 고칠 수 있으니 그대로 올리고, 뒤의 것은 오류가 아니다.
      genError = res.submitted > 0 ? undefined : res.error;
    }
  }

  revalidatePath("/mypage");
  revalidatePath("/mypage/diagnosis");
  // 생성기가 이유를 말해 주면(예: 그 기간에 틀린 게 없음) 그대로 화면에 올린다.
  return genError ? { status, error: genError } : { status };
}

// 극복법이 다 만들어졌는지 묻는다(진단 화면이 생성 중일 때 주기적으로 부른다).
//
// 왜 페이지를 통째로 새로 그리지 않고 이 액션을 따로 두는가: 진단 페이지 렌더는 계정
// 전체 오답을 훑는 집계를 포함해서, 20초마다 그걸 다시 돌리면 대기 중인 사용자 한 명이
// 서버를 계속 두드리는 꼴이 된다. 여기서는 배치 상태만 보고(끝났으면 결과를 수거하고),
// 화면은 **끝난 그 순간 딱 한 번** 새로 그린다 — 그래서 결과가 하나씩 붙는 게 아니라
// 전부 한 번에 나타난다.
//
// 수거(collectDiagnosisBatches)는 토큰 요금이 없는 조회 API다. 자기 배치가 진행 중일
// 때만 도므로, 남의 진단을 건드리거나 없는 요청에 요금을 태울 여지가 없다.
export async function checkDiagnosisProgress(): Promise<{ generating: boolean }> {
  const { user } = await getSessionUser();
  if (!user) return { generating: false };

  if (!(await getPendingDiagnosisBatch(user.id))) return { generating: false };
  await collectDiagnosisBatches({ userId: user.id });
  return { generating: (await getPendingDiagnosisBatch(user.id)) != null };
}
