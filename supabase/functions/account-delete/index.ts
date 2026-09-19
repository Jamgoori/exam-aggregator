// 회원 탈퇴(계정 삭제). 계정을 만들 수 있는 앱은 앱 안에 삭제 경로가 있어야 한다는 애플·구글 스토어
// 심사 요건이자, 개인정보 파기 요청을 처리하는 경로다. 웹·앱이 같은 함수를 부른다.
//
// 규칙은 core rules/account-delete.ts 하나다(설계서 §12-2 #17 — 본인 원글은 내용을 비워 "탈퇴한
// 회원의 글" 로 남기고 타인의 댓글은 유지, 댓글류는 닉네임만 익명화, cascade 없는 참조 끊기, 공개
// 버킷 정리, deleteUser 순). 순서·실패 정책·Apple 토큰 폐기 메모는 전부 그 파일 머리말에 있다 —
// 여기는 인증과 응답 직렬화만 한다.
//
//   {}  → { ok: true }
//
// 오류: 401 로그인 필요 · 500 `{ error }`(정리·삭제 실패 — 계정은 그대로라 다시 누르면 된다).
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { deleteAccount } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const result = await deleteAccount(coreAdmin(), { userId: auth.userId });
  if ("error" in result) return json({ error: result.error }, result.status);
  return json({ ok: true });
});
