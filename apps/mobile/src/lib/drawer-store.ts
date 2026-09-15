import { useSyncExternalStore } from "react";

// 헤더 햄버거 ↔ 루트에 한 번 마운트된 NavDrawer 를 잇는 작은 외부 스토어(웹 포털 대응).
// 전역 상태 라이브러리는 추가하지 않는다(설계서 §3.5).
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export function openDrawer() {
  set(true);
}

export function closeDrawer() {
  set(false);
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => open,
  );
}
