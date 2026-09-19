import { router, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { LoginPrompt } from "../login-prompt";
import { Screen } from "../screen";
import { useAuth } from "../../providers/auth-provider";

// 로그인 전용 화면의 게스트 처리(설계서 §5 L 행, 웹 mypage/page.tsx:229 redirect): 세션 판정이
// 끝났는데 비로그인이면 웹과 같은 `/login?next=…&error=로그인이 필요해요` 로 보낸다. 로그인
// 모달을 닫고 돌아오면(뒤로가기) 다시 튕기지 않도록 한 번만 보내고, 그 아래에는 같은 문구의
// LoginPrompt 를 그려 둔다(§7.0 게스트 모드 — 빈 화면을 남기지 않는다).
//
// 문구는 웹 화면마다 조금 다르다 — 대부분 "로그인이 필요해요"지만 `/board/new` 는 "로그인 후 글을 쓸 수
// 있어요"(web app/board/new/page.tsx) 다. 그래서 문구를 인자로 받되 기본값은 관례 문장으로 둔다(웹 문구를
// 새로 짓지 않는다).
export const LOGIN_REQUIRED_MESSAGE = "로그인이 필요해요";

export function loginRedirectHref(next: string, message: string = LOGIN_REQUIRED_MESSAGE): Href {
  return `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(message)}` as Href;
}

export function useRequireLogin(
  next: string,
  message: string = LOGIN_REQUIRED_MESSAGE,
): { userId: string | null; loading: boolean } {
  const { userId, loading } = useAuth();
  const sent = useRef(false);
  useEffect(() => {
    if (loading || userId || sent.current) return;
    sent.current = true;
    router.push(loginRedirectHref(next, message));
  }, [loading, userId, next, message]);
  return { userId, loading };
}

// 게스트가 보는 자리(로그인 모달 뒤·모달을 닫은 뒤).
export function LoginRequiredScreen({ message = LOGIN_REQUIRED_MESSAGE }: { message?: string } = {}) {
  return (
    <Screen contentClassName="gap-6">
      <LoginPrompt message={message} />
    </Screen>
  );
}
