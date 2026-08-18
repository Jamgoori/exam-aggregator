import Link from "next/link";
import { FileQuestion } from "lucide-react";

// Next 기본 404는 자체 인라인 스타일로 배경을 흰색으로 강제해서, 다크모드에서
// 전역 헤더(다크 배경용 흰 글씨)와 뒤섞여 깨져 보인다. 사이트 테마를 그대로
// 따르는 커스텀 404로 대체한다.
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-32 text-center">
      {/* 이 화면이 항상 404 로 나가지는 않는다 — PPR 구조에서는 셸이 이미 흘러간 뒤라
          라우트 안에서 부른 notFound() 가 200 으로 나간다(실측: /subjects/한국사 처럼
          없는 slug 가 200). 그대로 두면 구글에게는 "내용이 같은 200 페이지"가 slug 수
          만큼 생기는 셈이라, 레이아웃이 걸어 둔 index,follow 를 여기서 덮어 색인만은
          막는다. 상태 코드 자체를 고치는 것은 별건이다. */}
      <meta name="robots" content="noindex, follow" />
      <FileQuestion size={48} className="text-zinc-300 dark:text-zinc-600" />
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        주소가 잘못되었거나, 삭제된 페이지일 수 있어요.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}
