"use client";

import { useEffect } from "react";

// 상세페이지의 "해설 다운로드" 아이콘(?download=1)으로 들어왔을 때 페이지 로드
// 직후 자동으로 인쇄창을 띄운다. 해설은 저장된 파일이 아니라 이 페이지 자체를
// 인쇄해 PDF로 저장하는 방식이라, 문제/정답의 "다운로드" 버튼과 같은 자리에서
// 같은 느낌으로 동작하게 하기 위한 장치다.
export function ExplanationAutoPrint() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
}
