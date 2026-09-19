import { filterBlocked } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Lock, Pin } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { BoardMoreMenu, HEADER_BUTTON_CLASS, HEADER_BUTTON_TEXT } from "../../../src/components/board/board-post-actions";
import { Button } from "../../../src/components/button";
import { InlineAlert } from "../../../src/components/feedback";
import { loginHref } from "../../../src/components/login-link";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { SuggestionAnswerForm } from "../../../src/components/suggestions/suggestion-answer-form";
import { SuggestionComments } from "../../../src/components/suggestions/suggestion-comments";
import { SuggestionDeleteButton } from "../../../src/components/suggestions/suggestion-delete-button";
import { formatSuggestionDateTime } from "../../../src/components/suggestions/suggestion-format";
import { useBlockedIds } from "../../../src/queries/board";
import { useSuggestion, useSuggestionComments, type SuggestionDetail } from "../../../src/queries/suggestions";
import { useAuth } from "../../../src/providers/auth-provider";
import { themedIcon } from "../../../src/theme/icons";

// `/suggestions/[id]`(설계서 §5 행, O — 비밀글은 작성자·관리자) — 웹 app/suggestions/[id]/page.tsx +
// suggestion-answer-form.tsx + suggestion-comments.tsx 이식. 블록 순서도 웹과 같다: "← 건의게시판" → 머리
// (배지·제목·작성자 줄) → 본문 → 수정·삭제 → 운영자 답변 → (관리자) 답변 폼 → 댓글.
//
// 상세는 EF suggestions get 의 세 갈래를 그대로 받는다(queries/suggestions.ts): not_found → 404(웹 notFound),
// forbidden → 잠긴 안내(웹은 "없는 글"처럼 감추지 않는다 — 목록에 자리는 이미 보이므로 404 로 돌려보내면
// 무슨 일인지 알 수 없다), ok → 본문. canEdit/canDelete 는 서버가 뷰어 기준으로 실어 준 값이고, 조회수도 서버가
// get 안에서 센다(본인·관리자 제외 — 앱이 따로 부를 RPC 없음).
//
// 본문은 **서식 없는 텍스트**다 — 웹이 `whitespace-pre-wrap` 인 p 하나로 그리고 RichTextContent 를 쓰지 않는다.
//
// 차단(§6.7 #18): 글쓴이를 차단했으면 본문 대신 안내 한 줄(게시판과 같은 문구), 댓글은 core filterBlocked 로
// 뺀다. 더보기(신고·차단)는 남의 글에만, 그리고 탈퇴한 회원의 글(authorId null — 차단할 계정이 없다)에는
// 그리지 않는다. 신고 대상 종류는 'suggestion'(RPC report_content).
const PinIcon = themedIcon(Pin);
const LockIcon = themedIcon(Lock);

export default function SuggestionRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : undefined;
  const { userId, loading } = useAuth();
  const result = useSuggestion(id);

  // 순서(§6.9): 스켈레톤 → InlineAlert+재시도 → 없으면 404(웹 notFound) → 잠김 → 본문. 세션 판정이 끝나기 전에는
  // 스켈레톤을 유지한다 — 비로그인 키('guest')로 먼저 받아 잠긴 안내를 그렸다가 로그인 키로 바뀌며 본문이 나타나는
  // 깜빡임(그리고 비밀글이 아닌 글의 조회수 이중 카운트)을 막는다.
  if (loading || result.isPending) {
    return (
      <Screen contentClassName="gap-6">
        <SuggestionSkeleton />
      </Screen>
    );
  }
  if (result.isError) {
    return (
      <Screen contentClassName="gap-6">
        <InlineAlert
          message={result.error instanceof Error ? result.error.message : "글을 불러오지 못했어요."}
          onRetry={() => void result.refetch()}
        />
      </Screen>
    );
  }
  if (result.data.status === "not_found") return <NotFoundScreen />;
  if (result.data.status === "forbidden") return <ForbiddenScreen id={id!} loggedIn={userId !== null} />;
  return (
    <SuggestionScreen
      suggestion={result.data.suggestion}
      isRefetching={result.isRefetching}
      refetch={() => void result.refetch()}
    />
  );
}

