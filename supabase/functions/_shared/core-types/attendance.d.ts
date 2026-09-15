export declare function isAttendanceOpen(now?: Date): boolean;
export declare const ATTENDANCE_MIN_QUESTIONS = 10;
export declare const ATTENDANCE_MIN_SECONDS_PER_QUESTION = 2;
export declare function attendanceQuestionCount(input: {
    answeredCount: number;
    elapsedSeconds: number;
}): number;
export type AttendanceMilestone = {
    days: number;
    grantDays: number;
};
export declare const ATTENDANCE_MILESTONES: readonly AttendanceMilestone[];
export declare const ATTENDANCE_MONTHLY_MAX_DAYS: number;
export declare function attendanceMilestonesReached(attendedDays: number): AttendanceMilestone[];
export declare function attendanceEarnedDays(attendedDays: number): number;
export declare function nextAttendanceMilestone(attendedDays: number): AttendanceMilestone | null;
export type AttendanceProgress = {
    attendedDays: number;
    earnedDays: number;
    remainingDays: number;
    next: AttendanceMilestone | null;
    daysToNext: number | null;
};
export declare function attendanceProgress(attendedDays: number): AttendanceProgress;
export declare function attendanceMilestoneDates(attendedDates: readonly string[]): Map<string, AttendanceMilestone>;
export declare function kstDateKey(now?: Date): string;
export declare function kstMonthKey(now?: Date): string;
export declare function daysInMonthKey(monthKey: string): number;
