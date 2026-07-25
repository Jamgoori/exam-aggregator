// Expo + npm workspaces 모노레포용 Metro 설정.
//
// expo/metro-config 는 SDK 51+ 부터 모노레포를 자동 감지해 워크스페이스 루트 감시와
// nodeModulesPaths 를 이미 넣어준다. 예전 설정은 그 배열들을 통째로 덮어써서 Expo 가
// 넣어둔 항목(예: 앱 로컬 경로·에셋 경로)을 날려버렸고, disableHierarchicalLookup 까지
// 켜서 중첩 node_modules(호이스팅 안 된 의존성) 해석을 막았다. 그래서 여기서는
// "덮어쓰기"가 아니라 "빠진 것만 추가"한다.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 중복 없이 합친다(Expo 기본값 보존).
const union = (base, extra) => [...new Set([...(base ?? []), ...extra])];

// 워크스페이스 전체(공유 패키지 @gongmoa/core 포함)를 감시.
config.watchFolders = union(config.watchFolders, [workspaceRoot]);

// 호이스팅된 의존성은 루트 node_modules 에 있다. 앱 로컬 → 루트 순서.
config.resolver.nodeModulesPaths = union(config.resolver.nodeModulesPaths, [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]);

module.exports = config;
