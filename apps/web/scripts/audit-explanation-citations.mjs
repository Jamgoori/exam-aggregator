// 사용법: node --env-file=.env.local scripts/audit-explanation-citations.mjs [옵션]
//
// 해설 본문에 인용된 판례 사건번호(헌재 2019헌마941 · 대법원 2018두12345 …)가 실제로
// 있는 사건인지, 그리고 그 사건이 해설이 말하는 그 사건이 맞는지 밖에서 확인한다.
// 읽기만 한다 — 해설은 고치지 않는다 (고칠 목록만 뽑아 준다).
//
// 왜 필요한가 (2026-08-21 실측):
//   2025 지방직 7급 헌법 20문항을 사람이 전수 검수했더니, 정답 번호·선지 판정·법리는
//   20/20 맞는데 인용 사건번호 17건 중 1건이 다른 사건이었다. 13번 ④ 해설이 든
//   "2015헌바123"은 2016. 4. 28. 선고된 별개 사건(석유사업법 제39조 제1항 제8호,
//   이동판매 차량 적재용량)이고, 실제 근거는 헌재 2015. 3. 26. 2013헌마461이다.
//   해설 본문은 상위 모델이 쓰지만 사건번호를 대조하는 단계는 파이프라인에 없다.
//   그래서 "본문은 맞는데 번호만 틀린" 오기는 저장까지 아무 데도 안 걸린다
//   (save-explanations.mjs 의 verify_question_answer 는 정답 번호만 본다).
//   수험생 입장에서 이건 조용한 배신이다 — 원문을 찾아가면 다른 사건이 나온다.
//
// 무엇을 잡고 무엇을 못 잡나:
//   잡는다  — 없는 사건번호, 해설에 적힌 선고일과 실제 선고일 불일치,
//             그 사건 결정문에 해설이 쓴 핵심어가 거의 안 나오는 "다른 사건 인용".
//   못 잡는다 — 사건번호도 주제도 맞는데 법리를 잘못 요약한 경우. 그건 사람이 읽어야
//             한다. 이 스크립트는 "기계로 확실히 잡히는 것"만 본다.
//
// 조회처가 막을 수 있다는 걸 전제로 짜여 있다. 실제로 하루에 수백 건을 조회하자
// 403 이 나오기 시작했다(2026-08-22). 그래서 (1) 기본 속도가 느리고(동시 1, 1.2초
// 간격) (2) 연속 차단이면 그 실행은 조회를 접고 (3) 확인분은 캐시에 남겨 다음 실행이
// 이어받는다. **한 번에 전량을 훑지 말고 `--since`·`--limit` 으로 나눠 돌릴 것.**
//
// 조회처는 casenote.kr 한 곳이다(로그인·키 불필요). 사건번호로 바로 주소가 서고,
// 병합 사건의 구성원 번호(2019헌바404 같은)는 개별 주소가 404 라서 검색으로 한 번 더
// 확인한다 — 이 두 단계를 안 밟으면 병합 사건이 통째로 "없는 사건번호"로 잘못 잡힌다
// (2026-08-22 실측: 2014헌마788·2019헌바404 모두 개별 주소 404, 검색은 대표 사건으로
// 리다이렉트). 조회처를 바꿀 일이 생기면 lookupCase() 하나만 갈아끼우면 된다.
//
// 자격 증명은 해설봇 계정을 먼저 쓴다 — 배치 루틴 환경에는 service role 키가 없고
// 봇 계정뿐이라, 루틴으로 돌릴 스크립트는 그 환경에서 되는 방식이어야 한다
// (docs/agents/explanation-batch-routines.md). 소유자 로컬처럼 service role 키만
// 있으면 그걸로 붙는다.
//
// 옵션:
//   --since YYYY-MM-DD  그 날짜 이후 생성된 해설만 (루틴 기본 모드 — 새로 만들어진 것만)
//   --paper <uuid>      특정 시험지만
//   --subject <이름>    특정 과목만 (예: 헌법)
//   --sample N          대상 해설 중 무작위 N행만 (오래된 해설 표본 점검용)
//   --limit N           검증할 고유 사건번호 상한 (기본 300, 0이면 무제한)
//   --concurrency N     동시 조회 수 (기본 1 — 올리면 조회처가 403 으로 막는다)
//   --out <경로>        JSON 리포트 저장 경로
//   --cache <경로>      사건 조회 캐시 파일 (기본 backups/citation-cache.json)
//   --no-cache          캐시를 읽지도 쓰지도 않는다
//   --offline           네트워크 조회 없이 추출·통계만 (인용이 몇 건인지 볼 때)
//
// 종료 코드: 조회를 마쳤으면 0 (발견 건수는 리포트로 본다). 환경변수·로그인·DB 실패
// 같은 운영 실패만 1 — 루틴이 "발견 있음"을 실패로 오해하지 않게 한 구분이다.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// 사건번호 추출
// ─────────────────────────────────────────────────────────────────────────────

