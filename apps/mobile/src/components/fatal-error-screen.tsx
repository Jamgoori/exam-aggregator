import { ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";

// 앱이 뜨자마자 죽을 때 원인을 화면에 보여주는 마지막 방어선.
//
// 왜 필요한가: 릴리스 빌드에서 JS 예외가 나면 안드로이드는 "앱이 계속 중단됨" 만
// 띄우고 끝난다. 원인을 보려면 PC 에 platform-tools 를 깔고 adb logcat 을 떠야 하는데,
// 폰만 있는 상황에서는 사실상 불가능하다. 그래서 오류를 잡아 화면에 그대로 그린다 —
// 스크린샷 한 장이면 원인이 전달된다.
//
// 의도적으로 의존성을 최소화했다(테마 훅·컨텍스트 사용 안 함). 이 화면이 필요한
// 상황은 이미 무언가 깨진 상황이라, 여기서 또 다른 모듈에 기대면 같이 죽는다.
export function FatalErrorScreen({
  title,
  message,
  detail,
  hint,
}: {
  title: string;
  message: string;
  detail?: string;
  hint?: string;
}) {
  const dark = useColorScheme() === "dark";
  const bg = dark ? "#18181b" : "#ffffff";
  const fg = dark ? "#fafafa" : "#18181b";
  const muted = dark ? "#a1a1aa" : "#71717a";
  const danger = dark ? "#f87171" : "#dc2626";
  const panel = dark ? "#27272a" : "#f4f4f5";

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: danger }]}>{title}</Text>
        <Text style={[styles.message, { color: fg }]}>{message}</Text>

        {detail ? (
          <View style={[styles.panel, { backgroundColor: panel }]}>
            {/* selectable: 길게 눌러 복사할 수 있게 — 스크린샷이 잘려도 텍스트로 넘길 수 있다. */}
            <Text selectable style={[styles.detail, { color: muted }]}>
              {detail}
            </Text>
          </View>
        ) : null}

        {hint ? <Text style={[styles.hint, { color: muted }]}>{hint}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 24, paddingTop: 72, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  message: { fontSize: 15, lineHeight: 22 },
  panel: { borderRadius: 10, padding: 12, marginTop: 4 },
  detail: { fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
  hint: { fontSize: 13, lineHeight: 20, marginTop: 4 },
});
