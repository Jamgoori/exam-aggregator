// Expo + npm workspaces 모노레포용 Metro 설정.
// 기본 Expo 설정은 앱 폴더만 감시하므로, 워크스페이스 루트와 공유 패키지
// (@gongmoa/core)를 번들·해석하도록 확장한다.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1) 워크스페이스 전체(공유 패키지 포함)를 Metro 가 감시하도록 한다.
config.watchFolders = [workspaceRoot];

// 2) 모듈 해석은 앱 로컬 → 워크스페이스 루트 순서로만(호이스팅된 의존성 대응).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3) 상위 폴더로 무한정 올라가며 중복 해석하는 것을 막아, 로컬/루트 두 곳만 본다.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
