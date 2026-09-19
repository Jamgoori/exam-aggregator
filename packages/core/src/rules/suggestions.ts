import type { SupabaseClient } from "@supabase/supabase-js";
import { authorNickname } from "../nickname";
import { notificationPreview } from "../notifications";
import { isPaperUuid } from "../paper-slug";
import {
  SUGGESTIONS_PAGE_SIZE,
  canDeleteSuggestion,
  canDeleteSuggestionComment,
  canEditSuggestion,
  canEditSuggestionComment,
  canPinSuggestion,
  canReadSuggestion,
  suggestionListTitle,
  validateSuggestionAnswer,
  validateSuggestionCommentContent,
  validateSuggestionInput,
  type SuggestionViewer,
} from "../suggestions";
import {
  HOURLY_LIMIT_ERROR,
  SUGGESTION_COMMENT_HOURLY_LIMIT,
  SUGGESTION_HOURLY_LIMIT,
  overHourlyLimit,
} from "./hourly-limit";
import { createNotification } from "./notify";

// 건의게시판 규칙 — 읽기와 쓰기 전부. 웹 lib/suggestions.ts(읽기)·suggestions/actions.ts(쓰기)와
// Edge Function `suggestions` 가 이 함수들의 얇은 어댑터다. 웹에 있던 본문을 **그대로** 옮겨 왔고
// 문구·순서·반환 모양을 새로 짓지 않았다(AGENTS.md "모바일 파리티").
//
// **읽기까지 규칙에 있는 이유**: suggestions·suggestion_comments 는 anon/authenticated 의 SELECT
// 조차 회수돼 있다(schema.sql — 목록에 남의 비밀글 자리는 "비밀글입니다" 로 보여야 하는데 RLS 로
// 행을 숨기면 그 자리가 사라지고, 열면 본문이 REST 로 샌다). 그래서 게시판·공지와 달리 앱도
// 표를 직접 읽지 못하고 Edge 를 통해 읽는다(설계서 §6.2 "SELECT 조차 회수", §6.7 #19). 읽은 행에서
// 볼 권한이 없는 값을 지우는 마스킹(canReadSuggestion·suggestionListTitle)이 곧 규칙이라, 웹과
// Edge 가 각자 마스킹을 하면 어느 한쪽이 언젠가 title 을 그대로 내보낸다.
//
// 인자 규칙(rules/board.ts 와 같다):
//   client — service_role 클라이언트(읽기도 service_role — 위 이유).
//   viewer — 목록·상세를 보는 사람. 비로그인은 { userId: null, isAdmin: false }.
//   actor  — 세션에서 확정한 작성자. 닉네임은 클라이언트가 보내는 값을 믿지 않고 user_metadata
//            에서 읽는다(웹은 세션 값을 넘기고 Edge 는 admin API 로 읽는다 — resolveNickname).
//
// user_id 가 null 인 행은 탈퇴한 회원의 글이다(설계서 §12-2 #17). can* 는 전부 false 로 떨어지고,
// 알림은 받을 사람이 없어 보내지 않는다(rules/notify.ts).

export type SuggestionActor = SuggestionViewer & {
  userId: string;
  // user_metadata.nickname 원본. 웹은 세션에서 넘기고 Edge 는 생략한다(admin 으로 읽는다).
  metadataNickname?: unknown;
};

// 실패는 문구와 **HTTP 상태**를 함께 돌려준다(rules/board.ts 와 같은 이유). 웹 서버 액션은 문구만
// 쓴다.
//   400 잘못된 입력·검증 실패   403 남의 글·댓글, 볼 수 없는 비밀글에 댓글   404 글·댓글 없음
//   429 시간당 한도            500 저장 실패
export type SuggestionRuleError = { error: string; status: 400 | 403 | 404 | 429 | 500 };

export type SuggestionDeps = {
  // 시간당 한도·updated_at 의 기준 시각. 테스트가 고정하려고 주입한다.
  now?: () => Date;
};

