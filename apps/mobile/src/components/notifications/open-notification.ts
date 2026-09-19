import type { NotificationItem } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { useCallback } from "react";
import { isAllowedAppPath } from "../../lib/next-path";
import { useMarkNotificationRead } from "../../queries/notifications";

// 알림 한 줄을 눌렀을 때의 동작. 종(Sheet)과 목록 화면이 **같은 규칙**을 써야 해서 여기 하나로 둔다.
//
// 읽음 처리는 이동을 막지 않는다(결과를 기다리지 않는다 — 웹 notification-bell.tsx 와 같다).
//
// 이동은 한 번 거른다: 알림의 `link` 는 웹 경로이고, 지금 알림을 만드는 곳은 게시판·건의글이다 —
// 게시판(`/board/*`)은 Phase 5 1라운드, 건의(`/suggestions/*`)는 2라운드에서 열려 지금은 둘 다 이동한다.
// 그래도 거르는 이유: 앞으로 웹에 새 알림 링크가 생겼는데 앱 화면이 아직 없으면, 그대로 router.push 한
// 링크는 누를 때마다 `+not-found` 로 떨어져 "알림이 고장났다"로 읽힌다. 그래서 next 화이트리스트
// (lib/next-path.ts — 딥링크·로그인 복귀가 쓰는 그 매처)를 지나는 경로만 이동하고, 앱에 없는 화면이면
// **읽음 처리만 하고 그 자리에 머문다**.
// 오류 문구를 띄우지 않는 이유: 사용자가 잘못한 것이 없고, 눌러서 "읽음"이 된 것만으로도 목록을
// 정리하는 뜻은 이룬다. 화면이 생기는 단계에 매처에 줄이 늘면 이동은 저절로 열린다(웹은 언제나
// 바로 이동한다 — 웹에는 모든 화면이 있다).
export function useOpenNotification(): (item: NotificationItem) => void {
  // mutate 만 꺼내 쓴다 — useMutation 이 돌려주는 객체는 렌더마다 새로 만들어지지만 mutate 는
  // 고정이라, 이 콜백이 줄마다 다시 만들어지지 않는다.
  const { mutate: markRead } = useMarkNotificationRead();
  return useCallback(
    (item: NotificationItem) => {
      if (!item.isRead) markRead(item.id);
      const pathname = item.link.split(/[?#]/, 1)[0] ?? "/";
      if (isAllowedAppPath(pathname)) router.push(item.link as Href);
    },
    [markRead],
  );
}
