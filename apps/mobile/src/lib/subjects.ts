import { supabase } from "./supabase";
import { fetchWithCache } from "./offline";
import { getSubjectBySlug as coreGetSubjectBySlug } from "@gongmoa/core";
import type { ExamPaper, Subject } from "@gongmoa/core";

// 과목 목록/즐겨찾기/과목별 문제지. subject_bookmarks 는 RLS 본인 쓰기라 클라이언트에서.

export type SubjectWithFav = Subject & { favorited: boolean };

// 과목 목록은 잘 안 변하고 오프라인에서도 둘러볼 수 있어야 해서 캐시를 둔다.
export async function listSubjectsCached(): Promise<SubjectWithFav[]> {
  const { data } = await fetchWithCache("subjects", listSubjects);
  return data;
}

export async function listSubjects(): Promise<SubjectWithFav[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const [{ data: subjects }, favRes] = await Promise.all([
    supabase.from("subjects").select("*").order("display_order").order("name"),
    userId
      ? supabase.from("subject_bookmarks").select("subject_id")
      : Promise.resolve({ data: [] as { subject_id: string }[] }),
  ]);

  const favSet = new Set((favRes.data ?? []).map((r) => r.subject_id as string));
  return ((subjects ?? []) as Subject[]).map((s) => ({
    ...s,
    favorited: favSet.has(s.id),
  }));
}

export async function toggleSubjectBookmark(subjectId: string, on: boolean): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("로그인이 필요해요.");
  if (on) {
    const { error } = await supabase
      .from("subject_bookmarks")
      .insert({ subject_id: subjectId, user_id: userId });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase
      .from("subject_bookmarks")
      .delete()
      .eq("subject_id", subjectId);
    if (error) throw error;
  }
}

// 쿼리는 @gongmoa/core 로 단일화(웹과 공유). 모바일 클라를 주입해 기존 API 유지.
export function getSubjectBySlug(slug: string): Promise<Subject | null> {
  return coreGetSubjectBySlug(supabase, slug);
}

export async function papersBySubject(subjectId: string, limit = 100): Promise<ExamPaper[]> {
  const { data, error } = await supabase
    .from("exam_papers")
    .select("id, title, year, round, level, track, subjects(id, name, slug)")
    .eq("subject_id", subjectId)
    .order("year", { ascending: false })
    .order("round", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ExamPaper[];
}
