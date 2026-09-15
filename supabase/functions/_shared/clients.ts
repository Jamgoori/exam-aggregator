import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
// @ts-types="./core.d.ts"
import type { startTrialIfEligible } from "./core.mjs";

// Edge 런타임이 자동 주입하는 환경변수. 서비스 롤 키는 함수 안에서만 쓰고 절대
// 클라이언트로 나가지 않는다.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 공개 버킷(exam-papers) 저장 경로 → 공개 URL. 웹 storage.getPublicUrl 과 동형.
export function storagePublicUrl(path: string, bucket = "exam-papers"): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 요청의 Authorization(사용자 JWT)로 본인을 확인하는 클라이언트.
export function userClientFrom(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

// RLS 를 우회하는 관리자 클라이언트 — 정답 조회·응시 기록 쓰기 전용.
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// core(_shared/core.mjs) 규칙 함수가 받는 SupabaseClient 타입. core.d.ts 는
// `@supabase/supabase-js` 를 import type 으로 참조하고 supabase/functions/deno.json 의
// import map 이 그걸 같은 esm.sh 모듈로 풀지만, 버전 핀이 어긋나면 타입 동일성이 깨질
// 수 있어 여기서 한 번 캐스팅해 둔다 — Edge 파일들은 core 에 넘길 admin 을 이걸로 만든다.
export type CoreClient = Parameters<typeof startTrialIfEligible>[0];

export function coreAdmin(): CoreClient {
  return adminClient() as unknown as CoreClient;
}

// 공통: 로그인 사용자 확인. 없으면 401 응답을 반환한다(호출부에서 early return).
//
// email 을 같이 돌려주는 이유는 관리자 판정 때문이다 — admins 테이블은 user_id 가
// 아니라 email 이 기본키라(웹의 is_admin() 도 JWT 의 email 로 검사한다), 이걸 안 실어
// 주면 멤버십을 확인할 때마다 auth.admin.getUserById 를 한 번 더 부르게 된다.
export async function requireUser(
  req: Request,
): Promise<{ userId: string; email: string | null } | { error: Response }> {
  const {
    data: { user },
  } = await userClientFrom(req).auth.getUser();
  if (!user) return { error: json({ error: "로그인 후 이용할 수 있어요." }, 401) };
  return { userId: user.id, email: user.email ?? null };
}

// ── 계약 테스트 전용 훅 ──────────────────────────────────────────────────────
//
// 계약 테스트(apps/web/docs/agents/contract-tests.md, packages/core/scripts/contract-tests.mjs)는
// 웹 어댑터와 Edge 에 **같은 시각·같은 난수**를 넣어야 결과 행(srs_due_at·attendance_days·
// last_answered_at …)이 스냅샷으로 비교된다. 웹 어댑터는 규칙 함수 인자(opts.now·fuzz)로
// 바로 넣지만 Edge 는 HTTP 경계를 넘어야 하므로 요청 헤더로 받는다:
//   x-gongmoa-test-clock: ISO 8601 시각 → opts.now
//   x-gongmoa-test-fuzz : 0 이상 1 미만의 수 → opts.questionStatus.fuzz = () => 그 값
//
// **환경변수 GONGMOA_TEST_HOOKS=1 일 때만 읽는다.** 그 외에는 헤더가 있어도 빈 객체를
// 돌려주므로 규칙은 기본값(new Date()·Math.random)으로 돈다. 이 변수는 CI 워크플로
// (.github/workflows/contract-tests.yml)가 `functions serve --env-file` 로 넘기는 로컬
// .env.local 에만 있다 — 프로덕션 `supabase secrets` 에 절대 넣지 말 것. 클라이언트가
// 채점 시각을 지정할 수 있으면 최소 응시시간 검증이 무력화되고 SRS 스케줄이 조작된다.
export type TestOverrides = { now?: Date; fuzz?: () => number };

export function testOverrides(req: Request): TestOverrides {
  if (Deno.env.get("GONGMOA_TEST_HOOKS") !== "1") return {};
  const out: TestOverrides = {};
  const clock = req.headers.get("x-gongmoa-test-clock");
  if (clock) {
    const d = new Date(clock);
    if (!Number.isNaN(d.getTime())) out.now = d;
  }
  const fuzz = req.headers.get("x-gongmoa-test-fuzz");
  if (fuzz !== null && fuzz !== "") {
    const n = Number(fuzz);
    if (Number.isFinite(n) && n >= 0 && n < 1) out.fuzz = () => n;
  }
  return out;
}

// 비로그인도 허용하는 엔드포인트(해설 미리보기 등)용 — 없으면 null, 에러로 막지 않는다.
export async function getOptionalUser(
  req: Request,
): Promise<{ userId: string; email: string | null } | null> {
  const {
    data: { user },
  } = await userClientFrom(req).auth.getUser();
  return user ? { userId: user.id, email: user.email ?? null } : null;
}
