import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subject } from "../types.d.ts";
export declare function getSubjectBySlug(client: SupabaseClient, slug: string): Promise<Subject | null>;
