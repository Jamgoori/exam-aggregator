export type Subject = {
  id: string;
  slug: string;
  name: string;
  display_order: number;
};

export type ExamType = {
  id: string;
  name: string;
  display_order: number;
};

export type ExamPaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  level: string | null;
  title: string;
  question_count: number | null;
  tags: string[];
  file_path: string;
  file_name: string;
  file_size: number | null;
  view_count: number;
  download_count: number;
  uploaded_by: string | null;
  created_at: string;
  subjects?: Subject;
  exam_types?: ExamType;
};

export type Comment = {
  id: string;
  paper_id: string;
  user_id: string | null;
  nickname: string;
  content: string;
  created_at: string;
  updated_at: string | null;
};

export type DifficultyRating = {
  id: string;
  paper_id: string;
  user_id: string | null;
  guest_token: string | null;
  score: number;
  created_at: string;
};

export type AnswerKey = {
  id: string;
  exam_type_id: string;
  year: number;
  level: string | null;
  round: number;
  file_path: string;
  file_name: string;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
};
