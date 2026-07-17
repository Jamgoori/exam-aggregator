import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침",
};

// 법적 고지 문서라 DB나 상태에 의존하지 않는 정적 페이지로 둔다. 내용을 고칠 때는
// 시행일(부칙)을 갱신하고, 수집 항목이 실제 기능과 어긋나지 않는지 확인할 것 —
// 여기 적힌 항목들은 supabase/schema.sql의 실제 테이블(댓글 ip_address, cbt_attempts,
// explanation_access_log 등)과 1:1로 맞춰 작성됐다.
const CONTACT_EMAIL = "lks2354@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          개인정보처리방침
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-500">
          공모아(이하 &ldquo;서비스&rdquo;)는 개인정보 보호법 등 관련 법령을 준수하며, 이용자의
          개인정보를 아래와 같이 처리합니다.
        </p>
      </div>

      <Section title="1. 수집하는 개인정보 항목과 수집 방법">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">회원가입 시 (소셜 로그인)</p>
        <ul className="list-disc pl-5">
          <li>
            구글 또는 카카오 계정으로만 가입할 수 있으며, 이때 해당 소셜 서비스로부터{" "}
            <strong>이메일 주소</strong>와 <strong>소셜 계정 고유 식별자</strong>를 제공받습니다.
            (카카오 계정에서 이메일 제공에 동의하지 않은 경우 이메일 없이 가입될 수 있습니다.)
          </li>
          <li>
            가입 직후 이용자가 직접 입력하는 <strong>닉네임</strong>을 수집합니다. 닉네임은 댓글
            등에서 다른 이용자에게 공개되는 정보입니다.
          </li>
        </ul>
        <p className="mt-2 font-medium text-zinc-800 dark:text-zinc-200">
          서비스 이용 과정에서 생성·수집
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>학습 기록</strong>: CBT 온라인 응시 기록(응시한 문제지, 문항별 답안, 점수,
            소요 시간), 오답노트·복습 세션 기록, 문항별 학습 상태, 문항 메모, 문제지·과목
            북마크, 난이도 평가
          </li>
          <li>
            <strong>AI 약점 진단</strong>: 진단 요청 일자와 학습 기록을 바탕으로 생성된 진단
            리포트
          </li>
          <li>
            <strong>이용 기록</strong>: 해설 페이지 열람·인쇄(다운로드) 기록, CBT 시작 화면
            설정값
          </li>
        </ul>
        <p className="mt-2 font-medium text-zinc-800 dark:text-zinc-200">비회원 댓글 작성 시</p>
        <ul className="list-disc pl-5">
          <li>
            닉네임, 댓글 내용, 댓글 관리용 비밀번호(복호화할 수 없는 bcrypt 해시로만 저장),{" "}
            <strong>IP 주소</strong>(도배 등 어뷰징 방지 목적)
          </li>
        </ul>
        <p className="mt-2 font-medium text-zinc-800 dark:text-zinc-200">자동으로 수집</p>
        <ul className="list-disc pl-5">
          <li>
            접속 및 서비스 이용 과정에서 쿠키, 기기·브라우저 정보, 방문 기록이 아래 9항의
            분석 도구를 통해 수집될 수 있습니다.
          </li>
        </ul>
      </Section>

      <Section title="2. 개인정보의 처리 목적">
        <ul className="list-disc pl-5">
          <li>회원 식별, 로그인 상태 유지 등 회원 관리</li>
          <li>CBT 응시·오답노트·복습·AI 약점 진단 등 학습 기능 제공</li>
          <li>댓글 등 커뮤니티 기능 제공 및 작성자 확인</li>
          <li>도배·부정 이용 방지 등 서비스 안정성 확보</li>
          <li>서비스 이용 통계 분석과 품질 개선</li>
        </ul>
      </Section>

      <Section title="3. 보유 및 이용 기간">
        <ul className="list-disc pl-5">
          <li>
            회원 정보와 학습 기록: <strong>회원 탈퇴(삭제 요청) 시까지</strong> 보유하며, 탈퇴
            시 계정에 연결된 학습 기록·메모·북마크·진단 리포트가 함께 삭제됩니다. 탈퇴는
            아래 11항의 연락처로 요청할 수 있습니다.
          </li>
          <li>
            회원 댓글: 탈퇴 시 함께 삭제됩니다. 비회원 댓글은 작성자가 비밀번호로 직접
            삭제하거나 운영자가 삭제할 때까지 보유합니다.
          </li>
          <li>비회원 댓글의 IP 주소: 해당 댓글이 보관되는 동안 함께 보관됩니다.</li>
          <li>관련 법령에 따라 보존 의무가 있는 경우 그 기간 동안 보관 후 파기합니다.</li>
        </ul>
      </Section>

      <Section title="4. 개인정보의 제3자 제공">
        <p>
          서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 근거한
          수사기관 등의 적법한 요청이 있는 경우는 예외로 합니다.
        </p>
      </Section>

      <Section title="5. 개인정보 처리의 위탁 및 국외 이전">
        <p>
          서비스 운영을 위해 아래 업체에 개인정보 처리를 위탁하고 있으며, 일부 수탁자는
          해외 법인입니다.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">수탁자</th>
                <th className="py-2 pr-4 font-medium">위탁 업무</th>
                <th className="py-2 font-medium">비고</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-4">Supabase, Inc. (미국)</td>
                <td className="py-2 pr-4">데이터베이스·회원 인증·파일 저장</td>
                <td className="py-2">데이터는 국내(서울) 리전에 저장</td>
              </tr>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-4">Vercel, Inc. (미국)</td>
                <td className="py-2 pr-4">웹 호스팅, 트래픽 통계(Vercel Analytics)</td>
                <td className="py-2">서버는 국내(서울) 리전에서 운영</td>
              </tr>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-4">Anthropic, PBC (미국)</td>
                <td className="py-2 pr-4">AI 해설·약점 진단 리포트 생성</td>
                <td className="py-2">
                  문항 정보와 학습 통계만 처리되며, 이메일 등 식별 정보는 전달하지 않음
                </td>
              </tr>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-4">Google LLC (미국)</td>
                <td className="py-2 pr-4">구글 로그인, 방문 통계(Google Analytics)</td>
                <td className="py-2">통계 도구는 설정된 경우에만 동작</td>
              </tr>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-4">Microsoft Corporation (미국)</td>
                <td className="py-2 pr-4">이용 행태 분석(Microsoft Clarity)</td>
                <td className="py-2">설정된 경우에만 동작</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">주식회사 카카오 (국내)</td>
                <td className="py-2 pr-4">카카오 로그인</td>
                <td className="py-2">&nbsp;</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="6. 개인정보의 파기">
        <p>
          보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적
          파일 형태의 정보는 복구할 수 없는 방법으로 삭제합니다.
        </p>
      </Section>

      <Section title="7. 이용자의 권리와 행사 방법">
        <ul className="list-disc pl-5">
          <li>
            이용자는 언제든지 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수
            있습니다. 닉네임은 마이페이지에서 직접 수정할 수 있고, 그 밖의 요청은 아래
            11항의 연락처로 하면 지체 없이 처리합니다.
          </li>
          <li>회원 탈퇴(계정 삭제)를 요청하면 3항에 따라 관련 기록이 삭제됩니다.</li>
        </ul>
      </Section>

      <Section title="8. 만 14세 미만 아동">
        <p>
          서비스는 만 14세 미만 아동의 회원가입을 받지 않으며, 만 14세 미만 아동의
          개인정보를 수집하지 않습니다.
        </p>
      </Section>

      <Section title="9. 쿠키 등 자동 수집 장치">
        <ul className="list-disc pl-5">
          <li>
            <strong>로그인 세션 쿠키(필수)</strong>: 로그인 상태 유지를 위해 사용되며, 이를
            차단하면 로그인이 필요한 기능을 이용할 수 없습니다.
          </li>
          <li>
            <strong>테마 설정(localStorage)</strong>: 다크 모드 등 화면 설정을 브라우저에만
            저장하며 서버로 전송하지 않습니다.
          </li>
          <li>
            <strong>분석 도구</strong>: Vercel Analytics, Google Analytics, Microsoft Clarity가
            쿠키 또는 유사 기술로 방문·이용 통계를 수집할 수 있습니다. 브라우저 설정에서
            쿠키 저장을 거부할 수 있으며, 이 경우에도 서비스 이용에는 지장이 없습니다.
          </li>
        </ul>
      </Section>

      <Section title="10. 안전성 확보 조치">
        <ul className="list-disc pl-5">
          <li>모든 통신 구간의 HTTPS 암호화</li>
          <li>데이터베이스 행 수준 접근 제어(RLS)로 본인 데이터 외 접근 차단</li>
          <li>비회원 댓글 비밀번호는 복호화할 수 없는 해시(bcrypt)로만 저장</li>
          <li>관리자 권한 키는 서버 환경에서만 사용하고 외부에 노출하지 않음</li>
        </ul>
      </Section>

      <Section title="11. 개인정보 보호책임자 및 문의처">
        <p>
          개인정보 처리에 관한 문의·요청은 아래 연락처로 하면 됩니다.
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

      <Section title="부칙">
        <p>이 개인정보처리방침은 2026년 7월 17일부터 적용됩니다. 내용이 변경되는 경우 시행 7일 전부터 서비스 내 공지로 알립니다.</p>
      </Section>
    </div>
  );
}
