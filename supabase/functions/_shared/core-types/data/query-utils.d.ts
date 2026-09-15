export declare const QUERY_CONCURRENCY = 8;
export declare function inParallel<T, R>(items: readonly T[], run: (item: T) => Promise<R>, limit?: number): Promise<R[]>;
