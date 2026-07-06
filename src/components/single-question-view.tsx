"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function SingleQuestionView({
  questionIndex,
  totalQuestions,
  choiceCount,
  images,
  selected,
  onSelect,
  onNavigate,
  questionResult,
}: {
  questionIndex: number;
  totalQuestions: number;
  choiceCount: number;
  images: string[];
  selected: number | null;
  onSelect: (choice: number) => void;
  onNavigate: (index: number) => void;
  questionResult: { selected_choice: number | null; is_correct: boolean } | null;
}) {
  const questionNumber = questionIndex + 1;
  const graded = !!questionResult;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-zinc-100 bg-white px-4 py-2 text-center">
        <span className="text-sm font-bold text-zinc-800">{questionNumber}번</span>
        <span className="text-sm text-zinc-400"> / {totalQuestions}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4">
        {images.length === 0 ? (
          <p className="pt-24 text-center text-sm text-zinc-400">
            아직 이 문제의 이미지가 등록되지 않았어요.
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`${questionNumber}번 문제 이미지 ${i + 1}`}
                className="w-full rounded-lg border border-zinc-200 bg-white"
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            type="button"
            aria-label="이전 문제"
            disabled={questionIndex === 0}
            onClick={() => onNavigate(questionIndex - 1)}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="flex flex-1 justify-center gap-2">
            {Array.from({ length: choiceCount }, (_, c) => c + 1).map((choice) => {
              const isSelected = selected === choice;
              const isCorrectChoice = graded && questionResult?.is_correct && isSelected;
              const isWrongChoice = graded && !questionResult?.is_correct && isSelected;
              return (
                <button
                  key={choice}
                  type="button"
                  disabled={graded}
                  onClick={() => onSelect(choice)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                    isCorrectChoice
                      ? "bg-emerald-500 text-white"
                      : isWrongChoice
                        ? "bg-red-500 text-white"
                        : isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  } disabled:cursor-default`}
                >
                  {choice}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="다음 문제"
            disabled={questionIndex === totalQuestions - 1}
            onClick={() => onNavigate(questionIndex + 1)}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
