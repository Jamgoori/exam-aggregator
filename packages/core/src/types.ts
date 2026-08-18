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
  choice_count: number;
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
  parent_id: string | null;
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

export type SubjectBookmark = {
  id: string;
  user_id: string;
  subject_id: string;
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
  duration_seconds: number | null;
  created_at: string;
};

export type CbtAttemptAnswer = {
  id: string;
  attempt_id: string;
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

export type UserQuestionStatus = {
  user_id: string;
  paper_id: string;
  question_number: number;
  wrong_count: number;
  last_is_correct: boolean;
  last_answered_at: string;
  source: string;
  updated_at: string;
};

export type ReviewSession = {
  id: string;
  user_id: string;
  subject_id: string | null;
  scope: string;
  only_unresolved: boolean;
  total_questions: number;
  score: number | null;
  created_at: string;
  submitted_at: string | null;
};

export type ReviewSessionItem = {
  id: string;
  session_id: string;
  paper_id: string;
  question_number: number;
  position: number;
  selected_choice: number | null;
  is_correct: boolean | null;
};

export type AiDiagnosis = {
  id: string;
  user_id: string;
  diagnosis_date: string;
  report: unknown | null;
  model: string | null;
  requested_at: string;
  generated_at: string | null;
};

// 건의게시판 글 한 건. answer 가 채워지면 곧 "답변 완료"다 — 상태 컬럼을 따로 두면
// 답변만 지웠을 때 배지가 남는 식으로 두 값이 어긋난다.
export type Suggestion = {
  id: string;
  user_id: string;
  nickname: string;
  title: string;
  content: string;
  is_secret: boolean;
  is_pinned: boolean;
  view_count: number;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string | null;
};

// 건의 하나에 달린 댓글. 답글 트리 없이 평평한 목록이다.
export type SuggestionComment = {
  id: string;
  suggestion_id: string;
  user_id: string;
  nickname: string;
  content: string;
  created_at: string;
  updated_at: string | null;
};
