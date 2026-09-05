import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMixSessionWrongNote } from "@/lib/mix-practice";
import { MixSessionView } from "@/components/mix-session-view";
import { subjectColor } from "@/lib/subject-colors";
import { isPremium } from "@/lib/membership";
import { MembershipUpsell } from "@/components/membership-upsell";
import { KST_TIME_ZONE } from "@gongmoa/core";

// 기출 섞어풀기 한 세션의 오답노트("9월 5일 섞어풀기"). 과목 오답노트의 문제지
// 카드와 같은 층위의 화면이다 — 문제지 한 장 대신 그날 섞어 푼 문항 묶음이 단위일 뿐,
// 틀린 문항·정답·해설·메모·다시 풀기가 같은 모양으로 붙는다.
export default async function MixSessionWrongNotePage({
  params,
}: {
  params: Promise<{ slug: string; sessionId: string }>;
}) {
  const { slug, sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}/mix/${sessionId}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  // 오답노트는 무료다. 멤버십은 해설 본문을 내려보낼지 정하는 데만 쓴다.
  const premium = await isPremium(supabase, user.id);
  const note = await getMixSessionWrongNote(supabase, user.id, sessionId, premium);
  if (!note || note.subject.slug !== slug) notFound();

  const { session, subject, questions, wrongCount, resolvedCount } = note;
  const pct = session.total > 0 ? Math.round((session.score / session.total) * 100) : 0;
  const when = new Date(session.createdAt).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const self = `/mypage/wrong-notes/${slug}/mix/${sessionId}`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Link
          href={`/mypage/wrong-notes/${slug}`}
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← {subject.name} 오답노트로
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}>
            {subject.name}
          </span>
          <span className="flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <Shuffle size={11} />
            기출 섞어풀기
          </span>
        </div>
        <h1 className="text-2xl font-semibold leading-snug">{session.title}</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">{when} 풀이</p>
      </div>

      {/* 점수 요약 — 과목 오답노트 상단 요약 바와 같은 문법(빨강=남은 오답, 초록=극복). */}
      <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
        <Stat label="점수" value={`${session.score}/${session.total}`} sub={`${pct}점`} color="text-zinc-700 dark:text-zinc-200" />
        <span className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Stat
          label="남은 오답"
          value={String(Math.max(0, wrongCount - resolvedCount))}
          sub="문항"
          color="text-red-600 dark:text-red-400"
        />
        <span className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Stat
          label="극복"
          value={String(resolvedCount)}
          sub="문항"
          color="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      <MixSessionView
        sessionId={session.id}
        subjectSlug={slug}
        questions={questions}
        wrongCount={wrongCount}
        resolvedCount={resolvedCount}
        lockNext={self}
      />

      {!premium && wrongCount > 0 && (
        <MembershipUpsell
          title="해설까지 보면서 복습하려면"
          description="멤버십은 문항별 해설을 볼 수 있고, 언제 다시 볼지 계산해주는 복습 일정까지 이어져요."
          next={self}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      <span className={`mt-0.5 text-2xl font-extrabold leading-none ${color}`}>
        {value}
        <span className="ml-0.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">{sub}</span>
      </span>
    </div>
  );
}
