// EAS 빌드 서버에서 install 직후에 도는 검사(package.json 의 eas-build-post-install).
//
// 왜 필요한가: expo 계열 패키지는 JS 부분과 네이티브 부분이 따로 움직인다. JS 는
// node_modules 에 있기만 하면 Metro 가 번들에 넣지만, 네이티브 모듈은 **앱의 의존성
// 그래프에 들어 있는 패키지만** autolinking 이 APK 에 넣는다. peer dependency 로만
// 딸려온 패키지(npm 이 자동 설치해 준 것)는 그래프 밖이라 링크되지 않는다.
//
// 그러면 번들은 정상적으로 만들어지고 빌드도 초록불인데, 폰에서 앱을 켜는 순간
// requireNativeModule 이 "Cannot find native module 'X'" 로 던지고 화면도 없이 꺼진다.
// 실제로 expo-linking 이 그랬다 — expo-router 의 peer dependency 라서 package.json 에
// 없었고, 그래서 APK 에 네이티브가 빠진 채로 나갔다.
//
// 여기서 설치된 expo 모듈과 실제로 링크되는 목록을 대조해 빌드 단계에서 끊는다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// gradle(settings.gradle) 이 링크 목록을 뽑을 때와 같은 방식으로 부른다 — 프로젝트
// 디렉터리에서 실행해야 같은 결과가 나온다.
function linkedPackages(platform) {
  const output = execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "-e",
      "require(require.resolve('expo-modules-autolinking', { paths: [require.resolve('expo/package.json')] }))(process.argv.slice(1))",
      "resolve",
      "-p",
      platform,
      "--json",
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return new Set(JSON.parse(output).modules.map((mod) => mod.packageName));
}

// 설치돼 있고 해당 플랫폼에 네이티브 모듈이 있는 expo 패키지를 모은다.
function installedNativePackages(platform) {
  const found = new Map();
  // 모노레포라 워크스페이스 로컬과 루트 hoist 위치를 모두 본다.
  const roots = [
    path.join(projectRoot, "node_modules"),
    path.join(projectRoot, "..", "..", "node_modules"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (found.has(name)) continue;
      const configPath = path.join(root, name, "expo-module.config.json");
      if (!existsSync(configPath)) continue;
      let config;
      try {
        config = JSON.parse(readFileSync(configPath, "utf8"));
      } catch {
        continue;
      }
      const modules = config[platform]?.modules ?? [];
      if ((config.platforms ?? []).includes(platform) && modules.length > 0) {
        found.set(name, modules);
      }
    }
  }
  return found;
}

const platform = process.env.EAS_BUILD_PLATFORM === "ios" ? "ios" : "android";
const linked = linkedPackages(platform);
const missing = [...installedNativePackages(platform).keys()].filter((name) => !linked.has(name));

if (missing.length > 0) {
  console.error(
    [
      "",
      `빌드 중단: 설치돼 있지만 ${platform} 네이티브가 링크되지 않는 expo 모듈이 있다.`,
      ...missing.map((name) => `  - ${name}`),
      "",
      "이대로 빌드하면 APK 는 나오지만, 앱을 켜는 순간",
      "\"Cannot find native module\" 로 화면도 없이 꺼진다.",
      "",
      "고치는 법: apps/mobile/package.json 의 dependencies 에 위 패키지를 직접 추가한다",
      "(peer dependency 로만 딸려온 패키지는 autolinking 대상이 아니다).",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`[native-modules] ${platform} 네이티브 모듈 링크 확인 완료 (${linked.size}개).`);
