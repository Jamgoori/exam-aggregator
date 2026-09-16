export type ExamCombo = {
    slug: string;
    examTypeName: string;
    level: string | null;
    /** 화면·제목에 쓰는 이름. "국가직 9급" / "경찰" */
    label: string;
    /** 중복 시험지를 합친 뒤의 자료 수 */
    count: number;
    /** 내림차순 연도 목록 */
    years: number[];
    yearCounts: {
        year: number;
        count: number;
    }[];
    examTypeOrder: number;
};
export declare function comboSlug(examTypeName: string, level: string | null): string;
export declare function comboLabel(examTypeName: string, level: string | null): string;
export declare function buildExamIndex(papers: readonly {
    exam_type_id: string;
    level: string | null;
    year: number;
}[], examTypes: readonly {
    id: string;
    name: string;
    display_order?: number;
}[]): ExamCombo[];
export type TodayStudyAttempt = {
    score: number | null;
    total_questions: number | null;
    created_at: string;
};
export type TodayStudyData = {
    todayAttempts: number;
    accuracyPct: number | null;
    streakDays: number;
    week: number[];
    todayIndex: number;
    attemptCount: number;
    wrongCount: number;
};
export declare const SAMPLE_TODAY_STUDY: TodayStudyData;
export declare function computeTodayStudy(attempts: readonly TodayStudyAttempt[], counts: {
    attemptCount: number;
    wrongCount: number;
}, now?: Date): TodayStudyData;
export declare const DIAGNOSIS_CYCLE_DAYS = 7;
export declare const DIAGNOSIS_WINDOW_DAYS = 7;
export declare const COACH_MAX_TOTAL = 10;
export declare function kstToday(now?: Date): string;
export declare function currentCycleStartDate(now?: Date): string;
export declare function nextDiagnosisDate(lastDate: string): string;
export declare function daysUntilKst(date: string, now?: Date): number;
export declare function isDiagnosisEligible(counts: {
    attemptCount: number;
    wrongCount: number;
}): boolean;
export declare const DIAGNOSIS_LOCKED_HINT = "\uBB38\uC81C\uB97C \uC870\uAE08 \uB354 \uD480\uBA74 \uC9C4\uB2E8\uC744 \uBC1B\uC744 \uC218 \uC788\uC5B4\uC694 (\uC624\uB2F5 15\uAC1C \uB610\uB294 3\uD68C \uC751\uC2DC).";
export type DiagnosisIntroCta = {
    href: string;
    label: string;
    note: string | null;
};
export declare function diagnosisIntroCta({ loggedIn, premium, eligible, daysLeft, }: {
    loggedIn: boolean;
    premium: boolean;
    eligible: boolean;
    daysLeft: number | null;
}): DiagnosisIntroCta;
