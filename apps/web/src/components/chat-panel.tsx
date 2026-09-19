"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@supabase/supabase-js";
import { Ellipsis, Flag, MessageCircle, Send, UserX, X } from "lucide-react";
import { CHAT_CONTENT_MAX, filterBlocked } from "@gongmoa/core";
import { createClient } from "@/lib/supabase/client";
import { LoginLink } from "@/components/login-link";
import { BoardReportDialog } from "@/components/board-report-dialog";
import { BLOCK_CONFIRM_MESSAGE } from "@/components/board-post-actions";
import { blockUser } from "@/app/board/actions";
import { sendChatMessage, type ChatMessage } from "@/app/chat/actions";

// 화면에 한 번에 보여줄 최근 메시지 수. 채팅은 지금 대화가 중요하지 목록을
// 무한스크롤로 훑는 화면이 아니라서, 페이지네이션 없이 최근 것만 보여준다.
// 메시지당 최대 300자라 300개를 받아도 수백 KB 수준이고, 말풍선 300개를 그리는
// 것도 가상 스크롤 없이 충분히 가벼워서 부담 없이 넉넉하게 잡는다.
const HISTORY_LIMIT = 300;
// 이 안에 있을 때만 새 메시지에 맞춰 자동으로 따라 내려간다 — 지난 대화를 읽으려고
// 위로 올려둔 사람을 방해하지 않는다.
const AUTOSCROLL_THRESHOLD_PX = 120;
// 비로그인·조회 전의 차단 집합. 매 렌더 새 Set 을 만들면 아래 useMemo 가 매번 다시 돈다.
const EMPTY_SET: ReadonlySet<string> = new Set();

type ChatMessageRow = {
  id: string;
  // null = 탈퇴한 회원의 메시지(설계서 §12-2 #17 — 행은 남고 user_id 만 끊긴다).
  user_id: string | null;
  nickname: string;
  content: string;
  created_at: string;
};

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    content: row.content,
    createdAt: row.created_at,
  };
}

