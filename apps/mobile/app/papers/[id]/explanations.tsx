import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ExplanationsScreen } from "../../../src/components/explanations/explanations-screen";
import { PaperGate } from "../../../src/components/papers/paper-gate";
import { Skeleton } from "../../../src/components/skeleton";

// `/papers/[id]/explanations`(설계서 §5 행). `?download=1`(웹 인쇄)은 무시한다.
// 화면 본체·상태 분기는 components/explanations/explanations-screen.tsx.
export default function PaperExplanationsRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  return (
    <PaperGate param={params.id} skeleton={<GateSkeleton />}>
      {(paper) => <ExplanationsScreen paper={paper} />}
    </PaperGate>
  );
}

function GateSkeleton() {
  return (
    <View className="gap-3">
      <Skeleton className="h-4 w-20 rounded-lg" />
      <Skeleton className="h-8 w-full max-w-md rounded-lg" delay={100} />
      <Skeleton className="h-48 w-full rounded-xl" delay={200} />
    </View>
  );
}