function nowOf(deps: SuggestionDeps): Date {
  return deps.now ? deps.now() : new Date();
}

// ── 읽기 ───────────────────────────────────────────────────────────────────

const LIST_COLUMNS =
  "id, user_id, nickname, title, is_secret, is_pinned, view_count, answer, created_at";

// 화면에 내려보내는 목록 한 줄. 볼 수 없는 비밀글은 여기서 이미 제목이 지워진 상태로
// 만들어진다 — "가리기"를 컴포넌트에 맡기면 언젠가 한 군데가 그냥 title 을 그려버린다(그 순간
// 남의 비밀글 제목이 HTML·JSON 에 실려 나간다).
export type SuggestionListItem = {
  id: string;
  title: string;
  nickname: string;
  createdAt: string;
  viewCount: number;
  isSecret: boolean;
  isPinned: boolean;
  isAnswered: boolean;
  // 자물쇠 아이콘을 회색(못 봄)/파랑(내 글)으로 나눠 그리는 데만 쓴다.
  readable: boolean;
  // null = 탈퇴한 회원의 글. 앱의 차단 필터(core filterBlocked — 목록에서 차단한 사용자의 글을 뺀다)가
  // 보는 값이라 볼 수 없는 비밀글에도 실린다 — 닉네임이 이미 보이는 자리라 새로 새는 것은 없고, 차단한
  // 사람의 비밀글 자리까지 함께 숨겨야 "그 사람의 글이 보이지 않는다" 가 성립한다(Edge 응답 추가 필드).
  authorId: string | null;
};

export type SuggestionDetail = {
  id: string;
  title: string;
  content: string;
  nickname: string;
  createdAt: string;
  updatedAt: string | null;
  viewCount: number;
  isSecret: boolean;
  isPinned: boolean;
  answer: string | null;
  answeredAt: string | null;
  // null = 탈퇴한 회원의 글.
  authorId: string | null;
  canEdit: boolean;
  canDelete: boolean;
};

export type SuggestionCommentItem = {
  id: string;
  nickname: string;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  // null = 탈퇴한 회원의 댓글. 목록의 authorId 와 같은 용도(앱 차단 필터) — 댓글은 원글을 볼 수 있는
  // 사람에게만 내려가므로 새로 새는 값이 아니다.
  authorId: string | null;
};

export type SuggestionPage = {
  items: SuggestionListItem[];
  pinnedItems: SuggestionListItem[];
  total: number;
  totalPages: number;
};

type ListRow = Record<string, unknown>;

function toListItem(row: ListRow, viewer: SuggestionViewer): SuggestionListItem {
  const post = {
    user_id: (row.user_id as string | null) ?? null,
    is_secret: row.is_secret as boolean,
    title: row.title as string,
  };
  return {
    id: row.id as string,
    title: suggestionListTitle(post, viewer),
    nickname: row.nickname as string,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    isSecret: post.is_secret,
    isPinned: row.is_pinned as boolean,
    isAnswered: (row.answer as string | null) !== null,
    readable: canReadSuggestion(post, viewer),
    authorId: post.user_id,
  };
}

// 고정 공지는 페이지 1에서만 목록 맨 위에 따로 얹어 보여준다 — 매 페이지마다 반복해서 보여주면
// "몇 번째 페이지에 있었더라"를 헷갈리게 한다. 일반 글의 번호 매김·페이지 수는 공지를 뺀 개수로만
// 계산해, 공지가 몇 건 늘어도 흔들리지 않는다.
export async function fetchSuggestionPage(
  client: SupabaseClient,
  page: number,
  viewer: SuggestionViewer,
): Promise<SuggestionPage> {
  const from = (page - 1) * SUGGESTIONS_PAGE_SIZE;

  const [{ data, count }, pinnedResult] = await Promise.all([
    client
      .from("suggestions")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("is_pinned", false)
      .order("created_at", { ascending: false })
      .range(from, from + SUGGESTIONS_PAGE_SIZE - 1),
    page === 1
      ? client
          .from("suggestions")
          .select(LIST_COLUMNS)
          .eq("is_pinned", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as ListRow[] }),
  ]);

  const total = count ?? 0;
  const items = ((data ?? []) as ListRow[]).map((row) => toListItem(row, viewer));
  const pinnedItems = ((pinnedResult.data ?? []) as ListRow[]).map((row) => toListItem(row, viewer));

  return {
    items,
    pinnedItems,
    total,
    totalPages: Math.max(1, Math.ceil(total / SUGGESTIONS_PAGE_SIZE)),
  };
}

