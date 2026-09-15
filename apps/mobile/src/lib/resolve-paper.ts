import { isPaperUuid, normalizePaperSlugParam, resolvePaperId, type Catalog } from "@gongmoa/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { useCatalog } from "../queries/catalog";

// `/papers/[id]` 의 [id] 는 슬러그·UUID 모두 받는다(설계서 §5). core isPaperUuid 면 그대로,
// 아니면 카탈로그(퍼시스트)의 slugMap 역색인 — 웹 lib/paper-slug-map.ts resolvePaperId 와
// 같은 규칙(core data/paper-slug-map.ts). UUID 는 카탈로그를 기다리지 않는다.
export type ResolvedPaper =
  | { status: "ready"; id: string }
  | { status: "pending"; id: null }
  | { status: "error"; id: null }
  | { status: "not-found"; id: null };

export function useResolvedPaperId(param: string | string[] | undefined): ResolvedPaper & {
  catalog: UseQueryResult<Catalog>;
} {
  const catalog = useCatalog();
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return { status: "not-found", id: null, catalog };
  const slug = normalizePaperSlugParam(raw);
  if (isPaperUuid(slug)) return { status: "ready", id: slug, catalog };
  if (catalog.isPending) return { status: "pending", id: null, catalog };
  if (catalog.isError) return { status: "error", id: null, catalog };
  const id = resolvePaperId(raw, catalog.data.slugMap);
  return id ? { status: "ready", id, catalog } : { status: "not-found", id: null, catalog };
}
