import { connection } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { collectDiagnosisBatches, submitPendingDiagnoses } from "@/lib/diagnosis-batch";

// AI 약점 진단 배치 드라이버. Vercel 크론(vercel.json)이 주기적으로 호출한다.
//
// 하는 일은 두 가지뿐이다:
//  1) 수거 — 끝난 Message Batch 의 결과를 읽어 ai_diagnoses.report 를 채운다.
//  2) 제출 — 아직 report 가 비어 있는 요청을 모아 배치 1건으로 낸다.
// 수거를 먼저 하는 이유: 방금 끝난 배치가 있으면 그 진단은 이 실행에서 이미 ready 가
// 되어 제출 대상에서 빠진다(같은 진단에 두 번 요금이 나가지 않는다).
//
// 사용자가 버튼을 누르면 그 자리에서도 제출이 한 번 돈다(app/mypage/actions.ts). 크론은
// 그때 실패했거나(키 일시 오류) 앱 밖에서 만들어진 요청을 줍는 안전망이다.
//
// (Cache Components 에서는 dynamic = "force-dynamic" 세그먼트 설정이 지원되지 않는다 —
// 대신 connection() 을 기다려 "요청이 실제로 온 다음에 실행"임을 알린다. 이게 없으면
// 빌드가 이 핸들러를 미리 실행하려다 실제 배치를 제출한다.)
// 한 번에 사용자 25명분을 준비해(계정별 집계 + 오답 표본) 배치로 밀어 넣고, 진행 중인
// 배치 200건까지 수거한다 — 기본 실행 시간으로는 모자란다. 중요한 것은 **배치를 내는 POST
// 도중에 런타임이 함수를 죽이지 않는 것**이다: 그렇게 끊기면 배치는 만들어져 요금이 나가는데
// batch_id 를 기록하지 못해 수거도 못 하고, 다음 실행이 같은 진단을 또 제출한다(요금 두 배).
export const maxDuration = 300;

export async function GET(request: Request) {
  await connection();

  // CRON_SECRET 이 설정돼 있으면 그 값으로만 호출을 허용한다. 워밍업 엔드포인트와 달리
  // 여기는 **미설정이면 아예 거절한다** — 이 주소를 두드리면 실API 요금이 나가는 배치가
  // 제출되므로, 무인증 공개로 두면 그대로 요금 청구서가 된다.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (!timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const collected = await collectDiagnosisBatches();
  const submitted = await submitPendingDiagnoses();

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    collected,
    submitted: {
      submitted: submitted.submitted,
      skipped: submitted.skipped,
      batchId: submitted.batchId ?? null,
    },
  });
}

// 상수시간 문자열 비교(api/cron/warm 과 같은 이유 — 비교 시간으로 토큰을 한 글자씩
// 알아내는 걸 막는다).
function timingSafeEqualStr(a: string | null, b: string): boolean {
  if (a === null) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
