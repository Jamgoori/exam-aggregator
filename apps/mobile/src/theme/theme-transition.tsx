import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Uniwind, type ThemeName } from "uniwind";
import { setThemePreference, tokens, type ThemePreference } from "./index";
import { useReduceMotion } from "../lib/reduce-motion";

// 테마 전환 애니메이션(설계서 §4.3 "Reanimated 400ms 크로스페이드", 웹 View Transition 대응).
//
// 웹은 View Transitions API 가 전/후 화면을 스냅샷 두 장으로 찍어 겹쳐 페이드한다. RN 에는 그
// 자리에 쓸 게 없고, 스냅샷 라이브러리(react-native-view-shot 류)는 네이티브 모듈이라 넣는 순간
// 이 변경이 OTA 로 못 나간다 — 새 APK 를 받은 사람만 보는 애니메이션이 된다. 그래서 스냅샷
// 없이 되는 **전면 워시(wash)** 로 간다:
//
//   ① 화면 전체를 덮는 불투명 판을 **바뀌기 전** 배경색으로 160ms 페이드인
//   ② 완전히 덮은 프레임에서 테마 교체
//   ③ 판을 240ms 걷으면서, 그 앞 140ms 동안 판 색을 **바뀐 뒤** 배경색으로 함께 옮긴다 (합 400ms)
//
// 판 색이 ①·③ 에서 달라야 한다 — 덮을 때 새 배경색을 쓰면 덮는 동작 자체가 하드컷이고, 걷을 때
// 옛 배경색을 쓰면 다 걷힌 뒤에 색이 튄다. 각 구간에서 "지금 화면 색"과 같아야 판이 보이지 않고
// 밝기만 흐른다.
//
// **그 색 교체를 ② 에서 한 프레임에 끝내면 안 된다.** 그 순간 화면에 보이는 것은 판 하나뿐이라,
// 판이 흰색에서 검은색으로 튀면 사용자는 없애려던 하드컷을 **더 큰 폭으로**(화면 전체가
// 100% → 4% 광량, 원래 하드컷은 내용이 남아 85% → 8%) 그대로 본다. 그래서 색은 걷는 동작에
// 겹쳐 시간을 두고 옮긴다 — 판이 아직 두꺼운 앞 140ms 에 색이 흐르고, 다 흐른 뒤에는 판과 새
// 배경이 같은 색이라 남은 100ms 는 눈에 띄지 않는다. Reanimated 의 `withTiming` 은 색 문자열을
// 선형 RGB 로 보간하므로 중간 프레임이 탁해지지 않는다.
//
// 덮이는 범위는 이 컴포넌트를 어디에 얹느냐로 정해진다(_layout.tsx 의 `Gates` 맨 뒤 = 헤더·
// 탭바까지). **RN `Modal` 은 별도 네이티브 창이라 이 판이 그 위를 덮지 못한다** — 시트(`Sheet`)와
// 드로어(`NavDrawer`)가 그 경우인데, 테마를 바꾸는 자리는 헤더의 `ThemeToggle` 하나뿐이고 그
// 헤더는 모달 안에 없다(모달이 떠 있으면 헤더를 누를 수도 없다). 지금은 닿지 않는 한계라
// 적어만 둔다 — 나중에 시트 안에 테마 스위치를 두게 되면 그때 이 판도 모달로 올려야 한다.
const COVER_MS = 160;
const REVEAL_MS = 240;
// 색 이동은 걷기보다 **짧아야** 한다 — 판이 얇아진 뒤에도 색이 흐르면 옛 색 필름이 새 화면 위에
// 남아 내용이 탁하게 비친다.
const TINT_MS = 140;

// 판 색은 화면 배경 토큰 그대로여야 한다 — 루트 `Stack` 의 contentStyle 이 쓰는 바로 그 값이다.
function backgroundFor(theme: ThemeName): string {
  return theme === "dark" ? tokens.dark.background : tokens.light.background;
}

// 헤더 토글 ↔ 루트에 한 번 마운트된 오버레이를 잇는 작은 외부 스토어(drawer-store 와 같은 방식,
// 전역 상태 라이브러리는 추가하지 않는다 — 설계서 §3.5).
type Runner = (next: ThemePreference) => void;
let runner: Runner | null = null;
let running = false;

