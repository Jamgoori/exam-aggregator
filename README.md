# 공모아 모노레포

공무원 기출문제 자료실. 웹 + 모바일이 같은 Supabase 백엔드를 쓰고, 공유 로직은
`packages/core` 한 곳에 둔다.

```
apps/web/        Next.js 웹앱 (SSR·SEO·관리자). 배포: Vercel
apps/mobile/     Expo(React Native) 앱. 배포: EAS
packages/core/   @gongmoa/core — 웹·모바일 공유(타입·순수로직·DI 데이터접근)
supabase/        Edge Functions + schema.sql
```

npm workspaces + Turborepo. 상세 규칙은 `apps/web/AGENTS.md`, `apps/mobile/README.md`.

## 개발

```bash
npm install              # 루트에서 (워크스페이스 전체 설치)
npm run web              # 웹 dev 서버 (localhost:3000)
npm run mobile           # 모바일 Metro (Expo)
npm run typecheck        # 전체 타입체크 (turbo)
```

공유 코어는 `@gongmoa/core` 로 import. TS 소스 그대로 배포되며 Next 는
`transpilePackages`, Metro 는 `apps/mobile/metro.config.js` 로 번들한다.

## 배포

### 웹 (Vercel) — 모노레포 전환 시 1회 필수
Vercel 프로젝트 **Settings → Build & Deployment → Root Directory** 를 **`apps/web`**
로 설정. (이 저장소를 모노레포로 바꾸기 전엔 루트였음 — 안 바꾸고 push 하면 빌드가
`next` 를 못 찾아 배포 실패.) 설정 후 평소처럼 push → 자동 배포.

검증됨: `apps/web` 에서 `npx next build` 성공.

#### 루트 `optionalDependencies` 는 지우지 말 것

루트 `package.json` 의 `optionalDependencies`(lightningcss / @tailwindcss/oxide /
sharp 의 `linux-x64` 네이티브 바이너리)는 Vercel 빌드용이다. npm 은 이런 플랫폼별
optional 의존성을 **락 파일을 만든 컴퓨터의 플랫폼 것만** 기록한다 — Windows 에서
`npm install` 을 돌리면 `package-lock.json` 에 `win32` 바이너리만 남고, 리눅스인
Vercel 은 설치할 게 없어서 빌드가 이렇게 깨진다:

```
Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
```

빌드 캐시가 있는 동안엔 안 드러나고, 캐시가 비는 순간(`Previous build caches not
available`) 터진다. 루트에 명시해 두면 어느 플랫폼에서 락을 만들든 리눅스 바이너리가
남는다. 버전은 상위 패키지가 쓰는 것과 **정확히 같아야** 하므로, tailwind 나
lightningcss 를 올릴 때 이 세 줄도 같이 올릴 것.

### 모바일 (EAS)
네이티브 SDK(카카오·구글 로그인)라 Expo Go 불가 — dev build 필요.

```bash
cd apps/mobile
npx eas build --profile development --platform android   # 또는 ios
```

EAS 는 npm workspaces 모노레포를 자동 감지한다(cli >= 12). 선행:
- `app.json` 의 `PLACEHOLDER_REVERSED_CLIENT_ID`(iOS 구글) 를 실제 값으로.
- Kakao/Google 콘솔 키·Supabase OAuth provider 설정 (apps/mobile/README.md 참고).

검증됨: `npx expo export` 로 Metro 번들(공유 코어 포함) 성공. 단, 네이티브 빌드·실기기
테스트는 미실행(EAS 클라우드 빌드 필요).
