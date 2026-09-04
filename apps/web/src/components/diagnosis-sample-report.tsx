import { BarChart3, Lightbulb, ListChecks, Sparkles, Target, TrendingDown } from "lucide-react";

// AI 약점 진단이 "이렇게 나온다"를 보여주는 예시 화면.
//
// 진단은 응시 3회(또는 오답 15개) 뒤에야 열린다. 그 결과물이 어떻게 생겼는지 아무도
// 못 보면 세 번 올 이유가 없다 — 그래서 소개 페이지(/diagnosis)에 실제 리포트와 같은
// 구조(lib/ai-diagnosis.ts 의 AiDiagnosisReport: 미션 → 취약 개념 → 오답 패턴 → 개념별
// 극복법)로 한 장을 그려 둔다. 대시보드(mypage/diagnosis/diagnosis-board.tsx 의
// CoachingCard)와 같은 문법을 쓴다 — 여기서 본 모양이 실제 화면과 다르면 안 된다.
//
// 내용은 전부 지어낸 예시라 "예시 화면"을 카드마다가 아니라 판 전체에 한 번, 눈에
// 띄게 박는다. 개념 이름은 개념 사전의 실제 축(과목 · keyword_title) 모양을 따른다.
// 데이터를 읽지 않는 순수 마크업이라 정적 셸에 그대로 들어간다.
const WEAK_CONCEPTS: {
  subject: string;
  concept: string;
  accuracyPct: number;
  wrongCount: number;
  frequency: 1 | 2 | 3;
  trend: "down" | "flat" | "up";
}[] = [
  { subject: "행정법총론", concept: "행정행위의 효력", accuracyPct: 38, wrongCount: 5, frequency: 3, trend: "down" },
  { subject: "영어", concept: "어휘·숙어", accuracyPct: 58, wrongCount: 4, frequency: 3, trend: "flat" },
  { subject: "한국사", concept: "조선 후기 실학", accuracyPct: 60, wrongCount: 2, frequency: 2, trend: "up" },
];

const FREQUENCY_LABEL: Record<1 | 2 | 3, string> = { 1: "가끔 출제", 2: "자주 출제", 3: "매년 출제" };