// 웹 forbidden 분기 1:1 — 자물쇠 + "비밀글이에요" + 로그인 여부에 따른 안내 + 로그인(게스트만)·목록으로.
function ForbiddenScreen({ id, loggedIn }: { id: string; loggedIn: boolean }) {
  return (
    <Screen contentClassName="gap-6">
      <View className="w-full max-w-2xl items-center gap-4 self-center px-4 py-24">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <LockIcon size={22} colorClassName="text-zinc-400 dark:text-zinc-500" />
        </View>
        <AppText variant="lg" weight="bold" accessibilityRole="header" className="text-center">
          비밀글이에요
        </AppText>
        <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400" pretty>
          {loggedIn
            ? "이 글은 작성자와 운영자만 볼 수 있어요."
            : "이 글은 작성자와 운영자만 볼 수 있어요. 본인 글이라면 로그인 후 다시 확인해주세요."}
        </AppText>
        <View className="flex-row gap-2">
          {!loggedIn && (
            <Button label="로그인" onPress={() => router.push(loginHref(`/suggestions/${id}`) as Href)} className="rounded-lg px-4 py-2" />
          )}
          <Button
            variant="outline"
            label="목록으로"
            onPress={() => router.navigate("/suggestions" as Href)}
            className="rounded-lg px-4 py-2"
          />
        </View>
      </View>
    </Screen>
  );
}

