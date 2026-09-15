import type { ExamPaper } from "@gongmoa/core";
import { View } from "react-native";
import NotFoundScreen from "../../../app/+not-found";
import { InlineAlert } from "../feedback";
import { Screen } from "../screen";
import { useResolvedPaperId } from "../../lib/resolve-paper";
import { usePaper } from "../../queries/papers";

// `/papers/[id]/*` 공통 진입 게이트: [id](슬러그·UUID) → 카탈로그 역색인 → 문제지 한 장.
// 순서(§6.9): 스켈레톤 → InlineAlert+재시도 → 없으면 404(웹 notFound) → children(paper).
export function PaperGate({
  param,
  skeleton,
  // 몰입 화면(PDF 뷰어)은 헤더 없는 셸로 로딩·오류를 그린다.
  immersive = false,
  children,
}: {
  param: string | string[] | undefined;
  skeleton: React.ReactNode;
  immersive?: boolean;
  children: (paper: ExamPaper) => React.ReactNode;
}) {
  const resolved = useResolvedPaperId(param);
  const paper = usePaper(resolved.id);

  const shell = (node: React.ReactNode) => (
    <Screen immersive={immersive} contentClassName="gap-6">
      {immersive ? <View className="px-4 pt-6">{node}</View> : node}
    </Screen>
  );

  if (resolved.status === "pending") return shell(skeleton);
  if (resolved.status === "error") {
    return shell(
      <InlineAlert
        message={resolved.catalog.error instanceof Error ? resolved.catalog.error.message : "문제지 목록을 불러오지 못했어요."}
        onRetry={() => void resolved.catalog.refetch()}
      />,
    );
  }
  if (resolved.status === "not-found") return <NotFoundScreen />;

  if (paper.isPending) return shell(skeleton);
  if (paper.isError) {
    return shell(
      <InlineAlert
        message={paper.error instanceof Error ? paper.error.message : "문제지를 불러오지 못했어요."}
        onRetry={() => void paper.refetch()}
      />,
    );
  }
  if (!paper.data) return <NotFoundScreen />;
  return <>{children(paper.data)}</>;
}
