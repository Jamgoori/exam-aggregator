import path from "node:path";

// PDF 에서 뽑아낸 과목명을 파일 이름으로 쓸 때의 안전장치.
//
// 통합본 분리 스크립트(split-by-toc · split-by-subject-header · split-combined-pdf)는
// 표지 목차나 페이지 머리글에서 과목명을 정규식으로 뽑아
// path.join(outDir, `${subject}.pdf`) 로 바로 쓴다. 그런데 그 문자열은 우리가 만든
// 값이 아니라 **PDF 안에 적혀 있던 값**이다. 공백만 지우고 있어서 "../" 가 그대로
// 살아남았고, 목차에 【../../../어딘가】 같은 항목이 심긴 PDF 를 돌리면 출력 폴더
// 밖에 파일을 쓰게 된다.
//
// 기출 통합본은 카페·블로그 재배포본을 받아 돌리는 경우가 많아 "우리가 만든 PDF 만
// 들어온다"를 전제할 수 없다.
//
// 거르지 않고 **씻어서** 쓴다. 화이트리스트로 거부하면 못 보던 표기(한자·로마숫자·
// 특수 괄호)가 섞인 정상 과목이 조용히 통째로 빠지는데, 분리 스크립트에서 파일 하나가
// 없어지는 건 알아채기 어렵고 그대로 업로드까지 간다.

// 파일명에 쓸 수 없거나 위험한 문자(윈도우 금지 문자 + 제어문자). 경로 구분자는
// basename 이 먼저 걷어낸다. 공백·하이픈은 정상 과목명에 나오므로 지우지 않는다.
const UNSAFE_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]', "g");

/**
 * 파일 이름으로 안전한 형태로 씻는다. 남는 것이 없으면 null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeFileStem(raw) {
  const stem = path
    .basename(String(raw ?? "")) // "../" 를 포함한 경로 성분 제거
    .replace(UNSAFE_CHARS, "")
    .replace(/^\.+/, "") // 앞의 점(".", "..", 숨김 파일) 제거
    .trim();
  return stem || null;
}

/**
 * outDir 안으로 보장되는 출력 경로. 씻은 뒤에도 벗어나면 null.
 * (basename 으로 이미 막히지만, 경로 조립은 마지막에 한 번 더 확인하는 값이 싸다.)
 * @param {string} outDir
 * @param {unknown} rawStem
 * @param {string} ext
 * @returns {string | null}
 */
export function safeOutPath(outDir, rawStem, ext = ".pdf") {
  const stem = safeFileStem(rawStem);
  if (!stem) return null;

  const dir = path.resolve(outDir);
  const full = path.resolve(dir, `${stem}${ext}`);
  if (full !== path.join(dir, `${stem}${ext}`)) return null;
  if (!full.startsWith(dir + path.sep)) return null;
  return full;
}