function SuggestionScreen({
  suggestion,
  isRefetching,
  refetch,
}: {
  suggestion: SuggestionDetail;
  isRefetching: boolean;
  refetch: () => void;
}) {
  const { userId, isAdmin } = useAuth();
  const comments = useSuggestionComments(suggestion.id);
  const { ids: blockedIds } = useBlockedIds();
  const visibleComments = useMemo(() => filterBlocked(comments.data ?? [], blockedIds), [comments.data, blockedIds]);

  const loggedIn = userId !== null;
  const isOwn = userId !== null && userId === suggestion.authorId;
  const blocked = suggestion.authorId !== null && blockedIds.has(suggestion.authorId);

  return (
    <Screen
      contentClassName="gap-6"
      refreshing={isRefetching}
      onRefresh={() => {
        refetch();
        void comments.refetch();
      }}
    >
      <Pressable accessibilityRole="link" onPress={() => router.navigate("/suggestions" as Href)} hitSlop={6} className="self-start">
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
          ← 건의게시판
        </AppText>
      </Pressable>

      {blocked ? (
        <View className="gap-2 rounded-2xl border border-dashed border-zinc-200 px-4 py-10 dark:border-zinc-700">
          <AppText variant="sm" weight="medium" className="text-center text-zinc-600 dark:text-zinc-400" pretty>
            차단한 사용자의 글이에요.
          </AppText>
          <AppText variant="xs" className="text-center text-zinc-400 dark:text-zinc-500" pretty>
            차단한 사용자의 글과 댓글은 보이지 않아요. 내 정보 수정에서 해제할 수 있어요.
          </AppText>
        </View>
      ) : (
        <>
          <View className="gap-4">
            <View className="gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
              <View className="flex-row flex-wrap items-center gap-2">
                {suggestion.isPinned && (
                  <View className="flex-row items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-950/40">
                    <PinIcon size={11} colorClassName="text-amber-700 dark:text-amber-400" />
                    <AppText variant="11" weight="medium" allowFontScaling={false} className="text-amber-700 dark:text-amber-400">
                      공지
                    </AppText>
                  </View>
                )}
                {suggestion.isSecret && (
                  <View className="flex-row items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                    <LockIcon size={11} colorClassName="text-zinc-600 dark:text-zinc-300" />
                    <AppText variant="11" weight="medium" allowFontScaling={false} className="text-zinc-600 dark:text-zinc-300">
                      비밀글
                    </AppText>
                  </View>
                )}
                <View
                  className={[
                    "rounded-full px-2 py-0.5",
                    suggestion.answer ? "bg-blue-50 dark:bg-blue-950/40" : "bg-zinc-100 dark:bg-zinc-800",
                  ].join(" ")}
                >
                  <AppText
                    variant="11"
                    weight="medium"
                    allowFontScaling={false}
                    className={suggestion.answer ? "text-blue-600 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400"}
                  >
                    {suggestion.answer ? "답변완료" : "답변 대기"}
                  </AppText>
                </View>
              </View>

              <AppText variant="xl" weight="bold" accessibilityRole="header" pretty>
                {suggestion.title}
              </AppText>

              <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                  {suggestion.nickname}
                </AppText>
                <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                  {formatSuggestionDateTime(suggestion.createdAt)}
                </AppText>
                {suggestion.updatedAt && (
                  <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                    (수정됨)
                  </AppText>
                )}
                <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                  조회 {String(suggestion.viewCount)}
                </AppText>
              </View>
            </View>

            {/* 웹 `min-h-24 text-sm leading-7 whitespace-pre-wrap text-zinc-700` — RN Text 는 개행을 그대로 그린다. */}
            <AppText variant="sm" className="min-h-24 leading-7 text-zinc-700 dark:text-zinc-200" pretty>
              {suggestion.content}
            </AppText>

            {/* 웹은 수정·삭제가 있을 때만 이 줄을 그린다. 더보기(⋯ 신고·차단)는 웹에 없는 것으로 남의 글에만 붙는다 —
                본인 글은 수정·삭제만, 남의 글은 더보기만 나오는 셈이라 줄 하나에 같이 둔다. */}
            {(suggestion.canEdit || suggestion.canDelete || (!isOwn && suggestion.authorId !== null)) && (
              <View className="flex-row flex-wrap items-center justify-end gap-2">
                {suggestion.canEdit && (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push(`/suggestions/${suggestion.id}/edit` as Href)}
                    className={[HEADER_BUTTON_CLASS, "active:border-blue-300 dark:active:border-blue-800"].join(" ")}
                  >
                    <AppText variant="xs" weight="medium" className={HEADER_BUTTON_TEXT}>
                      수정
                    </AppText>
                  </Pressable>
                )}
                {suggestion.canDelete && <SuggestionDeleteButton id={suggestion.id} />}
                {!isOwn && suggestion.authorId !== null && (
                  <BoardMoreMenu postId={suggestion.id} authorId={suggestion.authorId} loggedIn={loggedIn} target="suggestion" />
                )}
              </View>
            )}
          </View>

          {suggestion.answer && (
            <View className="gap-2 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
              <View className="flex-row items-center gap-2">
                <AppText variant="sm" weight="semibold" className="text-blue-700 dark:text-blue-300">
                  운영자 답변
                </AppText>
                {suggestion.answeredAt && (
                  <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                    {formatSuggestionDateTime(suggestion.answeredAt)}
                  </AppText>
                )}
              </View>
              <AppText variant="sm" className="leading-7 text-zinc-700 dark:text-zinc-200" pretty>
                {suggestion.answer}
              </AppText>
            </View>
          )}

          {/* 관리자 판정은 useAuth().isAdmin(EF get 의 canAnswer 와 같은 근거 — admins 화이트리스트). 답변 폼은 저장한
              답변을 초기값으로 다시 열어야 하므로(웹은 페이지 새로고침으로 리마운트) answer 를 key 로 준다. */}
          {isAdmin && (
            <SuggestionAnswerForm key={suggestion.answer ?? ""} suggestionId={suggestion.id} initialAnswer={suggestion.answer} />
          )}

          <View className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
            {comments.isPending ? (
              <View className="gap-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-20 rounded-lg" delay={80} />
                <Skeleton className="h-14 rounded-lg" delay={160} />
              </View>
            ) : comments.isError ? (
              <InlineAlert
                message={comments.error instanceof Error ? comments.error.message : "댓글을 불러오지 못했어요."}
                onRetry={() => void comments.refetch()}
              />
            ) : (
              <SuggestionComments suggestionId={suggestion.id} comments={visibleComments} loggedIn={loggedIn} />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

// 머리(배지·제목·작성자 줄) + 본문 자리. 웹에는 상세 loading.tsx 가 없어 목록 스켈레톤 구도를 따랐다.
function SuggestionSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-20" />
      <View className="gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
        <Skeleton className="h-5 w-16 rounded-full" delay={50} />
        <Skeleton className="h-7 w-full" delay={100} />
        <Skeleton className="h-3 w-48" delay={150} />
      </View>
      <Skeleton className="h-24 w-full rounded-xl" delay={200} />
    </>
  );
}
