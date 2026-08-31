import {
  BookOpenCheck,
  BrainCircuit,
  CalendarCheck,
  Crown,
  FileStack,
  Library,
  Megaphone,
  MessageSquarePlus,
  Receipt,
  Settings,
  Star,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { isAttendanceOpen, isFreeForAll } from "@gongmoa/core";

// 헤더 메뉴바가 쓰는 항목 정의. 데스크톱 메뉴바·모바일 드로어·계정 드롭다운이
// 전부 이 한 곳을 읽는다 — 세 군데에 각자 링크를 적어두면 메뉴가 하나 늘 때마다
// 어딘가 한 곳은 빠진 채로 배포된다.
//
// 표시 순서는 "자료를 찾는다 → 내가 푼 걸 되돌아본다 → 결제한다" 순이다. 공시생이
// 이 사이트에서 하는 일 자체가 그 순서라, 메뉴를 처음 보는 사람도 왼쪽부터 읽으면
// 사이트가 뭘 해주는 곳인지 알게 된다.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  // 현재 경로가 이 항목에 속하는지. usePathname은 쿼리스트링을 안 주므로 판별은
  // 경로만으로 한다(오답노트처럼 href에 ?tab=이 붙는 항목은 상세 경로로 잡는다).
  match: (pathname: string) => boolean;
  // 모바일 드로어에서 라벨 아래 한 줄로 붙는 설명. 좁은 화면에서는 라벨만으로
  // 뭘 하는 메뉴인지 짐작이 안 되는 항목이 있어서, 첫 방문자를 위해 붙인다.
  hint?: string;
};

// 메뉴바 본줄. 로그인 여부와 상관없이 항상 같은 항목을 보여준다 — 인증 결과가
// 스트리밍으로 늦게 도착하는 구조라(layout.tsx), 로그인 여부에 따라 항목 수가
// 달라지면 메뉴바가 눈앞에서 한 번 출렁인다.
export const PRIMARY_NAV: NavItem[] = [
  {
    href: "/",
    label: "기출문제",
    icon: FileStack,
    // 문제지 상세·CBT·해설은 전부 홈의 목록에서 들어가는 자리라 같은 메뉴로 묶는다.
    match: (p) => p === "/" || p.startsWith("/papers"),
    hint: "검색·연도별로 찾기",
  },
  {
    href: "/subjects",
    label: "과목별",
    icon: Library,
    // 시험별(/exams)은 메뉴바에서 뺐지만 페이지 자체는 남아 있다 — 과목별 목록
    // 맨 아래("시험으로 찾기")와 푸터에서 여전히 닿는다. 과목축 하나만 메뉴에 남기는
    // 게 "국어 기출문제"처럼 과목명으로 찾아오는 절대다수 검색 흐름과 더 맞는다.
    match: (p) => p.startsWith("/subjects"),
    hint: "국어·영어·전공",
  },
  {
    href: "/mypage?tab=wrong-notes",
    label: "오답노트",
    icon: BookOpenCheck,
    match: (p) => p.startsWith("/mypage/wrong-notes"),
    hint: "틀린 문제 복습하기",
  },
  // 출석체크는 기능이 열려 있을 때만 메뉴에 둔다(core 의 isAttendanceOpen —
  // 전면 무료 이벤트 동안에는 닫혀 있다). 항목을 남겨두면 도장이 찍히지 않는
  // 화면으로 "출석 채우고 멤버십 받기"라며 보내게 된다. 이벤트가 끝나면 이 줄이
  // 저절로 다시 살아난다.
  ...(isAttendanceOpen()
    ? [
        {
          href: "/mypage?tab=attendance",
          label: "출석체크",
          icon: CalendarCheck,
          // ?tab=attendance 는 경로가 /mypage 그대로라 활성 판별을 걸 수 없다(계정
          // 메뉴의 즐겨찾기 항목과 같은 처리). 문제를 풀면 서버가 자동으로 도장을
          // 찍으므로 이 항목은 "그 결과를 보러 가는" 링크다.
          match: () => false,
          hint: "출석 채우고 멤버십 받기",
        },
      ]
    : []),
  {
    href: "/diagnosis",
    label: "AI 약점 진단",
    icon: BrainCircuit,
    // 소개 페이지(/diagnosis)로 보낸다 — 결과 화면(/mypage/diagnosis)은 로그인·
    // 오답이 쌓여 있어야 뜻이 있는 자리라, 처음 누른 사람에게는 "이게 뭘 해주는
    // 기능인지"가 먼저 닿아야 한다. 두 경로 다 이 항목으로 활성 표시한다.
    match: (p) => p.startsWith("/diagnosis") || p.startsWith("/mypage/diagnosis"),
    hint: "왜 틀리는지 개념 단위로 분석",
  },
  {
    href: "/membership",
    label: "멤버십",
    icon: Crown,
    match: (p) => p.startsWith("/membership"),
    // 이벤트 기간에는 힌트로 "지금은 무료"를 먼저 말한다. 라벨(멤버십)만 보고
    // "돈 내라는 메뉴"로 읽고 지나치면, 정작 그 안에 있는 게 무료라는 사실이
    // 닿지 않는다. 이벤트가 끝나면 원래 설명으로 저절로 돌아간다.
    hint: isFreeForAll() ? "지금은 전부 무료예요" : "해설·복습 이용권",
  },
];

