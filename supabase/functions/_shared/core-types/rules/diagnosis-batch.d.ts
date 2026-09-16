import type { SupabaseClient } from "@supabase/supabase-js";
import { type DiagnosisMessageParams } from "../diagnosis-coach.d.ts";
export declare class AnthropicRequestError extends Error {
    readonly status: number | null;
    constructor(message: string, status: number | null);
}
export type DiagnosisBatchRequest = {
    custom_id: string;
    params: DiagnosisMessageParams;
};
export type DiagnosisBatchResultLine = {
    custom_id: string;
    result: {
        type: "succeeded";
        message: {
            content: {
                type: string;
                text?: string;
            }[];
        };
    } | {
        type: "errored" | "canceled" | "expired";
    };
};
export type AnthropicBatchTransport = {
    create(requests: DiagnosisBatchRequest[]): Promise<{
        id: string;
    }>;
    retrieve(batchId: string): Promise<{
        processingStatus: string;
        resultsUrl: string | null;
    }>;
    results(batchId: string, resultsUrl?: string | null): AsyncIterable<DiagnosisBatchResultLine>;
    cancel?(batchId: string): Promise<void>;
};
export type AnthropicTransportOptions = {
    apiKey: string;
    timeoutMs?: number;
    createTimeoutMs?: number;
    fetchImpl?: typeof fetch;
};
export declare function createAnthropicBatchTransport(opts: AnthropicTransportOptions): AnthropicBatchTransport;
export declare const DIAGNOSIS_RECHECK_SECONDS = 20;
export type DiagnosisBatchDeps = {
    transport: AnthropicBatchTransport | null;
    model?: string;
    now?: Date;
};
export type SubmitResult = {
    submitted: number;
    skipped: number;
    batchId?: string;
    error?: string;
};
export declare function submitPendingDiagnoses(admin: SupabaseClient, opts: {
    userId?: string;
    limit?: number;
} | undefined, deps: DiagnosisBatchDeps): Promise<SubmitResult>;
export type CollectResult = {
    ready: number;
    failed: number;
    pending: number;
};
export declare function collectDiagnosisBatches(admin: SupabaseClient, opts: {
    userId?: string;
    limit?: number;
} | undefined, deps: DiagnosisBatchDeps): Promise<CollectResult>;
export type DiagnosisCollectStatus = "pending" | "ready" | "failed" | "none";
export type DiagnosisCollectOutcome = {
    status: DiagnosisCollectStatus;
    date: string | null;
    requestedAt: string | null;
    conceptCount: number;
    error: string | null;
};
export declare function collectDiagnosisForUser(admin: SupabaseClient, userId: string, deps: DiagnosisBatchDeps): Promise<DiagnosisCollectOutcome>;
