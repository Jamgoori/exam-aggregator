"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BUSINESS_EMAIL, BUSINESS_INFO, hasBusinessInfo } from "@/lib/business";

export function SiteFooter() {
  const pathname = usePathname();
  // CBT/복습 풀이 화면은 몰입형 레이아웃이라(site-header-gate와 동일 기준) 푸터도 숨긴다 —
  // 풀이 중 스크롤 끝에 푸터가 걸리면 OMR 조작을 방해한다.
  const isImmersiveSolvePage =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");
  if (isImmersiveSolvePage) return null;

  return (
    <footer className="mt-6 border-t border-zinc-100 print:hidden dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {/* 이 두 링크가 사이트 전체의 크롤 진입점이다 — 모든 화면에 붙어 있어서
              홈 → 목록 허브 → 과목/시험 → 문제지 로 이어지는 서버 렌더 경로를
              만든다. (홈의 ㄱㄴㄷ 탭·급수 버튼은 클라이언트 상태라 HTML에 <a>가
              없다.) 과목축과 시험축 둘 다 필요하다: 수험생은 "국어 기출문제"로도
              "2026 국가직 9급 기출문제"로도 검색한다. */}
          <Link href="/exams" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            시험별 기출문제
          </Link>
          <Link href="/subjects" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            과목별 기출문제
          </Link>
          <Link href="/membership" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            멤버십 요금제
          </Link>
          <Link href="/notices" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            공지사항
          </Link>
          <Link
            href="/suggestions"
            className="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            건의게시판
          </Link>
          <Link href="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            이용약관
          </Link>
          <Link
            href="/privacy"
            className="font-medium hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            개인정보처리방침
          </Link>
          <a
            href="mailto:lks2354@gmail.com"
            className="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            문의
          </a>
        </div>
        <BusinessInfo />

        <p>© 2026 공모아 — 공무원 기출문제 자료실</p>
      </div>
    </footer>
  );
}

// 전자상거래법 제10조가 요구하는 사업자 표기. 값은 lib/business.ts 한 곳에 있고,
// 아직 사업자등록 전이라 비어 있으면 아무것도 그리지 않는다 — 반쪽짜리 표기는
// 없는 것보다 나쁘다. PG 심사 전에 반드시 채울 것(가장 흔한 반려 사유다).
function BusinessInfo() {
  if (!hasBusinessInfo) return null;

  const items = [
    `상호 ${BUSINESS_INFO.name}`,
    BUSINESS_INFO.representative && `대표 ${BUSINESS_INFO.representative}`,
    `사업자등록번호 ${BUSINESS_INFO.registrationNumber}`,
    BUSINESS_INFO.mailOrderNumber && `통신판매업신고 ${BUSINESS_INFO.mailOrderNumber}`,
    BUSINESS_INFO.address,
    BUSINESS_INFO.phone && `전화 ${BUSINESS_INFO.phone}`,
    `이메일 ${BUSINESS_EMAIL}`,
    BUSINESS_INFO.privacyOfficer && `개인정보 보호책임자 ${BUSINESS_INFO.privacyOfficer}`,
  ].filter((v): v is string => !!v);

  return (
    <address className="flex flex-wrap gap-x-3 gap-y-1 not-italic leading-5 text-zinc-400 dark:text-zinc-600">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </address>
  );
}
