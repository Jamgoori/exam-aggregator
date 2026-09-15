import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperIdentitySignal } from "../dedup-papers.d.ts";
export declare function fetchPaperIdentitySignals(client: SupabaseClient, paperIds: string[], answers?: SupabaseClient | null): Promise<Map<string, PaperIdentitySignal>>;
