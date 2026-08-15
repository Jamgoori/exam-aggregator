import Link from "next/link";
import { Lock } from "lucide-react";

// 무료 회원의 오답노트에서 해설 자리에 들어가는 잠금 카드.
//
// 오답노트 열람 자체는 무료다(내가 틀린 문제 목록·이미지·정답은 그대로 보인다).
// 해설만 멤버십으로 두는데, 그 자리를 통째로 비워 두면 "이 문항은 해설이 없다"로
// 읽혀서 무엇을 못 보고 있는지 알 수 없다. 그래서 자리를 남기고 잠겼다고 말한다.
//
// 중요: 여기 그려지는 흐린 줄은 진짜 해설이 아니라 자리 표시용 막대다. 해설 본문은
// 서버에서 아예 조회하지 않으므로(lib/wrong-notes.ts 의 fetchExplainedNumbers)
// 개발자도구로 블러를 걷어내도 볼 것이 없다 — CSS 로만 가리면 그대로 읽힌다.
export function ExplanationLock({
  // 세트문제(카드에 문항 여러 개)는 몇 번 문항의 해설인지 라벨이 필요하다.
  questionNumber,
  showNumber,
  // 결제 페이지에서 돌아올 곳. 로그인 유도와 같은 방식으로 next 쿼리에 싣는다.
  next,
}: {
  questionNumber: number;
  showNumber: boolean;
  next?: string;
}) {
  const href = next ? `/membership?next=${encodeURIComponent(next)}` : "/membership";

  return (
    // print:hidden — 인쇄물에 잠금 안내가 끼면 종이만 버린다.
    <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 print:hidden dark:border-zinc-700 dark:bg-zinc-800/50">
      {/* 자리 표시용 막대(내용 없음). aria-hidden 으로 스크린리더에서는 건너뛴다 —
          읽어줄 것이 없는 장식이고, 실제 안내는 아래 문구가 한다. */}
      <div aria-hidden className="flex flex-col gap-2 p-3 blur-[3px]">
        <div className="h-3 w-1/3 rounded bg-zinc-300 dark:bg-zinc-600" />
        <div className="h-3 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-3 w-11/12 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-3 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/70 px-4 text-center dark:bg-zinc-900/70">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <Lock size={13} className="shrink-0" />
          {showNumber ? `${questionNumber}번 해설은 멤버십에서 볼 수 있어요` : "해설은 멤버십에서 볼 수 있어요"}
        </p>
        <Link
          href={href}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
        >
          멤버십 보러 가기
        </Link>
      </div>
    </div>
  );
}
