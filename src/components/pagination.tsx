import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

function buildHref(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number,
) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  if (page > 1) usp.set("page", String(page));
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function PageBlock({
  currentPage,
  totalPages,
  blockSize,
  basePath,
  params,
  className,
}: {
  currentPage: number;
  totalPages: number;
  blockSize: number;
  basePath: string;
  params: Record<string, string | undefined>;
  className: string;
}) {
  const blockStart = Math.floor((currentPage - 1) / blockSize) * blockSize + 1;
  const blockEnd = Math.min(blockStart + blockSize - 1, totalPages);
  const prevBlockPage = blockStart - 1;
  const nextBlockPage = blockEnd + 1;

  const pages = [];
  for (let p = blockStart; p <= blockEnd; p++) pages.push(p);

  return (
    <nav className={`items-center justify-center gap-1 pt-4 ${className}`}>
      <Link
        href={buildHref(basePath, params, Math.max(1, prevBlockPage))}
        aria-disabled={prevBlockPage < 1}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 ${
          prevBlockPage < 1
            ? "pointer-events-none opacity-40"
            : "hover:border-blue-300 hover:text-blue-600"
        }`}
      >
        <ChevronLeft size={16} />
      </Link>

      {pages.map((p) => (
        <Link
          key={p}
          href={buildHref(basePath, params, p)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium ${
            p === currentPage
              ? "bg-blue-600 text-white"
              : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
          }`}
        >
          {p}
        </Link>
      ))}

      <Link
        href={buildHref(basePath, params, Math.min(totalPages, nextBlockPage))}
        aria-disabled={nextBlockPage > totalPages}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 ${
          nextBlockPage > totalPages
            ? "pointer-events-none opacity-40"
            : "hover:border-blue-300 hover:text-blue-600"
        }`}
      >
        <ChevronRight size={16} />
      </Link>
    </nav>
  );
}

export function Pagination({
  currentPage,
  totalPages,
  params,
  basePath = "/",
}: {
  currentPage: number;
  totalPages: number;
  params: Record<string, string | undefined>;
  basePath?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <>
      <PageBlock
        currentPage={currentPage}
        totalPages={totalPages}
        blockSize={5}
        basePath={basePath}
        params={params}
        className="flex sm:hidden"
      />
      <PageBlock
        currentPage={currentPage}
        totalPages={totalPages}
        blockSize={10}
        basePath={basePath}
        params={params}
        className="hidden sm:flex"
      />
    </>
  );
}
