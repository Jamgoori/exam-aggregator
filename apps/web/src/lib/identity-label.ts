// 인쇄물 워터마크에 박을 계정 표시 문자열.
//
// 이메일을 통째로 박으면 PDF를 정상적으로 주고받기만 해도 계정 이메일이 그대로
// 노출된다. 반대로 완전히 익명 문자열만 박으면 유출본을 받아도 누구 것인지
// 확인할 수 없어 워터마크의 의미가 없다. 그래서 사람이 보기엔 마스킹된 이메일,
// 우리에게는 auth uid 앞 8자로 역추적 가능한 형태로 만든다.
export function printIdentityLabel(userId: string, email: string | null | undefined) {
  const code = userId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const masked = maskEmail(email);
  return masked ? `${masked} · ${code}` : code;
}

// 앞 2글자만 남기고 로컬파트를 가린다 (ab****@gmail.com). 2글자 이하면 첫 글자만.
function maskEmail(email: string | null | undefined) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.slice(0, local.length > 2 ? 2 : 1);
  return `${keep}${"*".repeat(Math.max(local.length - keep.length, 1))}${domain}`;
}
