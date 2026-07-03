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
  track: string | null;
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

export type Bookmark = {
  id: string;
  user_id: string;
  paper_id: string;
  created_at: string;
};

export type AnswerKey = {
  id: string;
  exam_type_id: string;
  year: number;
  level: string | null;
  round: number;
  track: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export type PaperAnswers = {
  id: string;
  paper_id: string;
  answers: number[];
  voided_questions: number[];
  updated_at: string;
};

export type QuestionPassage = {
  id: string;
  paper_id: string;
  created_at: string;
};

export type QuestionPassageImage = {
  id: string;
  passage_id: string;
  order_index: number;
  image_path: string;
};

export type Question = {
  id: string;
  paper_id: string;
  question_number: number;
  choice_count: number;
  unit_tag: string | null;
  passage_id: string | null;
  created_at: string;
};

export type QuestionImage = {
  id: string;
  question_id: string;
  order_index: number;
  image_path: string;
};

export type CbtAttempt = {
  id: string;
  user_id: string;
  paper_id: string;
  score: number;
  total_questions: number;
  created_at: string;
};

export type CbtAttemptAnswer = {
  id: string;
  attempt_id: string;
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};
