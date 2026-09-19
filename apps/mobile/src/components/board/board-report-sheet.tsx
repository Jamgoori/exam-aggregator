import { REPORT_DETAIL_MAX, REPORT_REASONS, reportTargetLabel, type ReportReasonSlug, type ReportTargetType } from "@gongmoa/core";
import { Flag } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Sheet } from "../sheet";
import { useReportContent } from "../../queries/ugc";
import { themedIcon } from "../../theme/icons";

// 콘텐츠 신고 시트 — 1라운드에는 게시글 전용이었고(**웹에 없는 화면**, 스토어 UGC 요건 Apple 1.2, 설계서
// §6.7 #18·§12-2 #16) 2라운드에서 대상 종류(target)를 인자로 받아 건의글도 같은 화면으로 신고한다 — 제목만
// core reportTargetLabel 로 바뀐다("게시글 신고"/"건의글 신고"; 웹 2라운드 신고 다이얼로그도 같은 조립).
// target 을 안 주면 게시글이라 1라운드 호출부는 그대로 동작한다. RPC 는 이제 report_content 하나
// (queries/ugc.ts — report_post 는 그 본문을 부르는 껍데기로 남아 있다).
// 베낄 웹 마크업이 없고 문구는 짧고 사실만 적는다. 사유 목록은 core REPORT_REASONS(DB check 와
// 같은 값), 검증은 core validateReportInput(뮤테이션 안) — RPC 본문이 같은 검사를 되풀이한다.
// "기타"만 상세 설명이 필수다(운영자가 무엇을 봐야 할지 알 수 있어야 한다). 다른 사유는 입력란을 그리지
// 않는다(지시대로 — 선택 입력을 두면 비운 채 보내는 사람이 대부분이라 자리만 차지한다).
const FlagIcon = themedIcon(Flag);

export const REPORT_DONE_MESSAGE = "신고를 접수했어요. 확인 후 조치할게요.";

export function BoardReportSheet({
  postId,
  target = "board_post",
  visible,
  onClose,
}: {
  // 신고 대상 id — 이름은 1라운드 호출부 호환으로 postId 그대로(건의글이면 건의글 id).
  postId: string;
  target?: ReportTargetType;
  visible: boolean;
  onClose: () => void;
}) {
  const report = useReportContent();
  const [reason, setReason] = useState<ReportReasonSlug | "">("");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);

  function close() {
    onClose();
    // 다음에 열 때 지난 입력이 남아 있지 않게. 접수된 뒤에는 같은 글을 다시 신고할 수 없으므로
    // (RPC unique — "이미 신고한 글이에요.") 성공 상태도 함께 지운다.
    setReason("");
    setDetail("");
    setDone(false);
    report.reset();
  }

  function submit() {
    report.mutate({ target, targetId: postId, reason, detail }, { onSuccess: () => setDone(true) });
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={`${reportTargetLabel(target)} 신고`}
      icon={<FlagIcon size={18} colorClassName="text-white" />}
      maxHeight="88%"
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 py-4">
        {done ? (
          <View className="gap-4">
            <AppText variant="sm" className="text-zinc-700 dark:text-zinc-200" pretty accessibilityRole="alert">
              {REPORT_DONE_MESSAGE}
            </AppText>
            <Button variant="outline" label="닫기" onPress={close} className="self-end" />
          </View>
        ) : (
          <>
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400" pretty>
              신고 사유를 선택해주세요. 신고 내용은 운영자만 봅니다.
            </AppText>

            <View accessibilityRole="radiogroup" className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
              {REPORT_REASONS.map((r, i) => {
                const selected = reason === r.slug;
                return (
                  <Pressable
                    key={r.slug}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReason(r.slug)}
                    className={[
                      "flex-row items-center gap-3 px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/40",
                      i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : "",
                    ].join(" ")}
                  >
                    <View
                      className={[
                        "h-[18px] w-[18px] items-center justify-center rounded-full border-2",
                        selected ? "border-blue-600" : "border-zinc-300 dark:border-zinc-600",
                      ].join(" ")}
                    >
                      {selected && <View className="h-2 w-2 rounded-full bg-blue-600" />}
                    </View>
                    <AppText variant="sm" weight={selected ? "semibold" : "normal"} className="text-zinc-700 dark:text-zinc-200">
                      {r.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {reason === "other" && (
              <View className="gap-1.5">
                <TextInput
                  value={detail}
                  onChangeText={setDetail}
                  maxLength={REPORT_DETAIL_MAX}
                  placeholder="어떤 점이 문제인지 적어주세요"
                  placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  autoFocus
                  maxFontSizeMultiplier={1.3}
                  className="min-h-[80px] w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <AppText variant="11" className="self-end text-zinc-400 dark:text-zinc-500" tabular>
                  {detail.length} / {REPORT_DETAIL_MAX}
                </AppText>
              </View>
            )}

            {report.error && (
              <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
                {report.error.message}
              </AppText>
            )}

            <View className="flex-row justify-end gap-2">
              <Button variant="outline" label="취소" onPress={close} />
              <Button
                variant="danger"
                label={report.isPending ? "접수 중…" : "신고하기"}
                pending={report.isPending}
                disabled={!reason}
                onPress={submit}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
