// packages/core/src/membership.ts + 웹 src/lib/membership.ts 포팅(체험 시작 부분만).
// 판정 규칙의 정본은 core 쪽이다 — TRIAL_DAYS를 바꿀 때는 양쪽을 함께 고칠 것.
// deno-lint-ignore-file no-explicit-any

export const TRIAL_DAYS = 14;

// 아직 체험을 안 쓴 사용자의 체험을 켠다. 첫 CBT 채점에서만 부른다 — 가입 직후엔
// 오답이 0개라 복습 큐가 비어 있어서, 가입일 기준으로 재면 체험 앞부분을 오답 쌓는
// 데 다 쓰게 된다.
//
// started_at is null 을 조건에 건 단일 UPDATE라 동시 채점이 겹쳐도 체험이 두 번
// 시작되지 않는다(두 번째 UPDATE는 0행 갱신). 실패해도 채점은 막지 않는다.
export async function startTrialIfEligible(admin: any, userId: string): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await admin
    .from("memberships")
    .update({
      tier: "premium",
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId)
    .eq("source", "trial")
    .is("started_at", null);
}
