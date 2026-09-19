import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationType } from "../notifications.d.ts";
export type CreateNotificationInput = {
    userId: string;
    type: NotificationType;
    actorId: string;
    actorNickname: string;
    title: string;
    preview: string;
    link: string;
};
export declare function createNotification(client: SupabaseClient, input: CreateNotificationInput): Promise<void>;
export declare function createNotifications(client: SupabaseClient, userIds: readonly string[], input: Omit<CreateNotificationInput, "userId">): Promise<void>;
