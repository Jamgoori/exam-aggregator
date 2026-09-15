import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { Dimensions, Pressable, View } from "react-native";
import { CATALOG_GC_MS } from "../lib/query-client";
import { publicUrl } from "../lib/storage";

// 문항 크롭 이미지(설계서 §6.2 문항 이미지 행). question_images 에는 width/height 가 없으므로
// expo-image onLoad 의 source.width/height 로 실측해 `['img-dims', path]` 쿼리(퍼시스트 O)에
// 저장한다 — 웹 single-question-view.tsx onLoad 실측과 같은 방식. 첫 렌더는 웹처럼 contain +
// placeholder 높이(화면 높이의 60%). cachePolicy memory-disk, 디스크 캐시는 OS 정리에 맡긴다.
// 해설·CBT·오답노트가 함께 쓰므로 API 는 단순하게: { path, width?, onPress? }.
//
// path 는 Storage 경로(`question-images/…`) 또는 이미 조립된 공개 URL 둘 다 받는다 — Edge
// explanations-get 은 URL 을, 직접 조회(questions/question_images)는 경로를 준다.
export type ImageDims = { width: number; height: number };

const PLACEHOLDER_RATIO = 0.6;

export function imageDimsKey(path: string) {
  return ["img-dims", path] as const;
}

function resolveUri(path: string): string {
  return /^https?:\/\//.test(path) ? path : publicUrl(path);
}

export function QuestionImage({
  path,
  width,
  onPress,
  accessibilityLabel,
  className,
}: {
  path: string;
  // 그릴 폭. 없으면 onLayout 으로 부모 폭을 잰다.
  width?: number;
  onPress?: () => void;
  // 웹 alt 문구(예: "3번 문제 이미지 1").
  accessibilityLabel?: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const key = imageDimsKey(path);
  // 캐시에 있으면 그것(퍼시스트 복원 포함), 없으면 null — 네트워크 요청은 없고 onLoad 가 채운다.
  const dims = useQuery<ImageDims | null>({
    queryKey: key,
    queryFn: () => queryClient.getQueryData<ImageDims>(key) ?? null,
    staleTime: Infinity,
    gcTime: CATALOG_GC_MS,
  }).data;
  const [measured, setMeasured] = useState(0);
  const w = width ?? measured;
  const height = dims && w > 0 ? (w * dims.height) / dims.width : Dimensions.get("window").height * PLACEHOLDER_RATIO;

  const image = (
    <Image
      source={{ uri: resolveUri(path) }}
      style={{ width: w > 0 ? w : "100%", height }}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={100}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      onLoad={(e) => {
        const { width: iw, height: ih } = e.source;
        if (iw > 0 && ih > 0) queryClient.setQueryData<ImageDims>(key, { width: iw, height: ih });
      }}
    />
  );

  const measure = width == null ? (e: { nativeEvent: { layout: { width: number } } }) => setMeasured(e.nativeEvent.layout.width) : undefined;

  if (onPress) {
    return (
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={accessibilityLabel} onPress={onPress} onLayout={measure} className={className}>
        {image}
      </Pressable>
    );
  }
  return (
    <View onLayout={measure} className={className}>
      {image}
    </View>
  );
}
