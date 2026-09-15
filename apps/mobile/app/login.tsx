import { DIAGNOSIS_MIN_ATTEMPTS } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { BookOpenCheck, BrainCircuit, Monitor } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText } from "../src/components/app-text";
import { Button } from "../src/components/button";
import { GoogleIcon, KakaoIcon } from "../src/components/provider-icons";
import { Screen } from "../src/components/screen";
import { isKakaoCancel, signInWithGoogle, signInWithKakao, statusCodes } from "../src/lib/auth";
import { openLegal, type LegalDoc } from "../src/lib/legal";
import { resolveNextPath } from "../src/lib/next-path";
import { currentNickname } from "../src/lib/profile";
import { themedIcon } from "../src/theme/icons";

// 로그인 모달(웹 login/page.tsx 1:1, 설계서 §5 `/login?next&error` 행). 소셜 전용 —
// 네이티브 SDK 로 바로 로그인한다. Apple 은 소유자 결정(§12-2 6번)으로 보류라 버튼을 그리지
// 않는다. 로그인 후 순서(§7.1): membership-get(auth.ts) → 닉네임 없으면 온보딩 → next(기본 `/`).
type Provider = "google" | "kakao";

const MonitorIcon = themedIcon(Monitor);
const NoteIcon = themedIcon(BookOpenCheck);
const BrainIcon = themedIcon(BrainCircuit);

function isGoogleCancel(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === statusCodes.SIGN_IN_CANCELLED;
}

export default function LoginScreen() {
  const params = useLocalSearchParams<{ next?: string; error?: string }>();
  const next = resolveNextPath(params.next);
  // CBT 를 누르다 여기로 튕겨 온 사람에게는 "이 문제지 바로 시작"이 로그인의 이유다.
  const fromCbt = /^\/papers\/[^/]+\/cbt(\/|$)/.test(next);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(params.error ?? null);

  async function run(provider: Provider) {
    try {
      setBusy(provider);
      setError(null);
      const { session } = provider === "google" ? await signInWithGoogle() : await signInWithKakao();
      // 모달 프레젠테이션에서는 replace 로 모달을 닫으며 이동한다(§7.0).
      if (session && !currentNickname(session.user.user_metadata)) {
        router.replace(`/onboarding/nickname?next=${encodeURIComponent(next)}` as Href);
      } else {
        router.replace(next as Href);
      }
    } catch (e) {
      // 사용자가 시트를 직접 닫은 건 실패가 아니다 — 조용히 머무른다.
      if (isGoogleCancel(e) || isKakaoCancel(e)) return;
      setError(e instanceof Error && e.message ? e.message : "로그인에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(doc: LegalDoc) {
    try {
      await openLegal(doc);
    } catch (e) {
      Alert.alert("문서를 열 수 없어요", e instanceof Error ? e.message : "");
    }
  }

  const benefitIcon = "text-emerald-600 dark:text-emerald-400";

  return (
    <Screen footer={false} contentClassName="max-w-sm gap-6 py-16">
      <View>
        <AppText variant="2xl" weight="semibold">
          {fromCbt ? "로그인하고 바로 시작하기" : "로그인"}
        </AppText>
        <AppText variant="sm" className="mt-1 text-zinc-500" pretty>
          {fromCbt
            ? "로그인이 끝나면 고른 문제지의 응시 화면으로 바로 이어져요. 처음이라면 로그인과 동시에 가입돼요."
            : "처음이라면 로그인과 동시에 가입돼요."}
        </AppText>
      </View>

      {/* 이 화면이 최대 이탈 지점이다 — 왜 열어야 하는지를 문 앞에서 말한다. */}
      <View className="gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
        <View className="flex-row items-center gap-2">
          <MonitorIcon size={15} colorClassName={benefitIcon} />
          <AppText variant="13" className="flex-1 text-emerald-900 dark:text-emerald-100" pretty>
            온라인 CBT 응시 기록과 회독이 계정에 남아요
          </AppText>
        </View>
        <View className="flex-row items-center gap-2">
          <NoteIcon size={15} colorClassName={benefitIcon} />
          <AppText variant="13" className="flex-1 text-emerald-900 dark:text-emerald-100" pretty>
            틀린 문제는 오답노트에 자동으로 쌓여요
          </AppText>
        </View>
        <View className="flex-row items-center gap-2">
          <BrainIcon size={15} colorClassName={benefitIcon} />
          <AppText variant="13" className="flex-1 text-emerald-900 dark:text-emerald-100" pretty>
            {DIAGNOSIS_MIN_ATTEMPTS}회만 풀면 AI가 약점을 개념 단위로 짚어줘요
          </AppText>
        </View>
      </View>

      <View className="gap-3">
        <Button
          variant="outline"
          label="Google로 계속하기"
          icon={<GoogleIcon />}
          pending={busy === "google"}
          disabled={busy !== null}
          onPress={() => void run("google")}
          className="rounded gap-2 px-4 py-2.5"
          textClassName="font-normal text-base text-zinc-900 dark:text-zinc-100"
        />
        <Button
          label="카카오로 계속하기"
          icon={<KakaoIcon />}
          pending={busy === "kakao"}
          disabled={busy !== null}
          onPress={() => void run("kakao")}
          className="rounded gap-2 bg-[#FEE500] px-4 py-2.5 active:bg-[#f0d800]"
          textClassName="font-normal text-base text-black/90"
        />
        {/* 웹에서 쓰던 계정으로 그대로 — 계정 연속성 안내(§7.1). */}
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500" pretty>
          웹에서 쓰던 Google/카카오 계정으로 로그인하면 기록이 그대로 이어져요.
        </AppText>
      </View>

      {error && (
        <AppText variant="sm" className="text-red-600 dark:text-red-400" accessibilityRole="alert" pretty>
          {error}
        </AppText>
      )}

      <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500" pretty>
        로그인하면{" "}
        <AppText variant="xs" className="text-zinc-400 underline dark:text-zinc-500" onPress={() => void openDoc("terms")}>
          이용약관
        </AppText>
        과{" "}
        <AppText variant="xs" className="text-zinc-400 underline dark:text-zinc-500" onPress={() => void openDoc("privacy")}>
          개인정보처리방침
        </AppText>
        에 동의한 것으로 간주돼요. 계정 관리(비밀번호·복구)는 구글/카카오 계정 설정을 따라요.
      </AppText>

      <Pressable
        accessibilityRole="button"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        className="self-center py-2"
      >
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
          둘러보기로 돌아가기
        </AppText>
      </Pressable>
    </Screen>
  );
}
