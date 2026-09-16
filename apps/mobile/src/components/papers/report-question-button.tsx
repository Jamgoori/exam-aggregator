import {
  QUESTION_REPORT_MESSAGE_MAX,
  QUESTION_REPORT_REASON_LABELS,
  questionReportReasonsFor,
  type QuestionReportContext,
  type QuestionReportReason,
} from "@gongmoa/core";
import { Flag, X } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Input } from "../input";
import { useSubmitQuestionReport } from "../../queries/reports";
import { themedIcon } from "../../theme/icons";

// 문항 오류 신고 버튼(웹 report-question-button.tsx 1:1, 설계서 §6.7 #6). 해설 카드·CBT 상태
// 줄·응시 상세 어디에나 붙는 작은 깃발 버튼 + 가운데 정렬 모달이다. 웹도 트리거 옆 팝오버가
// 아니라 모달인데, CBT 문제별 풀기에서 트리거가 화면 가운데 근처라 고정폭 팝오버가 화면 밖으로
// 잘려 나갔기 때문이다 — 앱에서도 같은 이유로 모달(결과 모달과 같은 규격)로 둔다.
//
// 사유 목록·문구·컨텍스트별 필터는 core(data/reports.ts)가 정본이고 서버 RPC 도 같은 조합을
// 거절한다. 검증(500자·시간당 20건·중복 신고)은 전부 서버 몫이라 여기서는 상태만 그린다:
// 고르기 → 제출 중 → "신고가 접수됐어요" 또는 서버 문구 그대로의 오류(로그인 필요·이미 신고한
// 문항·한도 초과). 비로그인도 버튼은 보이고(웹과 같다), 누르면 "로그인 후 이용할 수 있어요."가
// 뜬다 — RPC 가 auth.uid() 로 판정한다.
const FlagIcon = themedIcon(Flag);
const CloseIcon = themedIcon(X);

export function ReportQuestionButton({
  paperId,
  questionNumber,
  context,
}: {
  paperId: string;
  questionNumber: number;
  context: QuestionReportContext;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QuestionReportReason | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const report = useSubmitQuestionReport();

  const reasons = questionReportReasonsFor(context);

  function close() {
    setOpen(false);
    setReason(null);
    setMessage("");
    setError(null);
    setDone(false);
  }

  function submit() {
    if (!reason || report.isPending) return;
    setError(null);
    report.mutate(
      { paperId, questionNumber, context, reason, message },
      {
        onSuccess: () => setDone(true),
        onError: (e) => setError(e instanceof Error ? e.message : "신고 접수에 실패했어요."),
      },
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${questionNumber}번 문항 오류 신고`}
        onPress={() => setOpen(true)}
        className="shrink-0 items-center justify-center rounded-full p-1.5 active:bg-zinc-100 dark:active:bg-zinc-800"
      >
        <FlagIcon size={14} colorClassName="text-zinc-400 dark:text-zinc-500" />
      </Pressable>

      <Modal visible={open} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <View className="flex-1 items-center justify-center bg-black/40 px-4">
            <Pressable accessibilityLabel="닫기" accessibilityRole="button" onPress={close} className="absolute inset-0" />
            <View className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
              {done ? (
                <View className="items-center gap-3 py-2">
                  <AppText variant="sm" className="text-center text-zinc-600 dark:text-zinc-400">
                    신고가 접수됐어요. 확인 후 반영할게요.
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={close}
                    className="rounded-lg bg-zinc-100 px-4 py-1.5 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700"
                  >
                    <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
                      닫기
                    </AppText>
                  </Pressable>
                </View>
              ) : (
                <View className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
                      {questionNumber}번 문항 오류 신고
                    </AppText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="닫기"
                      onPress={close}
                      className="rounded-full p-1 active:bg-zinc-100 dark:active:bg-zinc-800"
                    >
                      <CloseIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-600" />
                    </Pressable>
                  </View>

                  <View className="gap-1.5">
                    {reasons.map((value) => {
                      const selected = reason === value;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole="radio"
                          accessibilityState={{ selected, checked: selected }}
                          accessibilityLabel={QUESTION_REPORT_REASON_LABELS[value]}
                          onPress={() => setReason(value)}
                          className="flex-row items-center gap-2 py-1"
                        >
                          <View
                            className={[
                              "h-5 w-5 items-center justify-center rounded-full border-2",
                              selected ? "border-blue-600 dark:border-blue-400" : "border-zinc-300 dark:border-zinc-600",
                            ].join(" ")}
                          >
                            {selected && <View className="h-2.5 w-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
                          </View>
                          <AppText variant="sm" className="flex-1 text-zinc-600 dark:text-zinc-400">
                            {QUESTION_REPORT_REASON_LABELS[value]}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Input
                    value={message}
                    onChangeText={setMessage}
                    placeholder="자세히 알려주시면 도움이 돼요 (선택)"
                    maxLength={QUESTION_REPORT_MESSAGE_MAX}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    accessibilityLabel="신고 내용(선택)"
                    className="min-h-[56px]"
                  />

                  {error && (
                    <AppText variant="xs" className="text-red-600 dark:text-red-400">
                      {error}
                    </AppText>
                  )}

                  <View className="flex-row justify-end gap-2">
                    <Pressable
                      accessibilityRole="button"
                      onPress={close}
                      className="rounded-lg px-3 py-1.5 active:bg-zinc-100 dark:active:bg-zinc-800"
                    >
                      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
                        취소
                      </AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !reason || report.isPending }}
                      disabled={!reason || report.isPending}
                      onPress={submit}
                      className={[
                        "rounded-lg px-4 py-1.5",
                        !reason || report.isPending ? "bg-red-500 opacity-40" : "bg-red-500 active:bg-red-600",
                      ].join(" ")}
                    >
                      <AppText variant="sm" weight="medium" className="text-white">
                        {report.isPending ? "제출 중..." : "신고하기"}
                      </AppText>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
