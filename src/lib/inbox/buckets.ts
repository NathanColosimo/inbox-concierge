import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type Bucket = Database['public']['Tables']['buckets']['Row'];

/**
 * Fetches buckets for a user. If no buckets exist, creates default ones.
 * Returns the fetched or created buckets, or an error message.
 *
 * @param supabase Authenticated Supabase client.
 * @param userId The user's ID.
 * @returns An object containing the buckets array and an optional error string.
 */
export async function fetchAndEnsureBuckets(
    supabase: SupabaseClient<Database>, // Use a more generic client type if Database type causes issues here
    userId: string
): Promise<{ buckets: Bucket[], error: string | null }> {
    let fetchedBuckets: Bucket[] = [];
    try {
        console.log("Fetching buckets for user:", userId);
        const { data: currentBucketsData, error: fetchBucketsError } = await supabase
            .from('buckets')
            .select('*')
            .eq('user_id', userId);

        if (fetchBucketsError) {
            throw new Error(`Failed to fetch buckets: ${fetchBucketsError.message}`);
        }
        fetchedBuckets = currentBucketsData || [];

        if (fetchedBuckets.length === 0) {
            console.log("No buckets found, creating defaults...");
            const defaultNames = ["Urgent & Important", "Read Later", "News & Subscriptions", "Marketing & Offers", "Notifications", "Receipts", "Other"];
            const defaultBucketsToInsert = defaultNames.map(name => ({ user_id: userId, name: name, description: null }));
            const { data: insertedBucketsData, error: insertBucketsError } = await supabase
                .from('buckets')
                .insert(defaultBucketsToInsert)
                .select();
            if (insertBucketsError) {
                throw new Error(`Failed to create default buckets: ${insertBucketsError.message}`);
            }
            fetchedBuckets = insertedBucketsData || [];
            console.log("Default buckets created successfully.");
        } else {
            console.log(`Found ${fetchedBuckets.length} existing buckets.`);
        }
        return { buckets: fetchedBuckets, error: null };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred fetching/creating buckets.";
        console.error("Error in fetchAndEnsureBuckets:", errorMessage);
        return { buckets: [], error: `Failed to load buckets: ${errorMessage}` };
    }
} 