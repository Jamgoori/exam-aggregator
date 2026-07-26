module.exports = function (api) {
  api.cache(true);
  return {
    // reanimated 플러그인을 여기 직접 넣지 않는다. babel-preset-expo 가 패키지가
    // 설치돼 있으면 자동으로 넣어준다(babel-preset-expo/build/index.js 의
    // "Automatically add `react-native-reanimated/plugin` when the package is installed").
    // 양쪽에서 넣으면 워클릿 변환이 두 번 돌아 깨진 코드가 나온다.
    presets: ["babel-preset-expo"],
  };
};
