import { supabase } from "./supabase";

// 웹의 getPublicUrl 과 동일 규칙. exam-papers 버킷은 공개라 서명 없이 URL 을 만든다.
export function publicUrl(path: string, bucket = "exam-papers"): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
