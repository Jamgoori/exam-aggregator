// Expo + npm workspaces 모노레포용 Metro 설정 + Uniwind.
// SDK 57 의 expo/metro-config 는 워크스페이스 루트를 스스로 찾아 감시·해석한다. 예전의
// disableHierarchicalLookup 오버라이드는 두지 않는다 — expo-router 가 자기 node_modules 안에
// 중첩 설치한 @expo/ui 같은 패키지를 못 찾게 만들고 expo-doctor 도 이를 경고한다. 앱이 핀
// 고정한 버전이 apps/mobile/node_modules 에 따로 놓이면 계층 탐색이 그쪽을 먼저 잡는다.
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 워크스페이스 전체(공유 패키지 @gongmoa/core·@gongmoa/design-tokens 포함)를 감시하고,
// 모듈 해석은 앱 로컬 → 워크스페이스 루트 순서로(호이스팅된 의존성 대응).
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Uniwind 는 최외곽 — transformerPath·resolver.resolveRequest 를 감싸므로 다른 래퍼가
// 그 뒤에 오면 CSS 엔트리 변환이 빠진다. cssEntryFile 은 process.cwd() 기준(앱 루트).
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
