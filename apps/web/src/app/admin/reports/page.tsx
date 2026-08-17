import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout, setQuestionReportStatus } from "@/app/admin/actions";
import { paperHref, type PaperHrefSource } from "@/lib/paper-href";
import type {
  QuestionReportContext,
  QuestionReportReason,
} from "@/app/papers/actions";

const REASON_LABELS: Record<QuestionReportReason, string> = {
  wrong_answer: "정답 오류",
  wrong_explanation: "해설 오류",
  image_issue: "이미지/표시 오류",
  other: "기타",
};

const CONTEXT_LABELS: Record<QuestionReportContext, string> = {
  explanation: "해설",
  cbt: "온라인응시",
};

type ReportRow = {
  id: string;
  question_number: number;
  context: QuestionReportContext;
  reason: QuestionReportReason;
  message: string | null;
  status: "open" | "resolved";
  created_at: string;
  user_id: string;
  exam_papers: (PaperHrefSource & { id: string }) | null;
};

const PAGE_LIMIT = 200;

// 해설/CBT 화면의 "오류 신고" 버튼이 쌓은 신고를 모아 보는 관리자 전용 화면.
// question_reports는 RLS가 본인 것 또는 admin만 select 하게 막아뒀으므로, 여기
// 목록이 곧 "신고 전체를 볼 수 있는 유일한 화면"이다 — 일반 회원은 자기 신고조차
// 목록으로 볼 곳이 없다(제출 즉시 접수 확인만 받고 끝).
export default async function QuestionReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status: "open" | "resolved" | "all" =
    statusParam === "resolved" || statusParam === "all" ? statusParam : "open";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/admin/login");
  }

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    redirect("/");
  }

  let query = supabase
    .from("question_reports")
    .select(
      "id, question_number, context, reason, message, status, created_at, user_id, exam_papers!inner(id, title, round, track)",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (status !== "all") query = query.eq("status", status);

  const { data: rowsRaw } = await query;
  const rows = (rowsRaw ?? []) as unknown as ReportRow[];

  // 닉네임은 신고자 상관관계 확인용 — profiles RLS가 admin에게도 select를 열어줘야
  // 조회된다(schema.sql "select own profile" 정책 참고).
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profileRows } =
    userIds.length > 0
      ? await supabase.from("profiles").select("user_id, nickname").in("user_id", userIds)
      : { data: [] as { user_id: string; nickname: string }[] };
  const nicknameByUser = new Map((profileRows ?? []).map((p) => [p.user_id, p.nickname]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">문항 오류 신고</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline dark:text-zinc-500">
            로그아웃
          </button>
        </form>
      </div>

      <Link href="/admin/upload" className="text-sm text-blue-600 underline dark:text-blue-400">
        ← 문제 업로드로 돌아가기
      </Link>

      <div className="flex gap-1.5">
        {(
          [
            { key: "open", label: "미해결" },
            { key: "resolved", label: "해결됨" },
            { key: "all", label: "전체" },
          ] as const
        ).map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/reports?status=${tab.key}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              status === tab.key
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
        {rows.length === 0 && (
          <p className="p-4 text-sm text-zinc-500 dark:text-zinc-500">
            {status === "open" ? "미해결 신고가 없습니다." : "신고가 없습니다."}
          </p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {CONTEXT_LABELS[r.context]}
              </span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
                {REASON_LABELS[r.reason]}
              </span>
              <span className="text-zinc-400 dark:text-zinc-600">
                {new Date(r.created_at).toLocaleString("ko-KR")}
              </span>
              <span className="text-zinc-400 dark:text-zinc-600">
                · 신고자 {nicknameByUser.get(r.user_id) ?? "알 수 없음"}
              </span>
            </div>

            {r.exam_papers ? (
              <Link
                href={paperHref(r.exam_papers)}
                target="_blank"
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {r.exam_papers.title} · {r.question_number}번
              </Link>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-600">
                삭제된 문제지 · {r.question_number}번
              </p>
            )}

            {r.message && (
              <p className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                {r.message}
              </p>
            )}

            <form
              action={async () => {
                "use server";
                await setQuestionReportStatus(r.id, r.status === "open" ? "resolved" : "open");
              }}
            >
              <button
                type="submit"
                className={`self-start rounded-lg px-3 py-1 text-xs font-medium ${
                  r.status === "open"
                    ? "bg-zinc-800 text-white dark:bg-zinc-700"
                    : "border border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-500"
                }`}
              >
                {r.status === "open" ? "해결됨으로 표시" : "미해결로 되돌리기"}
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
