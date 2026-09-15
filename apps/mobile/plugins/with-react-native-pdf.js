// react-native-pdf 용 최소 config plugin. 공식 out-of-tree 플러그인
// (@config-plugins/react-native-pdf) 이 하는 일은 android/app/build.gradle 의 android {}
// 블록에 packagingOptions.pickFirst 를 넣는 것 하나뿐이라, 의존성을 하나 더 얹는 대신
// 같은 내용을 여기 둔다(react-native-pdf README "Android installation" 절과 동일).
const { withAppBuildGradle, WarningAggregator, createRunOncePlugin } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const PACKAGING_OPTIONS = `
    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libjsc.so'
        pickFirst 'lib/arm64-v8a/libjsc.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
    }
`;

const withReactNativePdf = (config) =>
  withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") {
      WarningAggregator.addWarningAndroid(
        "with-react-native-pdf",
        "build.gradle 이 groovy 가 아니라 packagingOptions 를 자동으로 넣지 못했다.",
      );
      return c;
    }
    c.modResults.contents = mergeContents({
      tag: "react-native-pdf-packaging-options",
      src: c.modResults.contents,
      newSrc: PACKAGING_OPTIONS,
      anchor: /android(?:\s+)?\{/,
      offset: 1,
      comment: "//",
    }).contents;
    return c;
  });

module.exports = createRunOncePlugin(withReactNativePdf, "with-react-native-pdf", "1.0.0");
