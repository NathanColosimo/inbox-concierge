import type { Tables, TablesInsert } from '@/lib/database.types';

// Assuming it matches this structure based on the API route code
export interface GmailApiEmailData {
    id: string; // This is the message ID (less relevant now, but part of the API response)
    threadId: string; // This is the Gmail Thread ID we will store in our 'id' column
    subject: string;
    sender: string;
    preview: string;
    date: string; // Assuming string format from API
}

// Define the type for emails fetched from Supabase for comparison (only need the ID, which is the thread ID)
type SupabaseExistingEmail = Pick<Tables<'emails'>, 'id'>;

interface SyncActions {
    emailsToUpsert: TablesInsert<'emails'>[];
    existingGmailThreadIdsInLatestFetch: string[]; // Thread IDs from Gmail fetch that are already in Supabase
    allLatestGmailThreadIds: string[]; // All thread IDs from the latest Gmail fetch
}

/**
 * Compares emails fetched from Gmail API with existing emails in Supabase
 * and prepares a list of new emails to be inserted.
 * Assumes the 'id' column in the Supabase 'emails' table stores the Gmail thread ID.
 *
 * @param gmailEmails - Array of email data fetched from the.
 * @param supabaseEmails - Array of existing email objects from Supabase (only needs 'id').
 * @param userId - The ID of the current user.
 * @returns An object containing emails to insert and lists of thread IDs.
 */
export function prepareSyncActions(
    gmailEmails: GmailApiEmailData[],
    supabaseEmails: SupabaseExistingEmail[],
    userId: string
): SyncActions {

    const supabaseThreadIds = new Set(supabaseEmails.map(e => e.id)); // Use the 'id' field directly
    const allLatestGmailThreadIds = gmailEmails.map(g => g.threadId);

    const emailsToUpsert: TablesInsert<'emails'>[] = [];
    const existingGmailThreadIdsInLatestFetch: string[] = [];

    for (const gmailEmail of gmailEmails) {
        if (!supabaseThreadIds.has(gmailEmail.threadId)) {
            // This email thread is new, prepare it for insertion
            emailsToUpsert.push({
                id: gmailEmail.threadId, // Set the table's primary key 'id' to the Gmail Thread ID
                user_id: userId,
                bucket_id: null, // Assign null for newly synced/uncategorized emails
                subject: gmailEmail.subject,
                sender: gmailEmail.sender,
                preview: gmailEmail.preview,
                // IMPORTANT: Ensure your DB expects ISO 8601 format or adjust parsing
                email_date: gmailEmail.date ? new Date(gmailEmail.date).toISOString() : null,
                last_fetched_at: new Date().toISOString(), // Mark when it was last synced
                // No gmail_thread_id or gmail_message_id needed anymore
            });
        } else {
            // This email thread already exists in Supabase
            existingGmailThreadIdsInLatestFetch.push(gmailEmail.threadId);
        }
    }

     console.log(`Sync Prep: Found ${emailsToUpsert.length} new email threads to insert.`);
     console.log(`Sync Prep: Found ${existingGmailThreadIdsInLatestFetch.length} existing email threads within the latest 50 fetch.`);

    return {
        emailsToUpsert,
        existingGmailThreadIdsInLatestFetch,
        allLatestGmailThreadIds
    };
} 