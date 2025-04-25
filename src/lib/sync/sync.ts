import type { Tables, TablesInsert } from '@/lib/database.types';

// Structure for data received from the Gmail API
export interface GmailApiEmailData {
    id: string; // Gmail Message ID
    threadId: string; // Gmail Thread ID (used as our primary key 'id')
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

    const supabaseThreadIds = new Set(supabaseEmails.map(e => e.id)); 
    const allLatestGmailThreadIds = gmailEmails.map(g => g.threadId);

    const emailsToUpsert: TablesInsert<'emails'>[] = [];
    const existingGmailThreadIdsInLatestFetch: string[] = [];

    for (const gmailEmail of gmailEmails) {
        if (!supabaseThreadIds.has(gmailEmail.threadId)) {
            // This email thread is new, prepare it for insertion
            emailsToUpsert.push({
                id: gmailEmail.threadId, // Use Gmail Thread ID as primary key
                user_id: userId,
                bucket_id: null, // New emails are unclassified
                subject: gmailEmail.subject,
                sender: gmailEmail.sender,
                preview: gmailEmail.preview,
                // IMPORTANT: Ensure your DB expects ISO 8601 format or adjust parsing
                email_date: gmailEmail.date ? new Date(gmailEmail.date).toISOString() : null,
                last_fetched_at: new Date().toISOString(), // Record sync time
            });
        } else {
            // Email thread already exists in Supabase, track its ID
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