// 헌재 사건부호: 헌가(위헌법률심판) 헌나(탄핵) 헌다(정당해산) 헌라(권한쟁의)
// 헌마(헌법소원 68①) 헌바(헌법소원 68②) 헌사(각종 신청) 헌아(재심).
// 연도는 4자리(2019헌마941) 또는 2자리(99헌마139) 둘 다 쓴다.
const HEONJAE_RE = /(?<![0-9])((?:19|20)\d{2}|\d{2})헌([가나다라마바사아])(\d{1,5})(?![0-9])/g;

// 대법원 사건부호 중 해설에 실제로 나오는 것들만. 넓게 잡으면 "2년 내 3회" 같은
// 평범한 숫자+한글이 사건번호로 오인된다 — 앞에 '대법원'이나 '선고'가 있거나,
// 연도가 4자리일 때만 인정한다.
const DAEBEOP_RE =
  /(?<![0-9])((?:19|20)\d{2})(다|두|도|므|후|우|허|초|카|그|모|오|스|재다|재두|재도)(\d{2,6})(?![0-9])/g;

// 해설 문장에 함께 적힌 선고일. "헌재 2015. 3. 26. 2013헌마461" 처럼 사건번호 앞에
// 붙는 게 이 레포 해설의 관행이라, 사건번호 기준 앞 40자만 본다.
const DATE_BEFORE_RE = /((?:19|20)\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*$/;

// 주제 대조에서 빼는 말. 어느 해설에나 나오는 껍데기라, 이게 맞는다고 같은 사건이라는
// 근거가 못 된다.
const STOPWORDS = new Set([
  "헌법재판소", "헌재", "대법원", "판례", "결정", "선고", "판시", "판단", "조항", "규정", "법률",
  "사건", "심판", "청구", "청구인", "경우", "내용", "설명", "선지", "부분", "이상", "이하", "관련",
  "따라서", "그러나", "때문", "여부", "인정", "위반", "위배", "침해", "해당", "제한", "보아",
  "옳은", "틀린", "맞는", "이다", "있다", "없다", "한다", "본다", "봅니다", "합니다", "입니다",
  "것으로", "것이", "것은", "라는", "하는", "되는", "않는", "한다는", "된다는", "이라는",
  // 결론·메타 서술어. 해설은 "합헌으로 보았으나"라고 쓰는데 결정문 주문은 "기각"이라,
  // 이런 말을 특징어로 쓰면 멀쩡한 인용이 "본문에 없는 말"로 잡힌다(2026-08-22 실측).
  "합헌", "위헌", "기각", "각하", "종전", "현행", "결론", "서술", "문항", "조문", "법리",
  "취지", "입장", "견해", "판례상", "헌법불합치", "과잉금지원칙", "선언",
  // 해설이 수험생에게 말을 걸 때 쓰는 낱말. 결정문에는 당연히 없으므로 특징어로
  // 쓰면 멀쩡한 인용이 통째로 의심에 걸린다 (2026-08-22 전수 실행에서 다수 확인).
  "출제", "당시", "당시에", "선례", "판례변경", "다수의견", "반대의견", "별개의견",
  "지문", "고르면", "정답", "오답", "조합", "문제지", "기준으로", "유일한",
]);

// 한국어 조사만 떼는 최소한의 정규화. 형태소 분석기를 붙이면 정확해지지만, 루틴
// 환경은 plain node 라 의존성 없이 도는 게 우선이다 — 여기서 조금 놓치는 건
// 임계값(TOPIC_MIN_HIT)이 흡수한다.
const JOSA = ["으로써", "에서는", "에게서", "이라는", "으로", "에서", "에게", "부터", "까지", "라는", "이란", "과의", "와의", "의", "은", "는", "이", "가", "을", "를", "에", "도", "만", "과", "와", "로"];

function stripJosa(token) {
  for (const j of JOSA) {
    if (token.length > j.length + 1 && token.endsWith(j)) return token.slice(0, -j.length);
  }
  return token;
}

// 인용이 들어 있는 문장. 한 선지 해설이 여러 사건을 들 수 있어서, 문장 단위로 잘라
// 그 사건번호가 든 문장만 주제 대조에 쓴다.
function sentenceAround(text, index) {
  let start = 0;
  for (const marker of ["다. ", "요. ", "다.\n"]) {
    const at = text.lastIndexOf(marker, index);
    if (at !== -1) start = Math.max(start, at + marker.length);
  }
  let end = index;
  for (const marker of ["다.", "요.", ". "]) {
    const at = text.indexOf(marker, index);
    if (at !== -1) end = end === index ? at + marker.length : Math.min(end, at + marker.length);
  }
  if (end <= index) end = Math.min(text.length, index + 160);
  return text.slice(start, end).trim();
}

// 주제 대조에 쓸 범위를 그 인용 하나 몫으로 좁힌다.
//
// 한 문장이 사건 여러 개를 드는 일이 흔하다 — "ㄱ(부부 자산소득 합산과세 위헌,
// 2001헌바82)과 ㄴ(친생부인의 소 제척기간 합헌)은 옳지만…" 처럼. 문장 전체를 그대로
// 대조하면 옆 지문의 낱말('친생부인'·'제척기간')이 특징어로 뽑혀, 번호가 맞는 인용이
// 통째로 의심에 걸린다 (2026-08-22 전수 실행에서 약(弱) 의심의 대부분이 이 모양이었다).
// 두 가지로 좁힌다:
//   1) 괄호 안에 있는 인용이면 그 괄호 안 + 바로 앞 몇 글자만 본다
//   2) 아니면 앞뒤의 다른 사건번호 사이 구간만 본다
function narrowToCitation(sentence, caseNo) {
  const at = sentence.indexOf(caseNo);
  if (at === -1) return sentence;

  // 1) 이 인용을 감싸는 괄호 찾기
  const open = sentence.lastIndexOf("(", at);
  if (open !== -1) {
    const close = sentence.indexOf(")", at);
    if (close !== -1 && !sentence.slice(open, at).includes(")")) {
      const lead = sentence.slice(Math.max(0, open - 40), open);
      return `${lead} ${sentence.slice(open + 1, close)}`;
    }
  }

  // 2) 앞뒤의 다른 사건번호로 자르기
  const others = [];
  for (const re of [HEONJAE_RE, DAEBEOP_RE]) {
    for (const m of sentence.matchAll(re)) if (m[0] !== caseNo) others.push([m.index, m[0].length]);
  }
  if (others.length === 0) return sentence;
  const before = others.filter(([i]) => i < at).map(([i, len]) => i + len);
  const after = others.filter(([i]) => i > at).map(([i]) => i);
  const start = before.length ? Math.max(...before) : 0;
  const end = after.length ? Math.min(...after) : sentence.length;
  return sentence.slice(start, end);
}

function extractCitations(text) {
  const out = [];
  const push = (match, court) => {
    const caseNo = match[0];
    const head = text.slice(Math.max(0, match.index - 40), match.index);
    const dateHit = DATE_BEFORE_RE.exec(head.trimEnd());
    const sentence = sentenceAround(text, match.index);
    out.push({
      caseNo,
      court,
      statedDate: dateHit ? `${dateHit[1]}-${String(dateHit[2]).padStart(2, "0")}-${String(dateHit[3]).padStart(2, "0")}` : null,
      sentence,
      // 사람이 읽을 건 sentence, 기계가 대조할 건 context 다.
      context: narrowToCitation(sentence, caseNo),
    });
  };
  for (const m of text.matchAll(HEONJAE_RE)) push(m, "헌법재판소");
  for (const m of text.matchAll(DAEBEOP_RE)) {
    // 대법원 번호는 오인이 쉬워, 문맥에 '대법원'이나 '선고'가 있을 때만 센다.
    const head = text.slice(Math.max(0, m.index - 30), m.index);
    if (!/대법원|선고/.test(head)) continue;
    push(m, "대법원");
  }
  return out;
}

// 해설 한 행에서 인용을 모은다. 어느 필드에서 나왔는지도 같이 남긴다 — 고칠 때
// 사람이 바로 그 자리를 찾아가야 하기 때문이다.
function citationsOfRow(row) {
  const fields = [
    ["keyword_explanation", row.keyword_explanation],
    ["correct_choice_summary", row.correct_choice_summary],
    ["current_answer_note", row.current_answer_note],
  ];
  if (Array.isArray(row.choice_explanations)) {
    for (const c of row.choice_explanations) {
      if (!c || typeof c !== "object") continue;
      const n = c.number ?? c.choice ?? "?";
      if (typeof c.explanation === "string") fields.push([`choice_explanations[${n}].explanation`, c.explanation]);
      if (typeof c.original_note === "string") fields.push([`choice_explanations[${n}].original_note`, c.original_note]);
    }
  }
  const out = [];
  for (const [field, text] of fields) {
    if (typeof text !== "string" || !text) continue;
    for (const cite of extractCitations(text)) out.push({ ...cite, field });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 사건 조회 (casenote.kr)
// ─────────────────────────────────────────────────────────────────────────────

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
// 특징어 적중률이 이보다 낮으면 "다른 사건 인용" 의심. 실측 분포로 정했다 —
// 번호가 맞는 인용은 0.8~1.0 에 몰리고, 오기(2015헌바123)는 0.33 이었다. 여기서
// 나오는 건 "확정"이 아니라 "사람이 볼 것" 표시라, 조금 넉넉하게 잡는 편이 낫다.
const TOPIC_MIN_HIT = 0.55;

function toPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 요청 하나가 응답 없이 매달리면 무인 루틴은 거기서 영원히 선다 (2026-08-22 실측:
// 250건 중 236번째에서 멈춰 몇 분 동안 진행이 없었다). fetch 는 기본 타임아웃이
// 없으므로 반드시 직접 끊는다 — 이 줄이 빠지면 루틴이 "돌고는 있는데 아무것도
// 안 하는" 상태로 남는다.
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchText(url, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { "user-agent": UA, "accept-language": "ko" },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt >= retries) return { status: 0, text: "", url, error: String(e?.message ?? e) };
      await sleep(600 * 2 ** attempt);
      continue;
    }
    // casenote 는 부하가 걸리면 503 을 낸다. 이걸 "없는 사건"으로 세면 멀쩡한 인용이
    // 무더기로 오탐 나므로, 물러섰다 다시 묻고 그래도 안 되면 미확인으로 남긴다.
    if (res.status === 503 && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const text = res.status === 200 ? toPlainText(await res.text()) : "";
    return { status: res.status, text, url: res.url };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 사건번호 하나를 조회한다. 반환: { found, decidedOn, caseNos, title, body, via }
async function lookupCase(caseNo, court) {
  const path = court === "대법원" ? "대법원" : "헌법재판소";
  const direct = await fetchText(`https://casenote.kr/${encodeURIComponent(path)}/${encodeURIComponent(caseNo)}`);
  if (direct.status === 200 && direct.text.includes(caseNo)) return { ...parseCasePage(direct.text, caseNo), via: "direct" };
  if (direct.status !== 200 && direct.status !== 404) {
    return { found: null, reason: `조회 실패 HTTP ${direct.status}${direct.error ? ` (${direct.error})` : ""}`, via: "direct" };
  }
  // 개별 주소가 없다고 없는 사건이 아니다 — 병합 사건의 구성원 번호는 대표 사건
  // 주소로만 서기 때문에, 검색이 대표 사건으로 데려다주는지 한 번 더 본다.
  const searched = await fetchText(`https://casenote.kr/search/?q=${encodeURIComponent(caseNo)}`);
  if (searched.status === 200 && searched.text.includes(caseNo)) {
    return { ...parseCasePage(searched.text, caseNo), via: "search" };
  }
  if (searched.status !== 200 && searched.status !== 404) {
    return { found: null, reason: `조회 실패 HTTP ${searched.status}`, via: "search" };
  }
  return { found: false, via: "search" };
}

// 결정문 본문을 캐시에 통째로 담으면 파일이 수십 MB 로 불어난다. 주제 대조는 "이 말이
// 결정문에 나오나"만 보므로, 중복을 없앤 낱말만 남겨도 판정이 같다. 이걸 캐시해 두면
// 재실행(과 임계값 튜닝)이 조회처를 다시 두드리지 않는다 — 조회처가 403 으로 막기
// 시작하면 그때부터는 캐시가 유일한 자료다.
function bodyDigest(text) {
  const seen = new Set();
  for (const t of text.split(/[^가-힣A-Za-z]+/)) if (t.length >= 2) seen.add(t);
  return [...seen].join(" ");
}

function parseCasePage(text, caseNo) {
  const head = text.slice(0, 2000);
  const dateHit = /((?:19|20)\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?:선고|자)/.exec(head);
  const titleHit = /\[([^\]]{2,120})\]/.exec(head);
  const nosHit = new RegExp(`${caseNo}[0-9가-힣·,()\\s]{0,60}`).exec(head);
  return {
    found: true,
    decidedOn: dateHit ? `${dateHit[1]}-${String(dateHit[2]).padStart(2, "0")}-${String(dateHit[3]).padStart(2, "0")}` : null,
    title: titleHit ? titleHit[1] : null,
    caseNos: nosHit ? nosHit[0].trim() : caseNo,
    body: text,
    digest: bodyDigest(text),
  };
}

// 문장을 대조용 낱말로 쪼갠다. 조사만 떼고 어미로 끝나는 말은 버린다 —
// '침해하지'·'판단했습니다' 같은 말은 어느 결정문에나 있어서, 맞아도 같은 사건이라는
// 근거가 못 된다(이걸 안 거르면 오기가 적중률 50%로 통과한다 — 2026-08-22 실측).
const ADVERB_TAIL = /(히|하게|같이|없이|대로|만큼|스럽게|롭게)$/;
const VERB_TAIL =
  /(습니다|합니다|입니다|했다|한다|하지|하고|하며|하여|되어|되는|않는|않는다고|한다고|된다고|이다|있는|없는|으나|았으나|었으나|지만|면서|으며|였다|었다|보았|하였|되었|이며|이고)$/;

function contentTokens(sentence) {
  return [
    ...new Set(
      sentence
        .replace(HEONJAE_RE, " ")
        .replace(DAEBEOP_RE, " ")
        .split(/[^가-힣A-Za-z]+/)
        .map((t) => stripJosa(t))
        .filter(
          (t) => t.length >= 2 && t.length <= 12 && !STOPWORDS.has(t) && !VERB_TAIL.test(t) && !ADVERB_TAIL.test(t),
        ),
    ),
  ];
}

// 해설 문장의 특징어가 그 결정문 본문에 실제로 나오는지 본다. 사건번호가 맞으면
// 대개 다 나오고, 다른 사건을 인용하면 '대물적'·'임대인'처럼 그 사건에 없는 말이
// 통째로 빠진다 — 2015헌바123 오기가 이 신호로 잡혔다.
//
// 어떤 낱말이 "특징어"인지는 이번 실행에서 스캔한 해설 전체를 배경으로 삼아 정한다
// (df = 그 낱말이 나온 해설 행 수). 어느 해설에나 나오는 말은 df 가 높아 저절로
// 빠지고, 그 문항에만 있는 말이 남는다. 배경 없이 "긴 낱말"로 고르면 어미가 붙은
// 긴 서술어가 뽑혀 신호가 죽는다.
function topicMatch(sentence, body, df = null, corpusSize = 0) {
  const tokens = contentTokens(sentence);
  let probes;
  if (df && corpusSize >= 20) {
    const rareCut = Math.max(2, Math.ceil(corpusSize * 0.15));
    probes = tokens
      .filter((t) => (df.get(t) ?? 1) <= rareCut)
      .sort((a, b) => (df.get(a) ?? 1) - (df.get(b) ?? 1) || b.length - a.length)
      .slice(0, 6);
  } else {
    probes = tokens.sort((a, b) => b.length - a.length).slice(0, 6);
  }
  // 특징어가 네 개도 안 남으면 판정하지 않는다. 짧은 문장("종전에는 합헌으로 보았으나")은
  // 특징어가 원래 없어서, 억지로 재면 멀쩡한 인용이 의심으로 잡힌다.
  if (probes.length < 4) return { ratio: null, probes, missing: [] };
  const missing = probes.filter((t) => !body.includes(t) && !body.includes(t.slice(0, Math.max(2, t.length - 1))));
  return { ratio: (probes.length - missing.length) / probes.length, probes, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      console.error(`값만 있는 인자는 받지 않습니다: ${token}`);
      process.exit(1);
    }
    // --limit=300 처럼 붙여 쓰면 조용히 다른 값으로 읽히는 사고가 난다. 즉시 막는다
    // (next-explanation-chunk.mjs 와 같은 규칙 — 무인 루틴에서 방향·범위가 뒤바뀌는 걸
    // 막는 장치라 완화하지 말 것).
    if (token.includes("=")) {
      console.error(`플래그는 --이름 값 형식만 받습니다 (=문법 금지): ${token}`);
      process.exit(1);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function connect() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && publishableKey && botEmail && botPassword) {
    const supabase = createClient(url, publishableKey);
    const { error } = await supabase.auth.signInWithPassword({ email: botEmail, password: botPassword });
    if (!error) return supabase;
    console.error(`봇 계정 로그인 실패(${error.message}) — service role 키가 있으면 그걸로 시도합니다.`);
  }
  if (url && serviceRoleKey) return createClient(url, serviceRoleKey);
  console.error(
    "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL 과 (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY + EXPLANATION_BOT_EMAIL + EXPLANATION_BOT_PASSWORD) 또는 SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

// question_explanations 는 이미 1만 행이 넘는다. offset 페이징은 뒤로 갈수록 느려져
// 이 레포의 상시 위험인 statement timeout 에 걸리므로, id 키셋으로 넘긴다.
async function pageExplanations(supabase, { since, questionIds }) {
  const COLS =
    "id, question_id, created_at, keyword_explanation, correct_choice_summary, current_answer_note, choice_explanations";
  const rows = [];
  if (questionIds) {
    for (let i = 0; i < questionIds.length; i += 200) {
      const chunk = questionIds.slice(i, i + 200);
      const { data, error } = await supabase.from("question_explanations").select(COLS).in("question_id", chunk);
      if (error) throw new Error(`해설 조회 실패: ${error.message}`);
      rows.push(...data);
      process.stderr.write(`\r해설 ${rows.length}행 수집`);
    }
    process.stderr.write("\n");
    return since ? rows.filter((r) => r.created_at >= since) : rows;
  }
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    let q = supabase.from("question_explanations").select(COLS).gt("id", last).order("id").limit(400);
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q;
    if (error) throw new Error(`해설 조회 실패: ${error.message}`);
    if (!data.length) break;
    rows.push(...data);
    last = data[data.length - 1].id;
    process.stderr.write(`\r해설 ${rows.length}행 수집`);
  }
  process.stderr.write("\n");
  return rows;
}

// 문제지 → 문항 id. 과목·시험지 필터가 있을 때만 쓴다.
async function questionIdsFor(supabase, { paperId, subject }) {
  let paperIds = null;
  if (paperId) paperIds = [paperId];
  else if (subject) {
    const { data: subjects, error: sErr } = await supabase.from("subjects").select("id, name");
    if (sErr) throw new Error(`과목 조회 실패: ${sErr.message}`);
    const ids = subjects.filter((s) => s.name === subject).map((s) => s.id);
    if (ids.length === 0) throw new Error(`과목을 찾을 수 없습니다: ${subject}`);
    const { data: papers, error: pErr } = await supabase.from("exam_papers").select("id").in("subject_id", ids);
    if (pErr) throw new Error(`문제지 조회 실패: ${pErr.message}`);
    paperIds = papers.map((p) => p.id);
  }
  if (!paperIds) return null;
  const out = [];
  for (let i = 0; i < paperIds.length; i += 50) {
    const { data, error } = await supabase
      .from("questions")
      .select("id")
      .in("paper_id", paperIds.slice(i, i + 50));
    if (error) throw new Error(`문항 조회 실패: ${error.message}`);
    out.push(...data.map((q) => q.id));
  }
  return out;
}

// 발견된 것만 시험지·문항번호를 붙인다 (전량 조인은 timeout 을 부른다).
async function labelQuestions(supabase, questionIds) {
  const byQuestion = new Map();
  for (let i = 0; i < questionIds.length; i += 200) {
    const chunk = questionIds.slice(i, i + 200);
    const { data, error } = await supabase.from("questions").select("id, question_number, paper_id").in("id", chunk);
    if (error) throw new Error(`문항 조회 실패: ${error.message}`);
    for (const q of data) byQuestion.set(q.id, q);
  }
  const paperIds = [...new Set([...byQuestion.values()].map((q) => q.paper_id))];
  const paperTitle = new Map();
  for (let i = 0; i < paperIds.length; i += 100) {
    const { data, error } = await supabase.from("exam_papers").select("id, title").in("id", paperIds.slice(i, i + 100));
    if (error) throw new Error(`문제지 조회 실패: ${error.message}`);
    for (const p of data) paperTitle.set(p.id, p.title);
  }
  return { byQuestion, paperTitle };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set(["since", "paper", "subject", "sample", "limit", "concurrency", "out", "cache", "no-cache", "offline"]);
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      console.error(`알 수 없는 플래그: --${key} (지원: ${[...known].map((k) => `--${k}`).join(", ")})`);
      process.exit(1);
    }
  }
  const since = typeof args.since === "string" ? args.since : null;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error("--since 는 YYYY-MM-DD 형식이어야 합니다.");
    process.exit(1);
  }
  const limit = args.limit === undefined ? 300 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 0) {
    console.error("--limit 은 0 이상의 정수여야 합니다 (0 = 무제한).");
    process.exit(1);
  }
  const sample = args.sample === undefined ? 0 : Number(args.sample);
  if (!Number.isInteger(sample) || sample < 0) {
    console.error("--sample 은 0 이상의 정수여야 합니다.");
    process.exit(1);
  }
  const concurrency = args.concurrency === undefined ? 1 : Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    console.error("--concurrency 는 1~6 사이의 정수여야 합니다 (조회처에 부담을 주지 않기 위한 상한).");
    process.exit(1);
  }
  const offline = args.offline === true;
  const useCache = args["no-cache"] !== true;
  const cachePath = typeof args.cache === "string" ? args.cache : "backups/citation-cache.json";
  const outPath = typeof args.out === "string" ? args.out : null;

  const supabase = await connect();

  let questionIds = null;
  try {
    questionIds = await questionIdsFor(supabase, {
      paperId: typeof args.paper === "string" ? args.paper : null,
      subject: typeof args.subject === "string" ? args.subject : null,
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  let rows;
  try {
    rows = await pageExplanations(supabase, { since, questionIds });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (sample > 0 && rows.length > sample) {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    rows = rows.slice(0, sample);
  }

  const occurrences = [];
  for (const row of rows) {
    for (const cite of citationsOfRow(row)) {
      occurrences.push({ ...cite, questionId: row.question_id, explanationId: row.id, createdAt: row.created_at });
    }
  }
  // 특징어 판정용 배경 통계: 낱말이 몇 개의 해설에 나오는가.
  const df = new Map();
  for (const row of rows) {
    const text = [
      row.keyword_explanation,
      row.correct_choice_summary,
      row.current_answer_note,
      ...(Array.isArray(row.choice_explanations)
        ? row.choice_explanations.flatMap((c) => [c?.explanation, c?.original_note])
        : []),
    ]
      .filter((v) => typeof v === "string")
      .join(" ");
    for (const t of contentTokens(text)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const unique = new Map();
  for (const o of occurrences) {
    const key = `${o.court}|${o.caseNo}`;
    if (!unique.has(key)) unique.set(key, { court: o.court, caseNo: o.caseNo, count: 0 });
    unique.get(key).count += 1;
  }
  console.log(
    `해설 ${rows.length}행 · 인용 ${occurrences.length}건 · 고유 사건번호 ${unique.size}개` +
      ` (해설 1행당 평균 ${(occurrences.length / Math.max(1, rows.length)).toFixed(2)}건)`,
  );
  if (offline) {
    console.log("--offline: 조회 없이 종료합니다.");
    if (outPath) writeReport(outPath, { mode: "offline", rows: rows.length, occurrences, unique: [...unique.values()] });
    return;
  }

  // 캐시는 같은 사건번호를 여러 해설이 인용할 때(흔하다) 조회를 아낀다. 본문까지
  // 담으면 파일이 수십 MB 로 불어나므로 판정에 필요한 것만 남긴다.
  let cache = {};
  if (useCache) {
    try {
      cache = JSON.parse(readFileSync(cachePath, "utf8"));
    } catch {
      cache = {};
    }
  }

  const targets = [...unique.values()].sort((a, b) => b.count - a.count);
  const scanList = limit === 0 ? targets : targets.slice(0, limit);
  if (scanList.length < targets.length) {
    console.log(`인용 많은 순으로 ${scanList.length}개만 조회합니다 (--limit ${limit}, 남은 ${targets.length - scanList.length}개는 다음 실행 몫).`);
  }

  const looked = new Map();
  let done = 0;
  // 조회처가 막기 시작하면(403) 남은 것까지 전부 "조회불가"로 채워져 리포트가
  // 쓸모없어진다 (2026-08-22 실측: 250건 중 204건이 그렇게 오염됐다). 연속으로
  // 막히면 그 실행은 조회를 접고, 그때까지 확인한 것만 보고한다 — 성공분은 캐시에
  // 남아 다음 실행이 이어받는다.
  let consecutiveBlocked = 0;
  let blocked = false;
  const BLOCK_GIVEUP = 3;
  const queue = [...scanList];
  async function worker() {
    for (;;) {
      if (blocked) return;
      const item = queue.shift();
      if (!item) return;
      const key = `${item.court}|${item.caseNo}`;
      const cached = cache[key];
      // digest 가 없는 캐시(요약을 담기 전 버전)는 주제 대조를 못 하므로 캐시 적중으로
      // 치지 않는다 — 그렇게 치면 "조회는 됐는데 아무것도 안 본" 리포트가 나온다.
      const usable = cached && (cached.found === false || typeof cached.digest === "string");
      if (usable) {
        looked.set(key, { ...cached, body: cached.digest ?? null, fromCache: true });
      } else {
        const res = await lookupCase(item.caseNo, item.court);
        if (res.found === null && /HTTP 403|HTTP 429/.test(res.reason ?? "")) {
          consecutiveBlocked += 1;
          if (consecutiveBlocked >= BLOCK_GIVEUP) {
            blocked = true;
            return;
          }
        } else {
          consecutiveBlocked = 0;
        }
        looked.set(key, res);
        if (useCache && res.found !== null) {
          cache[key] = {
            found: res.found,
            decidedOn: res.decidedOn ?? null,
            title: res.title ?? null,
            caseNos: res.caseNos ?? null,
            digest: res.digest ?? null,
            checkedAt: new Date().toISOString(),
          };
        }
        await sleep(1200);
      }
      done += 1;
      process.stderr.write(`\r조회 ${done}/${scanList.length}`);
      // 캐시를 마지막에 한 번만 쓰면, 중간에 끊긴 실행은 조회한 걸 통째로 잃는다.
      // 루틴은 컷오프·한도로 자주 끊기므로 진행 중에도 흘려 둔다.
      if (useCache && done % 25 === 0) saveCache(cachePath, cache);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  process.stderr.write("\n");
  if (blocked) {
    console.log(
      `조회처가 연속 ${BLOCK_GIVEUP}회 차단(403/429)해 ${done}/${scanList.length}개까지만 확인했습니다.` +
        " 확인분은 캐시에 남았으니 잠시 뒤 다시 실행하면 이어집니다.",
    );
  }

  // 판정. 본문 대조(주제 확인)는 이번 실행에서 실제로 받아온 사건만 가능하다 —
  // 캐시에는 본문을 안 담기 때문에, 캐시 적중 건은 존재·선고일까지만 본다.
  const findings = [];
  for (const o of occurrences) {
    const key = `${o.court}|${o.caseNo}`;
    const info = looked.get(key);
    if (!info) continue; // --limit 밖
    if (info.found === null) {
      findings.push({ ...o, verdict: "조회불가", detail: info.reason ?? "조회 실패" });
      continue;
    }
    if (info.found === false) {
      findings.push({ ...o, verdict: "없는 사건번호", detail: "개별 주소·검색 모두에서 찾지 못했습니다." });
      continue;
    }
    if (o.statedDate && info.decidedOn && o.statedDate !== info.decidedOn) {
      findings.push({
        ...o,
        verdict: "선고일 불일치",
        detail: `해설 ${o.statedDate} vs 실제 ${info.decidedOn} (${info.caseNos ?? o.caseNo}${info.title ? ` — ${info.title}` : ""})`,
      });
      continue;
    }
    if (info.body) {
      const topic = topicMatch(o.context ?? o.sentence, info.body, df, rows.length);
      if (topic.ratio !== null && topic.ratio < TOPIC_MIN_HIT) {
        // 적중률이 바닥이면 대개 진짜 다른 사건이고, 임계값 언저리면 해설이 결정문
        // 표현을 안 쓰고 풀어 쓴 경우가 섞인다. 사람이 위에서부터 보게 나눠 둔다.
        findings.push({
          ...o,
          verdict: topic.ratio <= 0.25 ? "주제 불일치 의심(강)" : "주제 불일치 의심(약)",
          detail: `결정문에 없는 말: ${topic.missing.join(", ")} (적중 ${(topic.ratio * 100).toFixed(0)}%) — 실제 사건: ${info.caseNos ?? o.caseNo}${info.title ? ` [${info.title}]` : ""}`,
        });
      }
    }
  }

  if (useCache) saveCache(cachePath, cache);

  const bySeverity = {
    "없는 사건번호": [],
    "선고일 불일치": [],
    "주제 불일치 의심(강)": [],
    "주제 불일치 의심(약)": [],
    조회불가: [],
  };
  for (const f of findings) bySeverity[f.verdict].push(f);

  let labels = { byQuestion: new Map(), paperTitle: new Map() };
  if (findings.length > 0) {
    try {
      labels = await labelQuestions(supabase, [...new Set(findings.map((f) => f.questionId))]);
    } catch (e) {
      console.error(`문항 라벨 조회 실패(리포트에 시험지명이 빠집니다): ${e.message}`);
    }
  }
  const label = (f) => {
    const q = labels.byQuestion.get(f.questionId);
    const title = q ? labels.paperTitle.get(q.paper_id) : null;
    return `${title ?? "(시험지 미상)"} ${q ? `${q.question_number}번` : ""}`.trim();
  };

  console.log(
    `\n조회 ${looked.size}개 · 확인된 인용 ${occurrences.filter((o) => looked.has(`${o.court}|${o.caseNo}`)).length}건 중 ` +
      `없는 사건번호 ${bySeverity["없는 사건번호"].length} · 선고일 불일치 ${bySeverity["선고일 불일치"].length} · ` +
      `주제 불일치 의심 강 ${bySeverity["주제 불일치 의심(강)"].length}/약 ${bySeverity["주제 불일치 의심(약)"].length} · ` +
      `조회불가 ${bySeverity["조회불가"].length}`,
  );
  for (const verdict of ["없는 사건번호", "선고일 불일치", "주제 불일치 의심(강)", "주제 불일치 의심(약)", "조회불가"]) {
    const list = bySeverity[verdict];
    if (list.length === 0) continue;
    console.log(`\n── ${verdict} (${list.length}건)`);
    for (const f of list.slice(0, 40)) {
      console.log(`  ${label(f)} · ${f.caseNo} · ${f.field}`);
      console.log(`    ${f.detail}`);
      console.log(`    인용문: ${f.sentence.slice(0, 120)}${f.sentence.length > 120 ? "…" : ""}`);
      console.log(`    question_id=${f.questionId}`);
    }
    if (list.length > 40) console.log(`  … 외 ${list.length - 40}건 (전체는 --out 리포트에)`);
  }
  if (findings.length === 0) console.log("\n걸린 인용 없음.");

  if (outPath) {
    writeReport(outPath, {
      mode: "verify",
      checkedAt: new Date().toISOString(),
      scope: { since, paper: args.paper ?? null, subject: args.subject ?? null, sample: sample || null, limit },
      rows: rows.length,
      occurrences: occurrences.length,
      uniqueCases: unique.size,
      looked: looked.size,
      findings: findings.map((f) => ({ ...f, label: label(f) })),
    });
    console.log(`\n리포트: ${outPath}`);
  }
}

function saveCache(path, cache) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.error(`캐시 저장 실패(무시하고 계속): ${e.message}`);
  }
}

function writeReport(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

// 테스트가 순수 함수만 가져다 쓸 수 있게 내보내고, CLI 로 직접 실행됐을 때만 main()
// 을 돌린다. 이 가드가 어긋나면 루틴은 "돌았는데 아무것도 안 한" 상태로 끝나므로
// (docs/agents/explanation-batch-routines.md 의 save-explanations 사고와 같은 모양),
// crop-question-images.mjs 와 **같은 형태**(pathToFileURL 로 정규화)를 그대로 쓴다.
// audit-explanation-citations.test.mjs 가 자식 프로세스로 실제 실행해 이 가드가
// 살아 있는지 확인한다.
export { extractCitations, citationsOfRow, sentenceAround, contentTokens, topicMatch, parseCasePage, narrowToCitation };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
