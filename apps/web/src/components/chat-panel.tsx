"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { AuthUser } from "@supabase/supabase-js";
import { MessageCircle, Send, X } from "lucide-react";
import { CHAT_CONTENT_MAX } from "@gongmoa/core";
import { createClient } from "@/lib/supabase/client";
import { LoginLink } from "@/components/login-link";
import { sendChatMessage, type ChatMessage } from "@/app/chat/actions";

// 화면에 한 번에 보여줄 최근 메시지 수. 채팅은 지금 대화가 중요하지 목록을
// 무한스크롤로 훑는 화면이 아니라서, 페이지네이션 없이 최근 것만 보여준다.
// 메시지당 최대 300자라 300개를 받아도 수백 KB 수준이고, 말풍선 300개를 그리는
// 것도 가상 스크롤 없이 충분히 가벼워서 부담 없이 넉넉하게 잡는다.
const HISTORY_LIMIT = 300;
// 이 안에 있을 때만 새 메시지에 맞춰 자동으로 따라 내려간다 — 지난 대화를 읽으려고
// 위로 올려둔 사람을 방해하지 않는다.
const AUTOSCROLL_THRESHOLD_PX = 120;

type ChatMessageRow = {
  id: string;
  user_id: string;
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
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<AuthUser | null | "pending">("pending");
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 뒤 화면 스크롤 잠금 + Esc로 닫기 — 사이트의 다른 모달(review-guide-modal 등)과 같은 규칙.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
        onClick={(e) => e.stopPropagation()}
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
          {messages === null ? (
            <p className="py-8 text-center text-xs text-zinc-400">불러오는 중…</p>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-xs text-pretty text-zinc-400">
              아직 메시지가 없어요. 첫 메시지를 남겨보세요.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {messages.map((m) => {
                const mine = user !== "pending" && user?.id === m.userId;
                return (
                  <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine && (
                      <span className="mb-0.5 px-1 text-[11px] font-bold text-zinc-400">
                        {m.nickname}
                      </span>
                    )}
                    <span
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] text-pretty break-words ${
                        mine
                          ? "rounded-br-sm bg-blue-600 text-white"
                          : "rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {m.content}
                    </span>
                  </li>
                );
              })}
            </ul>
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
    </div>,
    document.body,
  );
}
