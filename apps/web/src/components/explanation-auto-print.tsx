"use client";

import { useEffect } from "react";

// 상세페이지의 "해설 다운로드" 아이콘(?download=1)으로 들어왔을 때 페이지 로드
// 직후 자동으로 인쇄창을 띄운다. 해설은 저장된 파일이 아니라 이 페이지 자체를
// 인쇄해 PDF로 저장하는 방식이라, 문제/정답의 "다운로드" 버튼과 같은 자리에서
// 같은 느낌으로 동작하게 하기 위한 장치다.
//
// 예전에는 문항 이미지가 전부 실릴 때까지 기다렸다 인쇄했다 — 덜 실린 이미지가
// 인쇄 레이아웃에 빈 공간을 만들었기 때문(실측). 지금은 인쇄물에서 문제 이미지를
// 아예 빼므로(카드의 hideImagesInPrint) 기다릴 이유가 없다. 문제지당 수십 장을
// 기다리던 지연도 함께 사라진다. 레이아웃이 확정되도록 페인트 프레임만 두 번
// 넘기고 인쇄창을 띄운다.
export function ExplanationAutoPrint() {
  useEffect(() => {
    let cancelled = false;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