// 호출부가 부르는 것. 테마 적용 자체는 기존 `setThemePreference` 에 그대로 맡기고 여기서는
// **언제 부를지**만 잡는다 — 애니메이션은 호출부의 일이지 그 함수의 책임이 아니다.
export function startThemeTransition(next: ThemePreference): void {
  // 연타 무시. 덮는 중에 또 누르면 판이 반쯤 걷힌 상태에서 색이 두 번 갈려 그때는 정말 깜빡인다.
  if (running) return;
  // 오버레이가 트리에 없으면(루트 밖에서 쓰는 화면) 애니메이션 없이 곧장 바꾼다. 테마가 안
  // 바뀌는 것보다는 하드컷이 낫다.
  if (!runner) {
    void setThemePreference(next);
    return;
  }
  running = true;
  runner(next);
}

export function ThemeTransitionOverlay() {
  const opacity = useSharedValue(0);
  // 판 색도 shared value 로 든다. setState 로 바꾸면 ② 의 테마 교체 리렌더와 뒤엉켜 옛 색 판이
  // 한 프레임 더 남을 수 있는데, 그 한 프레임이 정확히 "덮인 채 색만 바뀌는" 구간이다.
  const wash = useSharedValue<string>(backgroundFor(Uniwind.currentTheme));
  const reduce = useReduceMotion();
  // runner 는 마운트 때 한 번만 등록하므로(재등록 때마다 cleanup 이 진행 중인 전환을 되돌린다)
  // 최신 설정값은 ref 로 읽는다.
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  useEffect(() => {
    const finish = () => {
      running = false;
    };

    const swap = (next: ThemePreference) => {
      // 판이 완전히 덮은 프레임. `setThemePreference` 는 `Uniwind.setTheme` 를 **동기로** 부르고
      // 저장(kv)만 await 하므로, 바로 아래에서 읽는 currentTheme 은 이미 바뀐 뒤 값이다
      // (next 가 null = 시스템 인 경우도 이걸로 해석된다).
      void setThemePreference(next);
      wash.value = withTiming(backgroundFor(Uniwind.currentTheme), {
        duration: TINT_MS,
        easing: Easing.inOut(Easing.ease),
      });
      // 걷기는 `Easing.in` — 색이 흐르는 앞구간에 판을 두껍게 붙들어 둔다. 여기서 `Easing.out`
      // 을 쓰면 판이 먼저 얇아져 옛 색 필름 너머로 새 화면이 비친다.
      opacity.value = withTiming(0, { duration: REVEAL_MS, easing: Easing.in(Easing.ease) }, () => {
        runOnJS(finish)();
      });
    };

    runner = (next) => {
      if (reduceRef.current) {
        // 동작 줄이기: 워시를 건너뛰고 즉시 바꾼다. 여기서 애니메이션은 내용이 아니라 장식이라
        // 결과만 보여주면 된다.
        void setThemePreference(next);
        running = false;
        return;
      }
      // 값 대입은 진행 중이던 애니메이션을 취소한다 — ③ 의 색 이동이 아직 남아 있어도 여기서
      // 지금 화면 색으로 못 박고 시작한다.
      wash.value = backgroundFor(Uniwind.currentTheme);
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: COVER_MS, easing: Easing.out(Easing.ease) }, (done) => {
        if (done) {
          runOnJS(swap)(next);
          return;
        }
        // 덮기가 취소된 경우(언마운트 정리·다음 전환의 대입). 교체는 하지 않고 판을 반드시
        // 투명으로 되돌린 뒤 잠금을 푼다 — 한 번의 탭을 흘리는 건 괜찮지만, 반쯤 덮인 판이
        // 남으면 화면이 물든 채 굳고(터치는 통과해 원인도 안 보인다) `running` 이 켜진 채
        // 남으면 토글이 영영 죽는다.
        opacity.value = 0;
        runOnJS(finish)();
      });
    };

    return () => {
      // 전환 도중에 이 컴포넌트가 사라져도 판이 덮인 채로 잠기지 않게, 그리고 다음 호출이 죽은
      // runner 를 잡지 않게 되돌린다. (루트에 한 번 얹히는 컴포넌트라 화면 이동으로는 여기 오지
      // 않지만, 남으면 앱이 멈춘 것처럼 보이는 실패라 되돌림을 생략하지 않는다.)
      runner = null;
      running = false;
      opacity.value = 0;
    };
  }, [opacity, wash]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, backgroundColor: wash.value }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}
