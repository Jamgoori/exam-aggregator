import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrongQuestionSample } from "../diagnosis-coach.d.ts";
type Admin = SupabaseClient;
export declare function getWrongQuestionSamples(admin: Admin, userId: string, targets: {
    conceptId: string | null;
    concept: string;
}[], perConcept?: number): Promise<WrongQuestionSample[]>;
export {};
