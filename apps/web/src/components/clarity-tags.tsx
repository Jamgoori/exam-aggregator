"use client";

import { useEffect } from "react";
import { clarityTags } from "@/lib/clarity";

// 서버 컴포넌트가 아는 값(회원 등급, 어느 화면에서 넘어왔는지 등)을 Clarity 세션에
// 꼬리표로 다는 얇은 클라이언트 컴포넌트. 화면마다 "use client" 파일을 새로 만들지
// 않으려고 하나로 둔다. 아무것도 그리지 않는다.
export function ClarityTags({
  tags,
}: {
  tags: Record<string, string | string[] | null | undefined>;
}) {
  // 값이 바뀔 때만 다시 걸리도록 직렬화한 것을 의존성으로 쓴다. 객체를 그대로 두면
  // 부모가 리렌더될 때마다 같은 태그를 다시 건다.
  const serialized = JSON.stringify(tags);
  useEffect(() => {
    clarityTags(JSON.parse(serialized) as Record<string, string | string[]>);
  }, [serialized]);
  return null;
}
