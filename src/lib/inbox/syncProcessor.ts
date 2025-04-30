import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { GmailApiEmailData } from '@/lib/sync/emails';
import { prepareSyncActions } from '@/lib/sync/sync';

/**
 * Processes the synchronization of emails fetched from Gmail with the Supabase database.
 * Fetches existing IDs, prepares upsert actions, and executes the upsert.
 * Handles errors internally and returns them as non-fatal warnings.
 *
 * @param supabase Authenticated Supabase client.
 * @param userId The user's ID.
 * @param gmailApiEmails Array of email data fetched from Gmail.
 * @returns A promise resolving to an array of warning messages (strings).
 */
export async function processEmailSync(
    supabase: SupabaseClient<Database>,
    userId: string,
    gmailApiEmails: GmailApiEmailData[]
): Promise<string[]> {
    const warnings: string[] = [];
    const allLatestGmailThreadIds = gmailApiEmails.map(g => g.threadId);

    if (allLatestGmailThreadIds.length === 0) {
        console.log("Sync Processor: No Gmail emails provided, skipping sync.");
        return warnings; // No warnings if nothing to process
    }

    try {
        // --- Step 3 (Internal): Fetch Existing Email IDs --- //
        console.log("Sync Processor: Fetching existing email thread IDs...");
        const { data: existingEmailsData, error: fetchExistingError } = await supabase
            .from('emails')
            .select('id')
            .eq('user_id', userId)
            .in('id', allLatestGmailThreadIds);

        if (fetchExistingError) {
            const errorMsg = `Failed to fetch existing email IDs: ${fetchExistingError.message}`;
            console.error("Sync Processor Warning:", errorMsg);
            warnings.push(errorMsg);
            // Do not proceed further if we can't check existing emails
            return warnings;
        }

        const existingSupabaseEmails: { id: string }[] = existingEmailsData || [];
        console.log(`Sync Processor: Found ${existingSupabaseEmails.length} existing email threads in DB.`);

        // --- Step 4 (Internal): Prepare Sync Actions --- //
        console.log("Sync Processor: Preparing sync actions...");
        const { emailsToUpsert } = prepareSyncActions(
            gmailApiEmails,
            existingSupabaseEmails,
            userId
        );

        // --- Step 5 (Internal): Upsert Email Threads --- //
        if (emailsToUpsert.length > 0) {
            console.log(`Sync Processor: Upserting ${emailsToUpsert.length} email threads...`);
            const { error: upsertError } = await supabase
                .from('emails')
                .upsert(emailsToUpsert, { onConflict: 'id' });

            if (upsertError) {
                const errorMsg = `Failed to save some email data: ${upsertError.message}`;
                console.error("Sync Processor Warning:", errorMsg);
                warnings.push(errorMsg);
            } else {
                console.log("Sync Processor: Successfully upserted email threads.");
            }
        } else {
            console.log("Sync Processor: No new email threads to upsert.");
        }

    } catch (error) {
        // Catch any unexpected errors during the process
        const errorMsg = `Unexpected sync error: ${error instanceof Error ? error.message : String(error)}`;
        console.error("Sync Processor Error:", errorMsg);
        warnings.push(errorMsg);
    }

    return warnings;
} 