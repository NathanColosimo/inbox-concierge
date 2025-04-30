import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tables, Database } from '@/lib/database.types';

type Bucket = Tables<'buckets'>;
type Email = Tables<'emails'>;

// Type for email with joined bucket data
type EmailWithBucket = Email & { buckets: Pick<Bucket, 'name'> | null };

/**
 * Fetches the latest emails (up to 200) for display, joined with bucket names.
 *
 * @param supabase Authenticated Supabase client.
 * @param userId The user's ID.
 * @returns An object containing the emails array and an optional error string.
 */
export async function fetchDisplayEmails(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{ emails: EmailWithBucket[], error: string | null }> {
    try {
        console.log("Fetching final email list for display (up to 200 latest synced)...");
        const { data: finalEmailsData, error: fetchFinalError } = await supabase
            .from('emails')
            .select(`
                *,
                buckets ( name )
            `)
            .eq('user_id', userId)
            .order('email_date', { ascending: false, nullsFirst: false })
            .limit(200);

        if (fetchFinalError) {
            throw new Error(`Failed to fetch emails for display: ${fetchFinalError.message}`);
        }

        // Assign fetched data, ensuring it's an array and casting to the correct type
        const finalEmailsForDisplay = (finalEmailsData as unknown as EmailWithBucket[]) || [];
        console.log(`Fetched ${finalEmailsForDisplay.length} emails from Supabase to display.`);

        return { emails: finalEmailsForDisplay, error: null };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred fetching emails for display.";
        console.error("Error in fetchDisplayEmails:", errorMessage);
        // This error is considered fatal for display purposes
        return { emails: [], error: `Failed to load emails for display: ${errorMessage}` };
    }
} 