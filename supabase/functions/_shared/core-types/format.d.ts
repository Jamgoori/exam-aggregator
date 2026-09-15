export declare function formatFileSize(bytes: number | null): string | null;
export declare function formatCount(n: number): string;
export declare function formatDuration(totalSeconds: number): string;
export declare const KST_TIME_ZONE = "Asia/Seoul";
export declare function kstDayKey(value: Date | string): string;
export declare function chunk<T>(items: readonly T[], size: number): T[][];