export type FetchSuggestionResult =
  | { status: "ok"; suggestion: SuggestionDetail }
  | { status: "not_found" }
  | { status: "forbidden" };

export async function fetchSuggestion(
  client: SupabaseClient,
  id: string,
  viewer: SuggestionViewer,
): Promise<FetchSuggestionResult> {
  const { data } = await client
    .from("suggestions")
    .select(
      "id, user_id, nickname, title, content, is_secret, is_pinned, view_count, answer, answered_at, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return { status: "not_found" };

  const post = {
    user_id: (data.user_id as string | null) ?? null,
    is_secret: data.is_secret as boolean,
  };
  if (!canReadSuggestion(post, viewer)) return { status: "forbidden" };

  return {
    status: "ok",
    suggestion: {
      id: data.id as string,
      title: data.title as string,
      content: data.content as string,
      nickname: data.nickname as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string | null,
      viewCount: data.view_count as number,
      isSecret: post.is_secret,
      isPinned: data.is_pinned as boolean,
      answer: data.answer as string | null,
      answeredAt: data.answered_at as string | null,
      authorId: post.user_id,
      canEdit: canEditSuggestion(post, viewer),
      canDelete: canDeleteSuggestion(post, viewer),
    },
  };
}

// 조회수. 내 글을 내가 열어본 것과 관리자 확인은 세지 않는다 — 그걸 세면 답변을 쓰는 동안
// 조회수만 올라가서 "몇 명이 이 건의를 봤나"라는 원래 의미가 없어진다.
// authorId 가 null(탈퇴한 회원의 글)이면 "내 글" 일 수 없으므로 비로그인(userId null)도 센다.
// increment_suggestion_view 는 service_role 전용 함수라 여기서만 부른다.
export async function countSuggestionView(
  client: SupabaseClient,
  id: string,
  viewer: SuggestionViewer,
  authorId: string | null,
): Promise<void> {
  if (viewer.isAdmin || (authorId !== null && viewer.userId === authorId)) return;
  await client.rpc("increment_suggestion_view", { p_suggestion_id: id });
}

// 댓글은 상세 화면이 fetchSuggestion 으로 원글 접근 권한(canReadSuggestion)을 이미 확인한 뒤에만
// 호출된다 — 비밀글의 댓글에 별도 판단을 두지 않고 원글 판단에 얹혀가는 것이 목적이라, 여기서는
// 그 확인을 다시 하지 않는다(웹 lib 그대로). 원글 확인 없이 부를 수 있는 자리(Edge 의 comments
// 액션)는 아래 readSuggestionComments 를 쓴다.
export async function fetchSuggestionComments(
  client: SupabaseClient,
  suggestionId: string,
  viewer: SuggestionViewer,
): Promise<SuggestionCommentItem[]> {
  const { data } = await client
    .from("suggestion_comments")
    .select("id, user_id, nickname, content, created_at, updated_at")
    .eq("suggestion_id", suggestionId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as ListRow[]).map((row) => {
    const ownership = { user_id: (row.user_id as string | null) ?? null };
    return {
      id: row.id as string,
      nickname: row.nickname as string,
      content: row.content as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string | null,
      canEdit: canEditSuggestionComment(ownership, viewer),
      canDelete: canDeleteSuggestionComment(ownership, viewer),
      authorId: ownership.user_id,
    };
  });
}

export type ReadSuggestionCommentsResult =
  | { status: "ok"; items: SuggestionCommentItem[] }
  | { status: "not_found" }
  | { status: "forbidden" };

// 원글 접근 권한을 **여기서** 확인한 뒤 댓글을 읽는다. Edge `suggestions` 의 comments 액션처럼
// 상세 조회와 별도 요청으로 오는 자리는 "이미 확인했다"는 전제가 없다 — 비밀글 id 만 알면 댓글이
// 따로 새는 경로가 되므로 원글 판단을 다시 얹는다.
export async function readSuggestionComments(
  client: SupabaseClient,
  suggestionId: string,
  viewer: SuggestionViewer,
): Promise<ReadSuggestionCommentsResult> {
  const { data } = await client
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!data) return { status: "not_found" };
  const post = {
    user_id: (data.user_id as string | null) ?? null,
    is_secret: data.is_secret as boolean,
  };
  if (!canReadSuggestion(post, viewer)) return { status: "forbidden" };
  return { status: "ok", items: await fetchSuggestionComments(client, suggestionId, viewer) };
}

