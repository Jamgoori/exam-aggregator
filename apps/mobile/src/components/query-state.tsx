import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { InlineAlert } from "./feedback";
import { handleEdgeError, type HandledEdgeError } from "../lib/edge";

// 목록 화면 순서 강제(설계서 §6.9 3번): isPending → 화면별 Skeleton, isError → InlineAlert +
// 재시도, 빈 배열 → EmptyState(문구는 웹 동일), 그 외 children(data).
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton: React.ReactNode;
  empty?: React.ReactNode;
  // 기본: 배열이면 length === 0.
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}) {
  // 오류 객체별로 매핑 결과를 보관 — 다른 오류로 바뀌면 자연히 null 이 된다(효과 안 setState 없음).
  const [mapped, setMapped] = useState<{ error: unknown; result: HandledEdgeError } | null>(null);
  const handled = query.isError && mapped && mapped.error === query.error ? mapped.result : null;

  useEffect(() => {
    if (!query.isError) return;
    const error = query.error;
    let alive = true;
    handleEdgeError(error).then((result) => {
      if (alive) setMapped({ error, result });
    });
    return () => {
      alive = false;
    };
  }, [query.isError, query.error]);

  if (query.isPending) return <>{skeleton}</>;
  if (query.isError) {
    if (!handled || handled.redirected) return <>{skeleton}</>;
    return (
      <InlineAlert
        tone={handled.tone}
        message={handled.message}
        onRetry={handled.tone === "red" ? () => void query.refetch() : undefined}
      />
    );
  }
  const data = query.data as T;
  const emptyNow = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (emptyNow && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
