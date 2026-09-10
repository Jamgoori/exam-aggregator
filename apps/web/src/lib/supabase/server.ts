import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 한 요청 안에서는 같은 클라이언트를 돌려준다(React cache). 페이지가 Suspense 섬
// 여러 개로 나뉘면서 섬마다 createClient 를 부르는데, 쿠키 저장소는 어차피 요청당
// 하나라 인스턴스도 하나면 된다. 같은 인스턴스여야 아래 lib 들이 (supabase, userId)
// 를 키로 React cache 를 걸어 요청 안의 중복 조회를 없앨 수 있다.
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component without a mutable cookie store;
            // safe to ignore when middleware refreshes the session instead.
          }
        },
      },
    },
  );
});
