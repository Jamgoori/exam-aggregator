import { getPaperDisplayTitle } from "@gongmoa/core";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { InlineAlert } from "../../../src/components/feedback";
import { PaperGate } from "../../../src/components/papers/paper-gate";
import { PdfViewer } from "../../../src/components/papers/pdf-viewer";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { usePaperPublicDetail } from "../../../src/queries/papers";

// `/papers/[id]/pdf?kind=paper|answer`(설계서 §5 `/download` 행 — 웹 /download/[id]?view=1 ·
// /download/answer/[id]?view=1 의 앱 매핑). 몰입 화면(헤더·푸터·탭 없음, 가로 허용).
// 정답표(answer_keys)는 문제지 공개 상세 조회가 고른 한 장을 쓴다.
export default function PaperPdfRoute() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const kind = params.kind === "answer" ? "answer" : "paper";

  return (
    <PaperGate param={params.id} immersive skeleton={<PdfSkeleton />}>
      {(paper) => {
        const title = getPaperDisplayTitle(paper.title, paper.track);
        if (kind === "paper") {
          return (
            <Screen immersive>
              <PdfViewer paperId={paper.id} kind="paper" storagePath={paper.file_path} fileName={paper.file_name} title={title} />
            </Screen>
          );
        }
        return <AnswerPdf paperId={paper.id} title={`${title} 정답`} paper={paper} />;
      }}
    </PaperGate>
  );
}

function AnswerPdf({ paperId, title, paper }: { paperId: string; title: string; paper: Parameters<typeof usePaperPublicDetail>[0] }) {
  const detail = usePaperPublicDetail(paper);
  return (
    <Screen immersive>
      <QueryState
        query={detail}
        skeleton={<PdfSkeleton />}
        isEmpty={(d) => !d.answerKey}
        empty={
          <View className="px-4 pt-6">
            <InlineAlert tone="amber" message="이 문제지의 정답표가 아직 등록되지 않았어요." />
          </View>
        }
      >
        {(d) => (
          <PdfViewer paperId={paperId} kind="answer" storagePath={d.answerKey!.file_path} fileName={d.answerKey!.file_name} title={title} />
        )}
      </QueryState>
    </Screen>
  );
}

function PdfSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-xl" delay={120} />
    </View>
  );
}