// 계정 메뉴(데스크톱 드롭다운 / 모바일 드로어 아래쪽). 두 덩어리로 나뉜다 —
// 위는 "내 학습 기록", 아래는 "계정·결제". 섞어두면 8줄짜리 목록이라 눈이 훑지 못한다.
export const ACCOUNT_NAV: NavItem[][] = [
  [
    {
      href: "/mypage",
      label: "마이페이지",
      icon: UserRound,
      match: (p) => p === "/mypage",
    },
    {
      href: "/mypage?tab=history",
      label: "내 시험 기록",
      icon: Trophy,
      // ?tab=history는 경로가 /mypage 그대로라 활성 판별을 걸 수 없다(마이페이지와
      // 같은 자리를 두 항목이 동시에 파랗게 만든다). 상세 기록 경로만 잡는다.
      match: (p) => p.startsWith("/mypage/attempts"),
    },
    {
      href: "/mypage?tab=bookmarks",
      label: "즐겨찾기",
      icon: Star,
      match: () => false,
    },
  ],
  [
    {
      href: "/mypage/payments",
      label: "결제 내역",
      icon: Receipt,
      match: (p) => p.startsWith("/mypage/payments"),
    },
    {
      href: "/mypage/edit",
      label: "내 정보 수정",
      icon: Settings,
      match: (p) => p.startsWith("/mypage/edit"),
    },
    // 건의게시판은 계정 메뉴에 둔다 — 메뉴바 본줄(PRIMARY_NAV)은 "자료를 찾는"
    // 흐름이라 성격이 다르고, 지금도 이미 5개(기출문제·과목별·오답노트·출석체크·
    // 멤버십)라 여기 하나만 더 넣어도 768px(md) 폭에서 줄이 넘친다(실측: 항목 라벨이
    // 두 줄로 접힌다). 비회원도 목록은 볼 수 있게 푸터에도 같은 링크가 있다
    // (site-footer.tsx).
    {
      href: "/suggestions",
      label: "건의게시판",
      icon: MessageSquarePlus,
      match: (p) => p.startsWith("/suggestions"),
    },
    // 공지사항도 건의게시판과 같은 이유로 계정 메뉴에 둔다(메뉴바 본줄은 이미
    // 5개라 하나만 더 늘어도 768px(md) 폭에서 줄이 넘친다). 비회원도 볼 수 있게
    // 푸터에도 같은 링크가 있다(site-footer.tsx).
    {
      href: "/notices",
      label: "공지사항",
      icon: Megaphone,
      match: (p) => p.startsWith("/notices"),
    },
  ],
];

// 아바타에 넣을 글자. 이모지·서로게이트 쌍이 반으로 잘리지 않도록 코드포인트 단위로 자른다.
export function avatarInitial(nickname: string): string {
  return [...nickname.trim()][0] ?? "회";
}
