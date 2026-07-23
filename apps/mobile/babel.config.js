module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // reanimated 플러그인은 반드시 마지막에.
    plugins: ["react-native-reanimated/plugin"],
  };
};
