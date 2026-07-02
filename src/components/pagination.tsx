import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

function buildHref(params: Record<string, string | undefined>, page: number) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  if (page > 1) usp.set("page", String(page));
  const qs = usp.toString();
  return qs ? `/?${qs}` : "/";
}

export function Pagination({
  currentPage,
  totalPages,
  params,
}: {
  currentPage: number;
  totalPages: number;
  params: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  // 현재 페이지 주변 ±2, 첫/끝 페이지만 노출하고 나머지는 "..."
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let p = currentPage - 2; p <= currentPage + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const items: (number | "...")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) items.push("...");
    items.push(p);
    prev = p;
  }

  return (
    <nav className="flex items-center justify-center gap-1 pt-4">
      <Link
        href={buildHref(params, Math.max(1, currentPage - 1))}
        aria-disabled={currentPage === 1}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 ${
          currentPage === 1
            ? "pointer-events-none opacity-40"
            : "hover:border-blue-300 hover:text-blue-600"
        }`}
      >
        <ChevronLeft size={16} />
      </Link>

      {items.map((item, i) =>
        item === "..." ? (
          <span key={`ellipsis-${i}`} className="px-1 text-zinc-400">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={buildHref(params, item)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium ${
              item === currentPage
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            {item}
          </Link>
        ),
      )}

      <Link
        href={buildHref(params, Math.min(totalPages, currentPage + 1))}
        aria-disabled={currentPage === totalPages}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 ${
          currentPage === totalPages
            ? "pointer-events-none opacity-40"
            : "hover:border-blue-300 hover:text-blue-600"
        }`}
      >
        <ChevronRight size={16} />
      </Link>
    </nav>
  );
}
