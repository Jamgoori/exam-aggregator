export type Subject = {
  id: string;
  slug: string;
  name: string;
  display_order: number;
};

export type ExamType = {
  id: string;
  name: string;
};

export type ExamPaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  title: string;
  file_path: string;
  file_name: string;
  uploaded_by: string | null;
  created_at: string;
  exam_types?: ExamType;
};
