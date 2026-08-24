"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type {
  HomePopupContext,
  HomePopupControls,
  HomePopupSlide,
  HomePopupSource,
} from "@/lib/home-popup";
import { betaNoticeSource } from "./beta-notice-slide";
import { reviewNudgeSource } from "./review-nudge-slide";
import { attendancePromoSource } from "./attendance-promo-slide";

// 홈 팝업 슬라이드 판. 규칙과 배경은 lib/home-popup.ts 머리말 참고.

// 앞에 둔 것이 앞 장이 된다. 복습 유도를 맨 앞에 두는 건 그 장이 유일하게 "오늘 할 일"
// 이기 때문이다 — 그 장이 뜬 사람은 이미 로그인해서 문제를 풀어본 사람이라, 처음 온
// 사람에게 필요한 개발 중 안내보다 이쪽이 먼저 닿아야 한다. 처음 온 사람에게는 애초에
// 복습 장이 안 뜨므로 개발 중 안내가 자연히 첫 장이 된다.
const SOURCES: HomePopupSource[] = [reviewNudgeSource, betaNoticeSource, attendancePromoSource];

// 한 박자 늦게 띄운다. 화면이 그려지는 순간 같이 덮으면 사용자가 뭘 열었는지도 모르는
// 채로 닫기부터 누른다 — 도착한 화면을 먼저 보게 두는 것.
const OPEN_DELAY_MS = 500;

// 판의 최대 폭. 비율이 고정된 장이 실렸을 때만 쓴다 — 24rem(=max-w-sm, 글 폭의 기본)
// 을 넘지 않으면서, 세로가 짧은 화면에서는 그 장이 통째로 들어갈 만큼 좁아진다.
// 6.5rem 은 버튼 띠와 점(dot) 띠가 가져가는 높이.
const PANEL_MAX_WIDTH = (aspect: number) => `min(24rem, calc((92dvh - 6.5rem) * ${aspect}))`;

// 손가락이 이만큼(판 너비의 18%, 최소 40px) 움직여야 장을 넘긴다. 너무 짧으면 세로로
// 스크롤하려던 손짓에도 장이 넘어간다.
const SWIPE_RATIO = 0.18;
const SWIPE_MIN_PX = 40;

