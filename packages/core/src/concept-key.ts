// 개념 그룹 키 — 해설의 keyword_title 을 큐 편성용으로 거칠게 묶는다.
//
// 같은 개념을 모르면 여러 해 기출에서 각각 틀린다. 대칭키 암호를 모르는 사람은
// 2015·2018·2021 문항을 다 틀리고, 그게 문항 셋으로 따로 쌓여 같은 날 큐에 몰릴 수
// 있다. 사용자에게는 "왜 비슷한 문제만 나오지"이고, 학습 효과로도 한 개념을 하루에
// 세 번 보는 것보다 세 개념을 하루씩 보는 편이 낫다.
//
// keyword_title 은 해설 배치가 문항마다 붙이는 "핵심 개념 제목 한 줄"인데, 통제
// 어휘가 아니라 매번 자유롭게 쓰인 문자열이다. 그래서 "대칭키 암호" / "대칭키
// 암호화 방식" / "대칭키 암호 개념" 이 서로 다른 값으로 들어온다.
//
// 이 파일은 그걸 정밀하게 통일하려 들지 않는다. 용도가 큐 다양성 하나뿐이고, 그
// 용도에서는 양쪽 실패가 전부 싸기 때문이다:
//
//   잘못 묶임(다른 개념인데 같은 키)  → 그 문항이 하루 밀린다
//   안 묶임(같은 개념인데 다른 키)    → 지금과 똑같다
//
// 그래서 거칠게 묶는 쪽을 택한다. "행정행위의 하자"와 "행정행위의 취소"가 한 키로
// 묶이는 건 개념적으로는 틀렸지만 큐 편성으로는 맞다 — 하루에 행정행위 문항 여섯
// 개보다 두 개가 낫다.
//
// 정밀한 개념 축이 필요해지는 건 약점 진단("대칭키가 약합니다")을 만들 때다. 그건
// 사용자에게 틀린 말을 하면 안 되므로 통제 어휘 사전이 있어야 하고, 이 함수로
// 대신할 수 없다.
//
// 원본 keyword_title 은 화면에 그대로 보여주는 값이라 건드리지 않는다. 여기서 만든
// 키는 큐를 짤 때만 쓰고 버린다(저장하지 않는다) — 규칙을 고치면 코드만 고치면 된다.

// 제목 끝에 붙어 의미를 더하지 않는 꼬리말. 긴 것부터 지워야 "~의 개념 정리"가
// "~의 개념"을 거쳐 제대로 잘린다.
const TRAILING_NOISE = [
  "의 이해",
  "의 개념",
  "의 종류",
  "의 정의",
  "의 원리",
  "의 특징",
  "의 구분",
  "개념 정리",
  "핵심 정리",
  "정리",
  "개념",
  "종류",
  "방식",
  "기법",
  "유형",
  "이해",
];

// 파생 접미사. "암호화"와 "암호"를 같은 것으로 보려는 것이다. 과잉 절단이 될 수
// 있는 자리라(예: "정보화"→"정보") 최소한만 둔다.
const DERIVED_SUFFIXES = ["화", "성", "적"];

// 토큰을 가르는 문자. 조사까지 형태소로 다루지는 않는다 — 그 정확도가 필요한
// 용도가 아니고, 사전 없이 하는 형태소 분석은 오히려 엉뚱하게 자른다.
const SPLIT_PATTERN = /[\s·,、/()[\]{}<>"'“”‘’:;~\-–—]+/;

// 앞토막에 붙어 나오는 조사·접속. "행정행위의 하자"에서 "의"를 떼려는 것.
const PARTICLES = ["의", "와", "과", "및", "에서", "에 대한", "에 관한", "관련"];

function stripTrailingNoise(s: string): string {
  let out = s;
  for (const noise of TRAILING_NOISE) {
    if (out.length > noise.length && out.endsWith(noise)) {
      out = out.slice(0, -noise.length).trim();
    }
  }
  return out;
}

function stripParticle(token: string): string {
  for (const p of PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return token;
}

function stripDerived(token: string): string {
  for (const suffix of DERIVED_SUFFIXES) {
    // 두 글자 이상 남을 때만 자른다("성"·"화" 한 글자짜리 개념을 지우지 않으려고).
    if (token.length >= 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}

// 큐 편성에 쓸 그룹 키. 개념이 없으면(해설이 아직 없는 문항) null —
// 호출부는 그런 문항에 상한을 걸지 않는다.
//
// 규칙은 "제목의 첫 의미 토큰"이다. 제목 전체를 정규화해 비교하면 수식어 하나만
// 달라도 갈리는데, 그러면 묶이는 게 거의 없어 기능이 성립하지 않는다.
export function conceptKeyOf(keywordTitle: string | null | undefined): string | null {
  if (!keywordTitle) return null;

  const cleaned = stripTrailingNoise(keywordTitle.trim());
  if (!cleaned) return null;

  for (const raw of cleaned.split(SPLIT_PATTERN)) {
    const token = stripDerived(stripParticle(raw.trim()));
    // 한 글자짜리는 개념을 가르지 못한다("법", "수" 같은 조각). 다음 토큰으로.
    if (token.length >= 2) return token.toLowerCase();
  }

  // 전부 한 글자면 원문을 통째로 키로 쓴다(묶이진 않아도 잃지는 않는다).
  return cleaned.toLowerCase();
}

// 같은 개념으로 볼지. 키가 없는 쪽(해설 없는 문항)은 언제나 다른 것으로 친다 —
// 모른다는 이유로 서로 묶으면 해설 없는 문항끼리 상한에 걸린다.
export function sameConcept(a: string | null, b: string | null): boolean {
  return a != null && b != null && a === b;
}
