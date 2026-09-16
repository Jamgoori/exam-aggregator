import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { loginHref } from "../src/components/login-link";
import { resolveNextPath } from "../src/lib/next-path";

// `/signup`(설계서 §5 행) — 로그인 화면으로 넘기는 리다이렉트뿐이다.
//
// 이메일/비밀번호 회원가입은 웹에서 이미 폐쇄됐고(가입 = 소셜 로그인), 웹 app/signup/page.tsx
// 도 `redirect(/login?next=…)` 한 줄이다. 앱에도 같은 라우트를 두는 이유는 두 가지다:
//   - 웹에서 공유·북마크된 `gongmoa.kr/signup` 딥링크가 +not-found 로 떨어지지 않게(§5 원칙
//     "앱 라우트 경로 = 웹 URL 경로").
//   - 홈 "전면 무료" 팝업의 CTA 가 웹과 같이 `/signup` 을 가리킬 수 있게(free-promo-slide.tsx).
//
// `?next` 는 웹처럼 그대로 이어 준다 — 다만 앱은 미이식 경로가 섞여 들어올 수 있어 §5 화이트
// 리스트(resolveNextPath)를 한 번 더 지난다. 값이 없으면 웹 sanitizeNextPath 와 같이 "/".
export default function SignupRedirect() {
  const params = useLocalSearchParams<{ next?: string }>();
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  return <Redirect href={loginHref(raw ? resolveNextPath(raw) : "/") as Href} />;
}
