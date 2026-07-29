"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  ExplanationBody,
  type QuestionExplanationContent,
} from "@/components/explanation-body";

// 접혀 있는 "해설 보기". 예전에는 접힌 상태에서도 해설 본문 전체가 화면에 미리
// 그려져 있었다(details는 내용을 감출 뿐 만들어두긴 한다). 과목 오답노트처럼 문항이
// 수십~수백 개인 목록에서는 안 볼지도 모르는 해설 수백 개를 매번 통째로 만들어
// 내려보내는 셈이라, 첫 화면이 뜨는 데 그만큼 오래 걸리고 스크롤도 무거웠다.
// 그래서 실제로 펼친 해설만 그린다. 해설 내용 자체는 이미 화면에 와 있어서 펼칠 때
// 기다림은 없다.
export function ExplanationDisclosure({
  explanation,
  correctChoice,
  // 세트문제(카드에 해설 여러 개)는 몇 번 해설인지 라벨이 필요하다.
  questionNumber,
  showNumber,
}: {
  explanation: QuestionExplanationContent;
  correctChoice: number | null;
  questionNumber: number;
  showNumber: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group"
    >
      {/* 인쇄에서 "해설 보기" 토글 줄은 숨긴다. 단, 세트문제(카드에 해설
          여러 개)는 이 줄이 몇 번 해설인지 알려주는 유일한 라벨이라
          남기고, 토글 화살표만 뺀다. */}
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-blue-600 hover:underline [&::-webkit-details-marker]:hidden dark:text-blue-400 ${
          showNumber ? "print:text-xs print:text-zinc-800" : "print:hidden"
        }`}
      >
        <ChevronRight
          size={14}
          className="shrink-0 transition-transform group-open:rotate-90 print:hidden"
        />
        {showNumber ? (
          <>
            <span className="print:hidden">{questionNumber}번 해설 보기</span>
            <span className="hidden print:inline">{questionNumber}번 해설</span>
          </>
        ) : (
          "해설 보기"
        )}
      </summary>
      {open && (
        <ExplanationBody explanation={explanation} correctChoice={correctChoice} />
      )}
    </details>
  );
}