export function DiagnosisSampleReport() {
  return (
    <section
      aria-label="AI 약점 진단 결과 예시"
      className="relative flex flex-col gap-4 rounded-2xl border border-dashed border-violet-300 bg-violet-50/40 p-4 sm:p-5 dark:border-violet-800 dark:bg-violet-950/15"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-violet-900 dark:text-violet-100">이렇게 나와요</p>
        <span className="rounded-full border border-violet-300 bg-white px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-violet-700 dark:border-violet-700 dark:bg-zinc-900 dark:text-violet-300">
          예시 화면 · 실제 데이터 아님
        </span>
      </div>

      {/* 1) 오늘의 1분 미션 — 대시보드 맨 위 히어로 */}
      <div className="rounded-2xl bg-violet-600 p-4 text-white shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-violet-100">
          <Sparkles size={13} /> 오늘의 1분 미션
        </p>
        <p className="mt-1.5 break-keep text-[15px] font-bold leading-snug">
          행정법총론 &lsquo;행정행위의 효력&rsquo;만 잡으면 예상 점수 +5점
        </p>
        <p className="mt-1 text-xs text-violet-100/85">
          최근 7일 오답 11문항 중 5문항이 이 개념이에요. 같은 개념 기출 5문제로 바로 확인해요.
        </p>
      </div>

      {/* 2) 취약 개념 — 문항이 아니라 개념이 축 */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
          <BarChart3 size={14} className="text-violet-600 dark:text-violet-400" /> 취약 개념
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {WEAK_CONCEPTS.map((c) => (
            <li key={c.concept} className="flex items-center gap-3">
              <div className="w-20 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{c.subject}</div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{c.concept}</span>
                  <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                      {FREQUENCY_LABEL[c.frequency]}
                    </span>
                    <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300">
                      {c.wrongCount}회 틀림
                    </span>
                    <span className="tabular-nums">정답률 {c.accuracyPct}%</span>
                    {c.trend === "down" && (
                      <TrendingDown size={12} className="text-red-500" aria-label="하락 추세" />
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${c.accuracyPct < 50 ? "bg-violet-600" : "bg-zinc-400 dark:bg-zinc-600"}`}
                    style={{ width: `${c.accuracyPct}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 3) 오답 패턴 인사이트 */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-zinc-200 bg-white p-4 text-[13px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
        <span className="mt-0.5 shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          오답률 71%
        </span>
        <p className="text-zinc-700 dark:text-zinc-300">
          행정법총론에서 &ldquo;공정력과 구성요건적 효력을 바꿔 놓은&rdquo; 함정 선지를 자주
          골라요. 효력의 이름이 아니라 <b>누구를 구속하는지</b>를 묻는 문제에서 무너져요.
        </p>
      </div>

      {/* 4) 개념별 맞춤 극복법 — 대시보드 CoachingCard 와 같은 문법 */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300">
            5회 틀림
          </span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            정답률 38%
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            기출 24문항
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            잡으면 +5점
          </span>
        </div>
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-zinc-500">행정법총론</p>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">행정행위의 효력</p>
        </div>

        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/10">
          <p className="flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
            <Lightbulb size={13} /> 어디서 무너지고 있나
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            효력 넷(공정력·구성요건적 효력·불가쟁력·불가변력)의 정의는 알고 있는데, 선지가
            &ldquo;다른 국가기관이 그 행위의 존재를 존중해야 한다&rdquo;처럼 <b>효과 쪽</b>으로
            바꿔 물으면 공정력을 고르고 있어요. 틀린 5문항 중 4문항이 같은 자리에서 갈렸어요.
          </p>
          <p className="mt-3 text-xs font-bold text-blue-700/80 dark:text-blue-300/80">왜 그렇게 골랐을까</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            공정력을 &ldquo;일단 유효한 것으로 통용되는 힘&rdquo;으로만 외워서, 상대방(국민)에
            대한 통용력과 다른 기관에 대한 존중 의무를 한 덩어리로 보고 있어요. 두 효력은 대상이
            다르다는 축이 서 있지 않으면 어느 선지든 공정력처럼 읽혀요.
          </p>
        </div>

        <div className="mt-3">
          <p className="px-1 text-xs font-bold text-zinc-600 dark:text-zinc-400">내가 틀린 문항에서</p>
          <ul className="mt-1.5 flex flex-col gap-2">
            <li className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
              <p className="text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-200">
                2025 국가직 9급 12번 · 행정행위의 효력에 관한 설명으로 옳지 않은 것은?
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                내 선택 · ③ 과세처분이 있으면 민사법원은 그 처분의 존재를 전제로 판단해야 한다 (공정력)
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                이건 구성요건적 효력의 전형적 서술이에요. &ldquo;다른 법원·기관이&rdquo;가 주어면
                공정력이 아니라 구성요건적 효력을 떠올려야 해요.
              </p>
            </li>
            <li className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
              <p className="text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-200">
                2024 지방직 9급 7번 · 불가쟁력이 발생한 행정행위에 관한 설명 중 옳은 것은?
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                내 선택 · ② 불가쟁력이 생기면 행정청도 직권취소를 할 수 없다
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                불가쟁력은 <b>상대방</b>이 더 다툴 수 없다는 뜻이지 행정청을 묶지 않아요. 행정청을
                묶는 건 불가변력이고, 그것도 준사법적 행위에서만이에요.
              </p>
            </li>
          </ul>
        </div>

        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5 dark:border-violet-900/40 dark:bg-violet-950/15">
          <p className="flex items-center gap-1.5 text-xs font-bold text-violet-700 dark:text-violet-300">
            <Target size={13} /> 이렇게 극복해요
          </p>
          <p className="mt-1.5 text-sm font-semibold leading-relaxed text-zinc-800 dark:text-zinc-200">
            효력 넷을 &ldquo;누구를 구속하나&rdquo;라는 한 축으로 다시 세우세요: 상대방(공정력·
            불가쟁력) vs 다른 기관(구성요건적 효력) vs 행정청 자신(불가변력).
          </p>
          <ol className="mt-2.5 flex flex-col gap-2">
            {[
              { title: "표 한 장 만들기", detail: "효력 넷 × (대상 · 발생 시점 · 예외) 3열 표를 손으로 한 번 써요.", minutes: 10 },
              { title: "틀린 5문항 다시 풀기", detail: "선지마다 주어(누가)를 먼저 표시하고 나서 고르세요.", minutes: 15 },
              { title: "같은 개념 기출 5문제", detail: "아래 버튼으로 바로 이어져요. 4문제 이상 맞히면 극복으로 기록돼요.", minutes: 10 },
            ].map((s, i) => (
              <li key={s.title} className="flex gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    <b className="text-[13px] font-bold text-zinc-800 dark:text-zinc-200">{s.title}</b>
                    <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">약 {s.minutes}분</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
          <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
            <ListChecks size={13} /> 시험장 체크리스트
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-zinc-700 dark:text-zinc-300">
            <li>1. 선지의 주어가 국민인가, 다른 기관인가, 행정청인가</li>
            <li>2. &ldquo;존중·전제&rdquo;가 나오면 구성요건적 효력부터 의심</li>
            <li>3. 불가쟁력은 기간 도과, 불가변력은 행위 성질 — 발생 원인이 다르다</li>
          </ul>
          <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-500">
            함정 한 줄 · &ldquo;공정력이 있으므로 법원은 ~해야 한다&rdquo;는 선지는 대개 효력 이름을
            바꿔 놓은 것.
          </p>
        </div>

        <div className="mt-3 flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white">
          같은 개념 기출 5문제 풀기
        </div>
      </div>
    </section>
  );
}