// ── 쓰기 ───────────────────────────────────────────────────────────────────

// 클라이언트가 보낸 isPinned/isSecret 을 서버가 다시 확정한다. 체크박스는 비관리자 화면에서 아예
// 지워두지만, 폼 데이터를 직접 조작해 보내는 경로는 여기서 막아야 실제로 지켜진다("관리자만
// 고정할 수 있다" — canPinSuggestion). 공지는 성격상 비밀글일 이유가 없어, 고정되는 글은 비밀글
// 여부를 강제로 끈다.
function resolvePinAndSecret(
  input: { isSecret: boolean; isPinned: boolean },
  viewer: SuggestionViewer,
) {
  const isPinned = canPinSuggestion(viewer) && input.isPinned === true;
  const isSecret = isPinned ? false : input.isSecret === true;
  return { isPinned, isSecret };
}

export type SuggestionWriteInput = {
  actor: SuggestionActor;
  title: string;
  content: string;
  isSecret: boolean;
  isPinned?: boolean;
};

export async function createSuggestion(
  client: SupabaseClient,
  input: SuggestionWriteInput,
  deps: SuggestionDeps = {},
): Promise<SuggestionRuleError | { id: string }> {
  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { isPinned, isSecret } = resolvePinAndSecret(
    { isSecret: input.isSecret, isPinned: input.isPinned ?? false },
    input.actor,
  );

  if (await overHourlyLimit(client, "suggestions", input.actor.userId, SUGGESTION_HOURLY_LIMIT, nowOf(deps))) {
    return { error: HOURLY_LIMIT_ERROR, status: 429 };
  }

  // 작성자명은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의 이름으로 글을 쓸 수
  // 있다. 화면에 보이는 닉네임의 원본은 auth.users.raw_user_meta_data.nickname 이고(schema.sql
  // 참고) profiles 는 중복 판별용 그림자 원장이라, 댓글과 같은 순서로 읽는다.
  const nickname = authorNickname(await resolveNickname(client, input.actor));

  const { data, error } = await client
    .from("suggestions")
    .insert({
      user_id: input.actor.userId,
      nickname,
      title: validated.title,
      content: validated.content,
      is_secret: isSecret,
      is_pinned: isPinned,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요.", status: 500 };
  return { id: data.id as string };
}

export async function updateSuggestion(
  client: SupabaseClient,
  input: SuggestionWriteInput & { id: string },
  deps: SuggestionDeps = {},
): Promise<SuggestionRuleError | { id: string }> {
  const id = String(input.id ?? "");
  if (!isPaperUuid(id)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: post } = await client
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  const ownership = {
    user_id: (post.user_id as string | null) ?? null,
    is_secret: post.is_secret as boolean,
  };
  if (!canEditSuggestion(ownership, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  const { isPinned, isSecret } = resolvePinAndSecret(
    { isSecret: input.isSecret, isPinned: input.isPinned ?? false },
    input.actor,
  );

  const { error } = await client
    .from("suggestions")
    .update({
      title: validated.title,
      content: validated.content,
      is_secret: isSecret,
      is_pinned: isPinned,
      updated_at: nowOf(deps).toISOString(),
    })
    .eq("id", id)
    // 위에서 확인했지만 쓰기 문장에도 소유자를 박는다 — 읽기와 쓰기 사이의 경합·admin 클라이언트
    // (RLS 없음) 양쪽에 대한 방어선이다(rules/board.ts 와 같은 배치, §12-9 검토가 잡은 것). 수정은
    // 관리자에게도 열지 않으므로(canEditSuggestion) 조건이 언제나 붙는다.
    .eq("user_id", input.actor.userId);
  if (error) return { error: "수정에 실패했어요.", status: 500 };

  return { id };
}

export async function deleteSuggestion(
  client: SupabaseClient,
  input: { actor: SuggestionActor; id: string },
): Promise<SuggestionRuleError | { id: string }> {
  const id = String(input.id ?? "");
  if (!isPaperUuid(id)) return { error: "잘못된 접근입니다.", status: 400 };

  const { data: post } = await client
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  const ownership = {
    user_id: (post.user_id as string | null) ?? null,
    is_secret: post.is_secret as boolean,
  };
  if (!canDeleteSuggestion(ownership, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  // 관리자는 남의 글을 지울 수 있으므로 소유자 조건은 관리자가 아닐 때만 붙인다.
  let query = client.from("suggestions").delete().eq("id", id);
  if (!input.actor.isAdmin) query = query.eq("user_id", input.actor.userId);
  const { error } = await query;
  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  return { id };
}

// 관리자 답변 등록/수정. 답변은 본문과 별도 컬럼이라 원글은 그대로 남는다.
export async function answerSuggestion(
  client: SupabaseClient,
  input: { actor: SuggestionActor; id: string; answer: string },
  deps: SuggestionDeps = {},
): Promise<SuggestionRuleError | { id: string }> {
  const id = String(input.id ?? "");
  if (!isPaperUuid(id)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateSuggestionAnswer(input.answer);
  if ("error" in validated) return { error: validated.error, status: 400 };

  if (!input.actor.isAdmin) return { error: "권한이 없어요.", status: 403 };

  const { data: post } = await client
    .from("suggestions")
    .select("user_id, title")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  const { error } = await client
    .from("suggestions")
    .update({
      answer: validated.answer,
      answered_at: nowOf(deps).toISOString(),
      answered_by: input.actor.userId,
    })
    .eq("id", id);
  if (error) return { error: "답변 등록에 실패했어요.", status: 500 };

  // 건의를 남긴 사람에게 알린다 — 답변이 달렸는지 확인하러 매번 게시판에 들어와 보게 만들 이유가
  // 없다(이 알림이 이 기능의 원래 목적에 가장 가깝다). 글쓴이가 탈퇴했으면(user_id null) 받을
  // 사람이 없어 createNotification 이 건너뛴다.
  await createNotification(client, {
    userId: (post.user_id as string | null) ?? null,
    type: "suggestion_answer",
    actorId: input.actor.userId,
    actorNickname: "운영자",
    title: (post.title as string) ?? "건의글",
    preview: notificationPreview(validated.answer),
    link: `/suggestions/${id}`,
  });

  return { id };
}

// ── 댓글 ───────────────────────────────────────────────────────────────────

export async function createSuggestionComment(
  client: SupabaseClient,
  input: { actor: SuggestionActor; suggestionId: string; content: string },
  deps: SuggestionDeps = {},
): Promise<SuggestionRuleError | { id: string }> {
  const suggestionId = String(input.suggestionId ?? "");
  if (!isPaperUuid(suggestionId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: post } = await client
    .from("suggestions")
    .select("user_id, is_secret, title")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요.", status: 404 };

  // 댓글은 원글을 볼 수 있는 사람만 달 수 있다 — 여기서 다시 확인하지 않으면 비밀글의 id를
  // 알아낸 사람이 본문은 못 봐도 댓글로 흔적을 남길 수 있다. 문구는 웹 그대로("잘못된 접근입니다.").
  const ownership = {
    user_id: (post.user_id as string | null) ?? null,
    is_secret: post.is_secret as boolean,
  };
  if (!canReadSuggestion(ownership, input.actor)) {
    return { error: "잘못된 접근입니다.", status: 403 };
  }

  if (
    await overHourlyLimit(
      client,
      "suggestion_comments",
      input.actor.userId,
      SUGGESTION_COMMENT_HOURLY_LIMIT,
      nowOf(deps),
    )
  ) {
    return { error: HOURLY_LIMIT_ERROR, status: 429 };
  }

  const nickname = authorNickname(await resolveNickname(client, input.actor));

  const { error } = await client.from("suggestion_comments").insert({
    suggestion_id: suggestionId,
    user_id: input.actor.userId,
    nickname,
    content: validated.content,
  });
  if (error) return { error: "댓글 등록에 실패했어요.", status: 500 };

  // 글쓴이에게 알림. 실패해도 댓글은 이미 달렸으므로 여기서 되돌리지 않는다(rules/notify.ts).
  await createNotification(client, {
    userId: ownership.user_id,
    type: "suggestion_comment",
    actorId: input.actor.userId,
    actorNickname: nickname,
    title: (post.title as string) ?? "건의글",
    preview: notificationPreview(validated.content),
    link: `/suggestions/${suggestionId}`,
  });

  return { id: suggestionId };
}

export async function updateSuggestionComment(
  client: SupabaseClient,
  input: { actor: SuggestionActor; commentId: string; content: string },
  deps: SuggestionDeps = {},
): Promise<SuggestionRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: comment } = await client
    .from("suggestion_comments")
    .select("suggestion_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  if (!canEditSuggestionComment({ user_id: (comment.user_id as string | null) ?? null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  const { error } = await client
    .from("suggestion_comments")
    .update({ content: validated.content, updated_at: nowOf(deps).toISOString() })
    .eq("id", commentId)
    // 쓰기 문장에도 소유자를 박는다(글 수정과 같은 이유 — 댓글 수정도 본인만이다).
    .eq("user_id", input.actor.userId);
  if (error) return { error: "수정에 실패했어요.", status: 500 };

  return { id: comment.suggestion_id as string };
}

export async function deleteSuggestionComment(
  client: SupabaseClient,
  input: { actor: SuggestionActor; commentId: string },
): Promise<SuggestionRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const { data: comment } = await client
    .from("suggestion_comments")
    .select("suggestion_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  if (!canDeleteSuggestionComment({ user_id: (comment.user_id as string | null) ?? null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  // 관리자는 남의 댓글을 지울 수 있으므로 소유자 조건은 관리자가 아닐 때만 붙인다.
  let query = client.from("suggestion_comments").delete().eq("id", commentId);
  if (!input.actor.isAdmin) query = query.eq("user_id", input.actor.userId);
  const { error } = await query;
  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  return { id: comment.suggestion_id as string };
}

// 작성자명의 원본(user_metadata.nickname). 웹은 세션에서 이미 읽어 둔 값을 넘기고(왕복 하나를
// 아낀다), Edge 에는 그 세션이 없어 여기서 admin 으로 읽는다. 이메일 로컬파트로 떨어지지 않는다 —
// 그 값은 닉네임 정책(금칙어·중복)을 지나간 적이 없어서 "관리자" 같은 이름이 그대로 박힌다
// (../nickname.ts authorNickname 주석).
async function resolveNickname(client: SupabaseClient, actor: SuggestionActor): Promise<unknown> {
  if (actor.metadataNickname !== undefined) return actor.metadataNickname;
  const { data } = await client.auth.admin.getUserById(actor.userId);
  return (data?.user?.user_metadata as { nickname?: unknown } | undefined)?.nickname;
}
