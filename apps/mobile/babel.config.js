module.exports = function (api) {
  api.cache(true);
  return {
    // react-native-worklets/plugin 을 여기 직접 넣지 않는다. babel-preset-expo 57 이
    // 패키지가 설치돼 있으면 자동으로 넣어준다(babel-preset-expo/build/configs/expo.js 의
    // resolveModule(api, 'react-native-worklets/plugin')). 양쪽에서 넣으면 워클릿 변환이
    // 두 번 돌아 깨진 코드가 나온다. Uniwind 는 Babel 플러그인이 필요 없다(Metro 변환기).
    presets: ["babel-preset-expo"],
  };
};