export function HomePopupSlider({ attendanceHref }: HomePopupContext) {
  const [slides, setSlides] = useState<HomePopupSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  // 사용자가 한 번 닫았으면 늦게 도착한 장이 판을 다시 열어선 안 된다.
  const closed = useRef(false);
  // 판이 떠서 사용자가 무언가를 보고 있는 상태인지. 뜨기 전에는 어떤 장이 먼저
  // 도착했든 첫 장(우선순위가 제일 높은 장)에서 시작해야 한다.
  const opened = useRef(false);
  // 목록의 거울. 늦게 도착한 장을 어디에 끼울지, 그래서 index 를 밀어야 하는지를
  // setSlides 바깥에서 계산하려고 둔다 — 갱신 함수 안에서 다른 setState 를 부르면
  // 그 함수가 두 번 불릴 때(StrictMode) 같은 일이 두 번 일어난다.
  const known = useRef<HomePopupSlide[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = { attendanceHref };

    // 후보들에게 동시에 물어본다. 저장소만 보는 쪽은 즉시 답하고, 서버를 보는
    // 복습 유도만 늦게 온다 — 그 하나 때문에 나머지를 붙잡아 두지 않는다.
    SOURCES.forEach((source, priority) => {
      Promise.resolve()
        .then(() => source.resolve(ctx))
        .then((slide) => {
          if (!alive || !slide || closed.current) return;
          const prev = known.current;
          if (prev.some((s) => s.id === slide.id)) return;
          // 우선순위 자리에 끼워 넣는다.
          const found = prev.findIndex((s) => priorityOf(s) > priority);
          const at = found < 0 ? prev.length : found;
          const next = [...prev];
          next.splice(at, 0, slide);
          known.current = next;
          setSlides(next);
          // 이미 판이 떠 있는데 앞자리에 끼어들었다면 index 를 한 칸 밀어 보고 있던
          // 장을 그대로 둔다 — 눈앞의 안내가 소리 없이 바뀌면 방금 읽던 문장을 잃는다.
          // 아직 뜨기 전이라면 아무도 아무것도 안 봤으므로 언제나 첫 장에서 시작한다.
          setIndex((i) => (!opened.current ? 0 : at <= i ? i + 1 : i));
        })
        .catch(() => {
          // 조회 실패는 조용히 넘긴다. 안내 팝업이 에러를 띄울 자리는 아니다.
        });
    });

    const id = window.setTimeout(() => {
      if (!alive || closed.current) return;
      opened.current = true;
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [attendanceHref]);

  const close = useCallback(() => {
    closed.current = true;
    setOpen(false);
  }, []);

  // 이 장만 걷어낸다. 남은 장이 없으면 판이 닫힌다.
  const dismiss = useCallback((id: string) => {
    const next = known.current.filter((s) => s.id !== id);
    known.current = next;
    setSlides(next);
    if (next.length === 0) {
      closed.current = true;
      setOpen(false);
      return;
    }
    // 마지막 장을 치웠으면 한 칸 앞으로 당겨야 빈자리를 보여주지 않는다.
    setIndex((i) => Math.min(i, next.length - 1));
  }, []);

  if (!open || slides.length === 0) return null;

  return (
    <HomePopupPanel
      slides={slides}
      index={Math.min(index, slides.length - 1)}
      onIndexChange={setIndex}
      onClose={close}
      onDismiss={dismiss}
    />
  );
}

function priorityOf(slide: HomePopupSlide): number {
  const at = SOURCES.findIndex((s) => s.id === slide.id);
  return at < 0 ? SOURCES.length : at;
}

// 판 자체. open 이 된 뒤에만 마운트된다 — 높이를 재는 useLayoutEffect 가 서버 렌더에
// 걸리지 않게 하려는 것도 있다.
function HomePopupPanel({
  slides,
  index,
  onIndexChange,
  onClose,
  onDismiss,
}: {
  slides: HomePopupSlide[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDismiss: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touch = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  // 넘기려고 쓸어넘긴 손짓이 그대로 클릭이 되면(광고 이미지가 링크다) 원치 않는
  // 화면으로 끌려간다. 그래서 쓸어넘긴 **직후에 오는** 클릭만 삼킨다.
  // "한 번 삼킨다"는 깃발로 두지 않는 이유: 넘긴 뒤 클릭이 아예 안 올 때도 있어서
  // (브라우저가 스스로 억제한다) 깃발이 남아 있다가 한참 뒤 누른 버튼을 대신 먹는다.
  const swipedAt = useRef(0);

  const active = slides[index];
  const many = slides.length > 1;
  // 비율을 요구하는 장이 여럿이면 제일 좁은(세로로 긴) 쪽에 맞춘다 — 하나라도 잘리면
  // 안 되기 때문이다. 요구하는 장이 없으면 폭을 제한하지 않는다.
  const aspect = slides.reduce<number | null>(
    (min, s) => (s.aspect == null ? min : min == null ? s.aspect : Math.min(min, s.aspect)),
    null,
  );

  const go = useCallback(
    (to: number) => onIndexChange(Math.max(0, Math.min(to, slides.length - 1))),
    [onIndexChange, slides.length],
  );

  // 이 장이 실제로 보인 순간 한 번 "봤다"를 기록한다. 실려만 있고 넘겨 보지 않은 장은
  // 기록하지 않아, 다음 방문에 다시 기회를 얻는다(lib/home-popup.ts).
  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!active || shown.current.has(active.id)) return;
    shown.current.add(active.id);
    active.onShown?.();
  }, [active]);

  // 열려 있는 동안 뒤 화면은 스크롤되지 않게 막는다.
  //
  // 함께 거는 overscroll-behavior-x 는 크롬의 "가로로 쓸면 뒤로 가기" 때문이다.
  // 장을 넘기려고 오른쪽으로 쓸면 그 손짓을 브라우저가 가져가 이전 페이지로 나가버려서,
  // 사용자는 팝업이 아니라 보던 사이트를 잃는다(실측). 넘기는 판에 touch-action: pan-y
  // 를 줘도 막히지 않아 문서 쪽에 걸어야 하고, 판을 닫으면 원래대로 돌려놓는다 —
  // 사이트 전체에서 뒤로 가기 제스처를 뺏을 이유는 없다.
  useEffect(() => {
    const body = document.body.style;
    const root = document.documentElement.style;
    const previousOverflow = body.overflow;
    const previousOverscroll = root.overscrollBehaviorX;
    body.overflow = "hidden";
    root.overscrollBehaviorX = "contain";
    return () => {
      body.overflow = previousOverflow;
      root.overscrollBehaviorX = previousOverscroll;
    };
  }, []);

  // Esc 로 닫고, 좌우 키로 넘긴다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "ArrowRight") go(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, index]);

  // 장마다 내용 높이가 크게 다르다(짧은 복습 유도 ↔ 세로로 긴 광고 이미지). 판 높이를
  // 제일 큰 장에 맞춰 고정하면 짧은 장이 텅 빈 채로 보이므로, 보고 있는 장의 높이를
  // 재서 판이 그만큼만 차지하게 하고 넘어갈 때 높이도 함께 움직인다.
  // 재는 대상은 [data-slide] 조각들(본문 내용 + 버튼 띠)이다. 스크롤 영역 자체가 아니라
  // 그 안의 내용을 재야 눌리지 않은 원래 높이가 나온다. 이미지가 늦게 도착해 높이가
  // 바뀌는 경우까지 잡으려고 ResizeObserver 를 쓴다.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const read = () => {
      const next: Record<string, number> = {};
      for (const el of track.querySelectorAll<HTMLElement>("[data-slide]")) {
        const id = el.dataset.slide;
        if (id) next[id] = (next[id] ?? 0) + el.offsetHeight;
      }
      setHeights((prev) => {
        const same =
          Object.keys(next).length === Object.keys(prev).length &&
          Object.entries(next).every(([id, h]) => prev[id] === h);
        return same ? prev : next;
      });
    };
    const observer = new ResizeObserver(read);
    for (const el of track.querySelectorAll<HTMLElement>("[data-slide]")) observer.observe(el);
    read();
    return () => observer.disconnect();
  }, [slides]);

  function onTouchStart(e: React.TouchEvent) {
    if (!many) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, axis: null };
  }

  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 처음 몇 px 로 세로인지 가로인지 정하고, 세로면 손을 뗀다 — 본문을 스크롤하려던
    // 손짓까지 가로채면 긴 장을 읽을 수 없다.
    if (!start.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (start.axis === "x") setDragging(true);
    }
    if (start.axis !== "x") return;
    // 양 끝에서는 덜 끌려간다 — 더 넘길 게 없다는 걸 손으로 알려주는 것.
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === slides.length - 1);
    setDrag(atEdge ? dx * 0.3 : dx);
  }

  function onTouchEnd() {
    const start = touch.current;
    touch.current = null;
    setDragging(false);
    if (start?.axis === "x") {
      swipedAt.current = performance.now();
      const width = trackRef.current?.clientWidth ?? 0;
      const threshold = Math.max(SWIPE_MIN_PX, width * SWIPE_RATIO);
      if (drag <= -threshold) go(index + 1);
      else if (drag >= threshold) go(index - 1);
    }
    setDrag(0);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active?.title ?? "안내"}
      onClick={onClose}
      className="animate-modal-fade-in fixed inset-0 z-[60] flex items-end justify-center bg-zinc-900/50 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/70"
    >
      {/* 비율이 고정된 장(출석 광고 이미지)이 실려 있으면 판의 폭을 화면 높이에 묶는다.
          세로가 짧은 기기(가로로 든 폰·작은 창)에서 폭을 그대로 두면 그림이 판 밖으로
          넘쳐 잘리는데, 높이를 줄이는 대신 폭을 같은 비율로 줄이면 그림 좌우에 빈
          여백이 생기지 않는다. 6.5rem 은 버튼 띠와 점(dot) 띠가 쓰는 높이.
          글로만 된 장뿐이면 이 제한을 걸지 않는다 — 넘치면 본문이 스크롤되면 그만이라,
          창이 낮다고 글 폭까지 좁힐 이유가 없다.
          pb-[env(safe-area-inset-bottom)] — 아이폰에서 판이 화면 바닥에 붙으므로 홈
          인디케이터가 맨 아래 버튼 위에 겹친다. 그만큼 아래를 비워 둔다. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={aspect ? { maxWidth: PANEL_MAX_WIDTH(aspect) } : undefined}
        className="animate-modal-panel-in relative flex max-h-[92dvh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-2xl sm:pb-0 dark:bg-zinc-900 dark:ring-white/10"
      >
        {/* 닫기(X)는 판에 하나만 둔다. 장마다 다른 자리에 있으면 넘길 때마다 X 가
            옮겨 다녀서, 닫으려던 사람이 매번 눈으로 다시 찾아야 한다.
            그림 장(광고) 위에서는 어떤 색 위에 얹힐지 모르므로 반투명 칩으로 띄우고,
            글로 된 장에서는 판 색을 그대로 두고 아이콘만 옅게 얹는다 — 흰 판 위의
            회색 원은 눌리지 않는 버튼처럼 보인다. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className={`absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            active?.aspect != null
              ? "bg-zinc-900/25 text-white backdrop-blur-sm hover:bg-zinc-900/45"
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          }`}
        >
          <X size={18} />
        </button>

        <div
          ref={trackRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onClickCapture={(e) => {
            // 브라우저가 손을 뗀 직후에 만들어 보내는 클릭. 그 창(400ms) 밖의 클릭은
            // 사용자가 정말 누른 것이다.
            if (performance.now() - swipedAt.current > 400) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          // touch-action: pan-y — 가로로 쓸어넘기는 건 우리가 처리하고, 세로 스크롤만
          // 브라우저에 맡긴다(본문이 길면 그 안에서 스크롤돼야 한다). 다만 이것만으로는
          // 크롬의 "뒤로 가기" 제스처가 막히지 않아서, 그쪽은 위의 overscroll-behavior-x
          // 가 맡는다.
          style={{ height: active ? heights[active.id] : undefined, touchAction: "pan-y" }}
          className="min-h-0 overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
        >
          <div
            style={{ transform: `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)` }}
            className={`flex h-full ${
              dragging ? "" : "transition-transform duration-300 ease-out motion-reduce:transition-none"
            }`}
          >
            {slides.map((slide, i) => {
              const controls: HomePopupControls = {
                close: onClose,
                dismiss: () => onDismiss(slide.id),
              };
              return (
                // inert — 보이지 않는 장의 버튼에 탭 키나 화면낭독기가 들어가면,
                // 사용자는 자기가 어디에 있는지 모르는 채로 다른 장의 버튼을 누른다.
                <div key={slide.id} inert={i !== index} className="flex w-full shrink-0 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    <div data-slide={slide.id}>{slide.body(controls)}</div>
                  </div>
                  {slide.footer && (
                    <div data-slide={slide.id} className="shrink-0">
                      {slide.footer(controls)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 장이 하나뿐이면 넘길 것이 없으므로 띠 자체를 두지 않는다 — 예전 팝업과 똑같이
            보인다. 화살표를 내용 위에 얹지 않고 이 띠에 넣는 이유는, 얹으면 좁은 화면에서
            글자나 광고를 가리기 때문이다. */}
        {many && (
          <div className="relative flex shrink-0 items-center justify-center gap-1.5 border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
            <ArrowButton
              direction="prev"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            />
            <div className="flex items-center">
              {slides.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`${slide.title} 보기`}
                  aria-current={i === index}
                  className="flex h-7 w-5 items-center justify-center"
                >
                  <span
                    className={
                      i === index
                        ? "h-1.5 w-4 rounded-full bg-zinc-700 transition-all dark:bg-zinc-200"
                        : "h-1.5 w-1.5 rounded-full bg-zinc-300 transition-all dark:bg-zinc-600"
                    }
                  />
                </button>
              ))}
            </div>
            <ArrowButton
              direction="next"
              disabled={index === slides.length - 1}
              onClick={() => go(index + 1)}
            />
            <span className="pointer-events-none absolute right-3 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">
              {index + 1}/{slides.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "이전 안내" : "다음 안내"}
      className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:pointer-events-none disabled:opacity-25 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      {direction === "prev" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  );
}
