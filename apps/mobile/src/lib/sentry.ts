import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";
import * as Updates from "expo-updates";

// 크래시 리포팅(설계서 §3.1 관측 행). DSN 이 없으면 초기화하지 않는다 — 로컬·포크 빌드는
// 조용히 지나간다. release 는 OTA 마다 소스맵이 갈리므로 updateId 우선, dist 는 채널.
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || null;

export function initSentry(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    release: Updates.updateId ?? Application.nativeBuildVersion ?? undefined,
    dist: Updates.channel ?? undefined,
    enabled: !__DEV__,
    // 개인정보 원칙: 크래시 payload 에 문항 정답·해설 본문·user_metadata 를 넣지 않는다.
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      // fetch/xhr 브레드크럼의 응답·요청 본문(Edge 응답에 정답·해설이 실린다) 제거.
      if ((breadcrumb.category === "fetch" || breadcrumb.category === "xhr") && breadcrumb.data) {
        const { response, body, request_body, response_body, ...rest } = breadcrumb.data as Record<string, unknown>;
        void response;
        void body;
        void request_body;
        void response_body;
        return { ...breadcrumb, data: rest };
      }
      return breadcrumb;
    },
  });
}

const STRIP_KEYS = new Set(["edge", "response", "body", "user_metadata", "userMetadata", "data"]);

function stripDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => stripDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (STRIP_KEYS.has(k)) continue;
    out[k] = stripDeep(v, depth + 1);
  }
  return out;
}

// 이벤트에서 Edge 응답 본문·user_metadata 를 지운다. user 는 id 만 남긴다.
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.user) event.user = { id: event.user.id };
  if (event.extra) event.extra = stripDeep(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = stripDeep(event.contexts) as typeof event.contexts;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
  }
  return event;
}

export function captureException(e: unknown): void {
  if (!SENTRY_DSN) return;
  Sentry.captureException(e);
}
