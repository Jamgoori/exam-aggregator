export declare const QUERY_CONCURRENCY = 8;
export declare function inParallel<T, R>(items: readonly T[], run: (item: T) => Promise<R>, limit?: number): Promise<R[]>;
export declare const PAGE_BATCH_SIZE = 1000;
export type PagedResult<T> = {
    data: T[] | null;
    error: {
        message: string;
    } | null;
};
export declare function fetchAllPages<T>(fetchRange: (from: number, to: number) => Promise<PagedResult<T>>, label: string): Promise<T[]>;
