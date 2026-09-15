import { router } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { ChevronLeft, Share2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Pdf from "react-native-pdf";
import { AppText } from "../app-text";
import { PendingSpinner } from "../button";
import { InlineAlert } from "../feedback";
import { LoginPrompt } from "../login-prompt";
import { sharePdf, type PdfKind } from "../../lib/download";
import { publicUrl } from "../../lib/storage";
import { useAuth } from "../../providers/auth-provider";
import { useIsDark } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 원본·정답 PDF 뷰어(설계서 §5 `/download` 행). 웹 /download/* 는 절대 부르지 않는다 —
// Storage 공개 URL 을 react-native-pdf 에 직접 준다(cache: true, 뷰어 캐시는 OS 정리에 맡김).
// 보기는 로그인 불필요, 저장/공유(L)만 lib/download.ts#sharePdf — 이 버튼을 누른 순간에만
// increment_download_count 가 불린다(뷰어 진입·프리로드에서는 절대 아님, AGENTS.md).
// 가로 허용: 진입 시 unlockAsync, 이탈 시 PORTRAIT_UP 으로 되돌린다(§4.4).
const BackIcon = themedIcon(ChevronLeft);
const ShareIcon = themedIcon(Share2);

export function PdfViewer({
  paperId,
  kind,
  storagePath,
  fileName,
  title,
}: {
  paperId: string;
  kind: PdfKind;
  storagePath: string;
  fileName: string;
  title: string;
}) {
  const { userId } = useAuth();
  const dark = useIsDark();
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  async function share() {
    if (!userId) {
      // 게스트 모드(§7.0): 버튼을 숨기지 않고 그 자리에 로그인 안내를 그린다.
      setLoginPrompt(true);
      return;
    }
    setShareError(null);
    setSharing(true);
    try {
      await sharePdf(paperId, kind, storagePath, fileName);
    } catch (e) {
      setShareError(e instanceof Error && e.message ? e.message : "파일을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSharing(false);
    }
  }

  const shareLabel = kind === "answer" ? "정답 저장·공유" : "문제 저장·공유";

  return (
    <View className="flex-1 bg-white dark:bg-zinc-900">
      <View className="h-12 flex-row items-center gap-1 border-b border-zinc-200 px-2 dark:border-zinc-700">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/papers"))}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <BackIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-300" />
        </Pressable>
        <AppText variant="sm" weight="semibold" numberOfLines={1} className="min-w-0 flex-1">
          {title}
        </AppText>
        {pages > 0 && (
          <AppText variant="xs" tabular className="shrink-0 px-1 text-zinc-500 dark:text-zinc-400">
            {page}/{pages}
          </AppText>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shareLabel}
          accessibilityState={{ disabled: sharing, busy: sharing }}
          accessibilityHint={userId ? undefined : "로그인 후 이용할 수 있어요"}
          disabled={sharing}
          onPress={() => void share()}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          {sharing ? (
            <PendingSpinner colorClassName="text-blue-600 dark:text-blue-400" />
          ) : (
            <ShareIcon size={18} colorClassName="text-zinc-600 dark:text-zinc-300" />
          )}
        </Pressable>
      </View>

      {loginPrompt && !userId && (
        <View className="px-4 pt-3">
          <LoginPrompt message="저장·공유는 로그인 후 이용할 수 있어요" />
        </View>
      )}
      {shareError && (
        <View className="px-4 pt-3">
          <InlineAlert message={shareError} onRetry={() => void share()} />
        </View>
      )}

      {error ? (
        <View className="px-4 pt-6">
          <InlineAlert
            message={error}
            onRetry={() => {
              setError(null);
              setReloadKey((k) => k + 1);
            }}
          />
        </View>
      ) : (
        <Pdf
          key={reloadKey}
          source={{ uri: publicUrl(storagePath), cache: true }}
          trustAllCerts={false}
          onLoadComplete={(numberOfPages) => setPages(numberOfPages)}
          onPageChanged={(current, numberOfPages) => {
            setPage(current);
            setPages(numberOfPages);
          }}
          onError={() => setError("PDF 를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.")}
          style={{ flex: 1, backgroundColor: dark ? "#18181b" : "#f4f4f5" }}
        />
      )}
    </View>
  );
}
