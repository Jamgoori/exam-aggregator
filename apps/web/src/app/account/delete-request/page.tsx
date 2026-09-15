import type { Metadata } from "next";
import Link from "next/link";

// Google Play 데이터 안전 섹션의 "계정 삭제 요청 웹 링크"와 App Review 가 여는
// 공개 안내 페이지. 스토어 심사자가 해외 IP 로 직접 열어 보므로 로그인 없이 보이고
// (lib/geo-block.ts 의 INFRA_FILES 에서 국가 차단 면제), 그 어떤 것도(cookies·
// searchParams·DB) 읽지 않는 정적 셸이다 — 읽는 순간 정적 셸에서 빠진다(AGENTS.md).
// 실제 삭제 버튼은 /mypage/edit 에 있고 Edge Function(account-delete)이 지운다.
//
// 스토어에 제출한 URL 이라 주소를 바꾸면 스토어 등록 정보도 같이 고쳐야 한다.
export const metadata: Metadata = {
  title: "계정 삭제 안내",
  // 검색 결과에 실릴 이유가 없는 안내 페이지다(약관·방침과 달리 콘텐츠가 아니다).
  robots: { index: false, follow: false },
};

const CONTACT_EMAIL = "lks2354@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function AccountDeleteRequestPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          계정 삭제(회원 탈퇴) 안내
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-500">
          공모아(이하 &ldquo;서비스&rdquo;) 계정은 앱과 웹 어디서든 직접 삭제할 수 있습니다.
          별도의 승인 절차 없이 요청 즉시 처리됩니다.
        </p>
      </div>

      <Section title="1. 계정을 삭제하는 방법">
        <ol className="list-decimal pl-5">
          <li>서비스에 로그인합니다(구글·카카오·Apple 계정).</li>
          <li>
            앱에서는 <strong>내 정보 수정</strong>, 웹에서는{" "}
            <Link
              href="/mypage/edit"
              className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              마이페이지 → 내 정보 수정
            </Link>
            으로 이동합니다.
          </li>
          <li>
            화면 맨 아래 <strong>회원 탈퇴</strong>를 누르고, 안내에 따라 확인 문구
            (&ldquo;탈퇴&rdquo;)를 입력한 뒤 탈퇴를 완료합니다.
          </li>
        </ol>
        <p className="mt-1">
          탈퇴는 되돌릴 수 없으며, 완료되는 즉시 로그아웃되고 같은 소셜 계정으로 다시
          로그인하면 새 계정으로 가입됩니다.
        </p>
      </Section>

      <Section title="2. 삭제되는 데이터">
        <p>탈퇴 즉시 계정과 계정에 연결된 아래 데이터가 삭제됩니다.</p>
        <ul className="list-disc pl-5">
          <li>계정 정보: 소셜 계정 식별자, 이메일 주소, 닉네임, 프로필 이미지</li>
          <li>
            학습 기록: CBT 응시 기록과 답안, 오답노트·복습 기록, 문항 메모, 문제지·과목
            북마크, 난이도 평가
          </li>
          <li>AI 약점 진단 요청 기록과 진단 리포트</li>
          <li>해설 열람·인쇄 기록, 알림, 출석 기록 등 이용 기록</li>
          <li>작성한 댓글·게시글의 작성자 정보</li>
        </ul>
      </Section>

      <Section title="3. 삭제 후에도 남는 데이터">
        <p>
          아래 항목은 개인정보처리방침에 따라 탈퇴 후에도 정해진 기간 동안 보관됩니다.
        </p>
        <ul className="list-disc pl-5">
          <li>
            작성한 댓글·게시글의 본문: 다른 이용자의 답글이 끊기지 않도록
            &ldquo;탈퇴한 회원&rdquo; 이름으로 남으며, 작성자를 식별할 수 있는 정보는
            제거됩니다.
          </li>
          <li>
            결제·환불 등 대금 결제 기록: 전자상거래법에 따라 <strong>5년간</strong> 보관
            후 파기합니다.
          </li>
          <li>
            무료 체험 이용 이력: 탈퇴·재가입을 반복해 무료 체험을 여러 번 받는 것을 막기
            위해, 체험을 시작한 이메일 주소를 복원할 수 없는 일방향 해시로만 보관합니다.
            이 값으로는 특정 개인을 식별하거나 연락할 수 없습니다.
          </li>
        </ul>
        <p className="mt-1">
          자세한 보유 기간은{" "}
          <Link
            href="/privacy"
            className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            개인정보처리방침
          </Link>
          을 참고하세요.
        </p>
      </Section>

      <Section title="4. 직접 삭제하기 어려운 경우">
        <p>
          로그인이 불가능하거나 앱·웹에서 탈퇴를 진행할 수 없는 경우, 가입에 사용한 소셜
          계정의 이메일 주소로 아래 연락처에 요청하면 본인 확인 후 처리해 드립니다.
          <br />
          이메일:{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </div>
  );
}
