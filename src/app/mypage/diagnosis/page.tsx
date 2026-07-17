import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getTodayDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  type AiDiagnosisReport,
  type DiagnosisSubjectTrend,
} from "@/lib/ai-diagnosis";

// AI 약점 진단 리포트 페이지. 오늘 리포트가 있으면 그걸, 없고 지난 리포트가 있으면
// 그걸 보여준다. 아직 아무것도 없으면 상태에 맞는 안내.
export default async function DiagnosisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent("/mypage/diagnosis")}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const today = await getTodayDiagnosis(supabase, user.id);
  let report: AiDiagnosisReport | null = today?.report ?? null;
  let date = today?.date ?? null;
  let stale = false;

  if (!report) {
    const latest = await getLatestReadyDiagnosis(supabase, user.id);
    if (latest) {
      report = latest.report;
      date = latest.date;
      stale = true;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 pt-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/mypage?tab=wrong-notes"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 오답노트로
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles size={20} className="text-violet-600 dark:text-violet-400" />
          AI 약점 진단
        </h1>
        {date && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {date} 기준{stale ? " · 오늘 진단은 준비되면 여기 표시돼요" : ""}
          </p>
        )}
      </div>

      {!report ? (
        <EmptyState supabase={supabase} userId={user.id} pending={today?.status === "pending"} />
      ) : (
        <Report report={report} />
      )}
    </div>
  );
}

async function EmptyState({
  supabase,
  userId,
  pending,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  pending: boolean;
}) {
  if (pending) {
    return (
      <p className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-8 text-center text-sm text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-200">
        오늘 진단을 준비하고 있어요. 분석이 끝나면 여기에 리포트가 표시돼요(보통 하루 안).
      </p>
    );
  }
  const eligibility = await getDiagnosisEligibility(supabase, userId);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-8 text-center dark:border-zinc-700">
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        {eligibility.eligible
          ? "아직 받은 진단이 없어요. 오답노트에서 진단을 받아보세요."
          : (eligibility.hint ?? "조금 더 풀면 진단을 받을 수 있어요.")}
      </p>
      <Link
        href="/mypage?tab=wrong-notes"
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700"
      >
        오답노트로 가기
      </Link>
    </div>
  );
}

function trendIcon(trend: DiagnosisSubjectTrend["trend"]) {
  if (trend === "up")
    return <TrendingUp size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (trend === "down")
    return <TrendingDown size={15} className="shrink-0 text-red-600 dark:text-red-400" />;
  return <Minus size={15} className="shrink-0 text-zinc-400 dark:text-zinc-600" />;
}

function Report({ report }: { report: AiDiagnosisReport }) {
  return (
    <div className="flex flex-col gap-6">
      {report.summary && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-violet-900 dark:text-violet-200">
            <Sparkles size={15} /> 오늘의 진단 요약
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {report.summary}
          </p>
        </div>
      )}

      {report.weakConcepts?.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold">취약 개념</h2>
          {report.weakConcepts.map((c, i) => (
            <div
              key={`${c.concept}-${i}`}
              className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-700"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {i + 1}. {c.concept}
                </span>
                {c.subject && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">{c.subject}</span>
                )}
                {(c.wrongCount != null || c.resolvedCount != null) && (
                  <span className="ml-auto text-xs font-medium text-violet-700 dark:text-violet-400">
                    {c.wrongCount != null ? `오답 ${c.wrongCount}` : ""}
                    {c.resolvedCount != null ? ` · 극복 ${c.resolvedCount}` : ""}
                  </span>
                )}
              </div>
              {c.subjectSlug && (
                <Link
                  href={`/mypage/wrong-notes/${c.subjectSlug}?view=questions`}
                  className="mt-2 inline-block rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-900/30"
                >
                  이 과목 틀린 문항 모아보기 →
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {report.subjectTrends?.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="mb-1 text-sm font-bold">과목별 흐름</h2>
          {report.subjectTrends.map((t, i) => (
            <div
              key={`${t.subject}-${i}`}
              className="flex items-start gap-2 border-b border-zinc-100 py-2.5 text-sm last:border-none dark:border-zinc-700"
            >
              {trendIcon(t.trend)}
              <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
                <span className="font-bold">{t.subject}</span> — {t.note}
              </p>
            </div>
          ))}
        </section>
      )}

      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        진단은 하루 1회예요. 오답노트 상단의 &lsquo;진단 받기&rsquo;로 새로 요청할 수 있어요.
      </p>
    </div>
  );
}
