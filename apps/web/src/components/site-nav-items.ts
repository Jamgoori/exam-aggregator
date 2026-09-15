import {
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CalendarCheck,
  Crown,
  FileStack,
  Library,
  Megaphone,
  MessagesSquare,
  MessageSquarePlus,
  Receipt,
  Settings,
  Shuffle,
  Star,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  ACCOUNT_NAV as ACCOUNT_NAV_DATA,
  PRIMARY_NAV as PRIMARY_NAV_DATA,
  type NavIconName,
  type NavItemData,
} from "@gongmoa/core";

// 헤더 메뉴바가 쓰는 항목 정의. 데스크톱 메뉴바·모바일 드로어·계정 드롭다운이
// 전부 이 한 곳을 읽는다. 항목 데이터(href·라벨·힌트·활성 판별·순서)는
// @gongmoa/core 의 nav-items.ts 가 정본이고(모바일 드로어와 공유), 여기서는 core 가
// 문자열로 적어둔 아이콘 이름을 lucide-react 컴포넌트로 바꿔 끼우기만 한다.
// 메뉴를 하나 늘리려면 core 쪽 배열에 넣고, 새 아이콘이면 아래 표에 한 줄 더한다 —
// NavIconName 유니온이 core 에 있어서 이름을 빠뜨리면 여기서 타입 오류가 난다.

const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CalendarCheck,
  Crown,
  FileStack,
  Library,
  Megaphone,
  MessagesSquare,
  MessageSquarePlus,
  Receipt,
  Settings,
  Shuffle,
  Star,
  Trophy,
  UserRound,
};

export type NavItem = Omit<NavItemData, "icon"> & { icon: LucideIcon };

function withIcon(item: NavItemData): NavItem {
  return { ...item, icon: NAV_ICONS[item.icon] };
}

// 메뉴바 본줄. 로그인 여부와 상관없이 항상 같은 항목을 보여준다(core 주석 참고).
export const PRIMARY_NAV: NavItem[] = PRIMARY_NAV_DATA.map(withIcon);

// 계정 메뉴(데스크톱 드롭다운 / 모바일 드로어 아래쪽). 두 덩어리 — "내 학습 기록" /
// "계정·결제".
export const ACCOUNT_NAV: NavItem[][] = ACCOUNT_NAV_DATA.map((group) => group.map(withIcon));

// 헤더·서랍·계정 메뉴가 함께 쓰는 로그인 사용자 정보. 네 파일에 같은 모양을
// 따로 적어두면 필드가 하나 늘 때마다 한 곳은 빠진 채로 배포된다.
export type HeaderUser = {
  nickname: string;
  isAdmin: boolean;
  isPremium: boolean;
  avatarUrl: string | null;
};
