"use client";

import { useEffect } from "react";

// 상세페이지의 "해설 다운로드" 아이콘(?download=1)으로 들어왔을 때 페이지 로드
// 직후 자동으로 인쇄창을 띄운다. 해설은 저장된 파일이 아니라 이 페이지 자체를
// 인쇄해 PDF로 저장하는 방식이라, 문제/정답의 "다운로드" 버튼과 같은 자리에서
// 같은 느낌으로 동작하게 하기 위한 장치다.
//
// mount 직후 바로 print()를 부르면 문항 이미지(문제지당 수십 장, eager 로딩이라도
// 네트워크 완료를 기다리지 않음)가 덜 실린 상태로 인쇄 레이아웃이 잡혀 빈 공간이
// 생긴다(실측). 모든 이미지 로드가 끝날 때까지 기다렸다가, 브라우저가 그 크기로
// 레이아웃을 확정하도록 페인트 프레임을 두 번 넘긴 뒤 인쇄한다.
export function ExplanationAutoPrint() {
  useEffect(() => {
    let cancelled = false;

    async function waitForImages() {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              }),
        ),
      );
    }

    waitForImages().then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) window.print();
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
