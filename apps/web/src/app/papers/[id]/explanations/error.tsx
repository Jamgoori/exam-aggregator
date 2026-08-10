"use client";

import { RotateCw } from "lucide-react";

// 해설 조회가 실패했을 때 쓰는 경계. 이 화면은 해설이 곧 본문이라, 조회 실패를
// 빈 목록으로 넘기면 "아직 해설이 등록되지 않은 문제지예요"라고 거짓 안내를 하게
// 된다(실제로 그렇게 보였던 버그가 있었다 — wrong-notes.ts의 fetchExplanations
// 주석 참고). 그래서 조회 실패는 여기까지 올라오게 두고, 사용자에게는 "일시적인
// 문제"라고 정확히 알리고 다시 시도를 준다.
export default function ExplanationsError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">해설을 불러오지 못했어요</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        일시적인 문제일 수 있어요. 잠시 후 다시 시도해주세요.
      </p>
      <button
        type="button"
        onClick={reset}
        className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        <RotateCw size={15} />
        다시 시도
      </button>
    </div>
  );
}
