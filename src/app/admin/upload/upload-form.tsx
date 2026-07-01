"use client";

import { useActionState, useRef } from "react";
import { uploadExamPaper, type UploadState } from "@/app/admin/actions";
import type { Subject, ExamType } from "@/lib/supabase/types";

const initialState: UploadState = {};

export function UploadForm({
  subjects,
  examTypes,
}: {
  subjects: Subject[];
  examTypes: ExamType[];
}) {
  const [state, action, pending] = useActionState(uploadExamPaper, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await action(formData);
        formRef.current?.reset();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm text-zinc-600">
          제목
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="예: 2024 국가직 9급 국어"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="subject_id" className="text-sm text-zinc-600">
            과목
          </label>
          <select
            id="subject_id"
            name="subject_id"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">선택</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="exam_type_id" className="text-sm text-zinc-600">
            시험 종류
          </label>
          <select
            id="exam_type_id"
            name="exam_type_id"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">선택</option>
            {examTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="year" className="text-sm text-zinc-600">
            연도
          </label>
          <input
            id="year"
            name="year"
            type="number"
            required
            placeholder="2024"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="round" className="text-sm text-zinc-600">
            회차 (기본 1)
          </label>
          <input
            id="round"
            name="round"
            type="number"
            defaultValue={1}
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-sm text-zinc-600">
          PDF 파일
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf"
          required
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="text-sm text-green-600">업로드되었습니다.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "업로드 중..." : "업로드"}
      </button>
    </form>
  );
}