// 이미 있는 id면 그대로 두고, 없으면 뒤에 붙인다. 본인이 보낸 메시지는 서버 액션
// 응답으로 먼저 그려지고, 잠시 뒤 실시간 구독으로 같은 메시지가 한 번 더 들어오므로
// 중복을 막아야 한다.
function appendUnique(prev: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === message.id)) return prev;
  return [...prev, message];
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<AuthUser | null | "pending">("pending");
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 신고·차단(설계서 §12-2 #16 — 채팅 메시지도 UGC 라 게시판과 같은 수단이 있어야 한다).
  // blockedIds: 로그인 사용자의 차단 집합. 게시판은 서버가 거르지만 채팅은 Realtime 으로 브라우저에
  // 직접 들어오므로 여기서 걸러야 한다 — user_blocks 는 "select own" RLS 라 내 행만 온다. 로그인
  // 상태가 바뀔 때 다시 읽고, 비로그인은 빈 집합(메뉴도 없다).
  // menuFor: 지금 ⋯ 메뉴가 열린 메시지 id. reportId: 신고 다이얼로그가 열린 메시지 id.
  // 집합은 읽은 사용자 id 와 함께 둔다 — 로그아웃·계정 전환 뒤 이전 사용자의 집합이 남지 않게(아래
  // blockedIds 가 현재 사용자 것일 때만 쓴다). 비로그인은 언제나 빈 집합.
  const [blockedFor, setBlockedFor] = useState<{ userId: string; ids: ReadonlySet<string> } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [, startBlock] = useTransition();

  // Esc 처리기가 읽는 최신 값. 효과의 의존성에 넣으면 메뉴를 열 때마다 효과가 다시 돌아 닫기 버튼에
  // 포커스가 튄다 — ref 로 읽어 효과는 처음 한 번만 건다.
  const overlayRef = useRef({ reportId, menuFor });
  useEffect(() => {
    overlayRef.current = { reportId, menuFor };
  }, [reportId, menuFor]);

  // 뒤 화면 스크롤 잠금 + Esc로 닫기 — 사이트의 다른 모달(review-guide-modal 등)과 같은 규칙.
  // 신고 다이얼로그가 위에 열려 있으면 Esc 는 그쪽이 받고(같이 닫히면 채팅까지 사라진다), ⋯ 메뉴가
  // 열려 있으면 메뉴만 닫는다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (overlayRef.current.reportId) return;
      if (overlayRef.current.menuFor) {
        setMenuFor(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 차단 집합은 마운트(로그인 판정 뒤)에 한 번, 로그인 상태가 바뀌면 다시. 조회 실패는 빈 집합 —
  // 차단 필터가 실패했다고 채팅을 막을 이유는 없다(lib/blocks.ts 와 같은 규칙).
  const userId = user === "pending" ? null : (user?.id ?? null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase
      .from("user_blocks")
      .select("blocked_id")
      .then(({ data, error: readError }) => {
        if (!alive) return;
        const rows = readError ? [] : ((data ?? []) as { blocked_id: string }[]);
        setBlockedFor({ userId, ids: new Set(rows.map((row) => row.blocked_id)) });
      });
    return () => {
      alive = false;
    };
  }, [supabase, userId]);
  const blockedIds: ReadonlySet<string> = blockedFor && blockedFor.userId === userId ? blockedFor.ids : EMPTY_SET;

  function confirmBlock(targetId: string) {
    setMenuFor(null);
    if (!window.confirm(BLOCK_CONFIRM_MESSAGE)) return;
    setBlockError(null);
    startBlock(async () => {
      const result = await blockUser(targetId);
      if (result.error) {
        setBlockError(result.error);
        return;
      }
      // 서버 왕복을 기다리지 않고 집합에 넣는다 — 그 사용자의 메시지가 곧바로 사라지는 것이 확인
      // 문구다(게시판 상세가 안내 블록으로 바뀌는 것과 같은 뜻). 뒤 화면의 게시판도 새로 그린다.
      // 메뉴는 로그인 사용자에게만 그려지므로 여기서 userId 는 비어 있지 않다.
      setBlockedFor((prev) => ({
        userId: userId ?? "",
        ids: new Set([...(prev && prev.userId === userId ? prev.ids : []), targetId]),
      }));
      router.refresh();
    });
  }

  // 화면에 그릴 메시지 — 이력·실시간 수신 모두 여기서 걸러진다(core filterBlocked 는 authorId 를
  // 보므로 userId 를 그 이름으로 붙여 넘긴다). 탈퇴한 회원(null)의 메시지는 언제나 남는다.
  const visible = useMemo(
    () =>
      messages === null
        ? null
        : filterBlocked(
            messages.map((m) => ({ ...m, authorId: m.userId })),
            blockedIds,
          ),
    [messages, blockedIds],
  );

  // 로그인 상태 추적. 패널이 열려 있는 동안 로그인/로그아웃하면 입력창이 즉시 바뀐다.
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setUser(data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // 최근 메시지 이력을 불러오고, 새 메시지를 실시간으로 구독한다. 읽기는 비회원도
  // 되므로(schema.sql 의 public read 정책) 로그인 여부와 무관하게 항상 켠다.
  useEffect(() => {
    let alive = true;

    supabase
      .from("chat_messages")
      .select("id, user_id, nickname, content, created_at")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        if (!alive) return;
        const rows = (data ?? []) as ChatMessageRow[];
        setMessages(rows.map(rowToMessage).reverse());
      });

    const channel = supabase
      .channel("chat_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const row = payload.new as ChatMessageRow;
          setMessages((prev) => appendUnique(prev ?? [], rowToMessage(row)));
        },
      )
      // 관리자가 기록을 지우면(admin/chat) 열어 둔 채팅창에서도 바로 사라지게 한다 —
      // 지운 이유가 비방·개인정보일 때 새로고침할 때까지 남아 있으면 지운 의미가 없다.
      // DELETE 페이로드에는 replica identity 기본값 탓에 기본키만 담겨 온다.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        (payload) => {
          const deletedId = (payload.old as { id?: string }).id;
          if (!deletedId) return;
          setMessages((prev) => (prev ? prev.filter((m) => m.id !== deletedId) : prev));
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // 새 메시지가 오면 맨 아래로 따라 내려간다(단, 이미 바닥 근처에 있을 때만).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < AUTOSCROLL_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    setError(null);
    startTransition(async () => {
      const result = await sendChatMessage(content);
      if (result.error) {
        setError(result.error);
        return;
      }
      setInput("");
      if (result.message) {
        const sent = result.message;
        setMessages((prev) => appendUnique(prev ?? [], sent));
      }
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="채팅"
      onClick={onClose}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-start bg-zinc-900/40 backdrop-blur-sm sm:p-5 dark:bg-black/60"
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          // 패널 안 아무 데나 누르면 열린 ⋯ 메뉴를 닫는다(메뉴·⋯ 버튼은 자기 클릭을 여기까지 올리지 않는다).
          if (menuFor) setMenuFor(null);
        }}
        className="animate-modal-panel-in flex h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:h-[32rem] sm:max-w-sm sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-4 pt-3 pb-3 dark:border-zinc-800 dark:from-blue-950/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
            <MessageCircle size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold tracking-tight">공모아 채팅방</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              누구나 볼 수 있어요 · 채팅은 회원만 할 수 있어요
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/70 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        >
          {visible === null ? (
            <p className="py-8 text-center text-xs text-zinc-400">불러오는 중…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-pretty text-zinc-400">
              아직 메시지가 없어요. 첫 메시지를 남겨보세요.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visible.map((m) => {
                const mine = userId !== null && userId === m.userId;
                // 남의 메시지에만, 로그인했을 때만 ⋯(비로그인은 메뉴 없음). 탈퇴한 회원(null)의
                // 메시지는 차단할 대상이 없어 그리지 않는다 — 게시판 상세의 더보기와 같은 규칙.
                const canAct = !mine && userId !== null && m.userId !== null;
                const menuOpen = menuFor === m.id;
                return (
                  <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine && (
                      <span className="mb-0.5 px-1 text-[11px] font-bold text-zinc-400">
                        {m.nickname}
                      </span>
                    )}
                    {/* 말풍선 옆에 ⋯ 를 두려고 감싼 줄. 반드시 w-full — 폭이 내용에 맞는(fit-content) 상자면 말풍선의
                        max-w-[85%] 가 li 가 아니라 이 상자의 폭에 대해 풀려, 짧은 메시지도 제 폭의 85% 에서 줄이
                        바뀐다(CSS 순환 퍼센트 — 최종 배치에서는 퍼센트가 그대로 풀린다). li 폭을 채우고 좌우
                        정렬은 여기서 한다. */}
                    <div className={`relative flex w-full items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                      <span
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] text-pretty break-words ${
                          mine
                            ? "rounded-br-sm bg-blue-600 text-white"
                            : "rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        {m.content}
                      </span>
                      {/* 길게 누르기·우클릭 없이 말풍선 옆 작은 ⋯ 로 연다 — 폰 브라우저에는 길게
                          누르기가 텍스트 선택이고, 우클릭은 터치에 없다. */}
                      {canAct && (
                        <button
                          type="button"
                          aria-label="더보기"
                          aria-expanded={menuOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setBlockError(null);
                            setMenuFor(menuOpen ? null : m.id);
                          }}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        >
                          <Ellipsis size={14} />
                        </button>
                      )}
                      {menuOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          // 목록이 overflow 스크롤 상자라 맨 아래 메시지의 메뉴는 잘린다 — 열리는 순간
                          // 메뉴가 보이는 자리까지 목록을 내린다.
                          ref={(el) => el?.scrollIntoView({ block: "nearest" })}
                          className="animate-modal-panel-in absolute top-full left-0 z-10 mt-1 flex w-40 origin-top-left flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null);
                              setReportId(m.id);
                            }}
                            className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <Flag size={15} className="text-zinc-600 dark:text-zinc-300" />
                            신고
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmBlock(m.userId as string)}
                            className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-red-600 transition-colors hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
                          >
                            <UserX size={15} />
                            이 사용자 차단
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {blockError && (
            <p role="alert" className="px-1 pt-2 text-[11px] text-rose-500">
              {blockError}
            </p>
          )}
        </div>

        <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          {user === "pending" ? null : user === null ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
              <p className="text-[12px] font-medium text-pretty text-zinc-600 dark:text-zinc-300">
                로그인하고 채팅에 참여해보세요.
              </p>
              <LoginLink className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-blue-700" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (error) setError(null);
                  }}
                  maxLength={CHAT_CONTENT_MAX}
                  placeholder="메시지를 입력하세요"
                  aria-label="메시지 입력"
                  className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-[13px] focus:border-blue-400 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:focus:bg-zinc-900"
                />
                <button
                  type="submit"
                  disabled={pending || !input.trim()}
                  aria-label="보내기"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                >
                  <Send size={15} />
                </button>
              </div>
              {error && <p className="px-1 text-[11px] text-rose-500">{error}</p>}
            </form>
          )}
        </div>
      </div>

      {reportId && (
        <BoardReportDialog target="chat_message" targetId={reportId} onClose={() => setReportId(null)} />
      )}
    </div>,
    document.body,
  );
}
