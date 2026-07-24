import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subject } from "../types";

// 데이터 접근(DI): 특정 클라이언트에 묶이지 않도록 SupabaseClient 를 주입받는다.
// 웹은 @supabase/ssr 서버/퍼블릭 클라, 모바일은 토큰 클라를 넘긴다.

// slug 로 과목 1건. 없으면 null. (웹은 .single() 로 쓰되 error 를 무시하고 data 만
// 반환했는데, 0행이면 data=null 이라 .maybeSingle() 과 반환값이 동일하다. 하나로 통일.)
export async function getSubjectBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<Subject | null> {
  const { data } = await client
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Subject | null) ?? null;
}
