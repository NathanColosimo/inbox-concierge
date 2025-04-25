import type { SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import type { Database } from '@/lib/database.types';

// Re-export or define the structure for the fetched email data
// Matches the structure previously used in sync.ts and the API route
export interface GmailApiEmailData {
    id: string; // Message ID from the specific message used for details
    threadId: string; // Gmail Thread ID (used as primary key in our DB)
    subject: string;
    sender: string;
    preview: string;
    date: string; // Date string from Gmail header
}

/**
 * Fetches the latest email threads from Gmail using the authenticated user's token.
 *
 * @param supabase - An authenticated Supabase client instance (server-side).
 * @param maxResults - The maximum number of threads to fetch (default: 50).
 * @returns A promise that resolves to an array of GmailApiEmailData.
 * @throws An error if authentication fails, the provider token is missing, or a Gmail API error occurs.
 */
export async function fetchGmailEmails(
    supabase: SupabaseClient<Database>,
    maxResults: number = 100
): Promise<GmailApiEmailData[]> {
    console.log("Executing fetchGmailEmails function...");

    // 1. Get the session and provider token
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
        console.error("Error getting session in fetchGmailEmails:", sessionError);
        throw new Error(`Failed to get user session: ${sessionError.message}`);
    }

    if (!session) {
        console.log("No active session found in fetchGmailEmails.");
        throw new Error("Not authenticated");
    }

    const providerToken = session.provider_token;
    if (!providerToken) {
        console.error("Provider token not found in session in fetchGmailEmails.");
        throw new Error("Google provider token not found. Please ensure the correct scopes were granted or re-authenticate.");
    }
    console.log("Successfully retrieved provider token.");

    // 2. Initialize Google API Client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: providerToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // 3. Fetch email thread IDs
    console.log(`Fetching up to ${maxResults} Gmail thread IDs...`);
    let threadListResponse;
    try {
        threadListResponse = await gmail.users.threads.list({
            userId: "me",
            maxResults: maxResults,
            // labelIds: ['INBOX'], // Optional
        });
    } catch (error) {
        console.error("Error fetching Gmail thread list:", error);
        // Handle potential token expiration/revocation specifically
        if (error instanceof Error && (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked'))) {
             throw new Error("Google token is invalid or expired. Please re-authenticate.");
        }
        throw new Error(`Google API error fetching thread list: ${error instanceof Error ? error.message : String(error)}`);
    }


    const threads = threadListResponse?.data?.threads;
    if (!threads || threads.length === 0) {
        console.log("No threads found in Gmail inbox.");
        return [];
    }
    console.log(`Found ${threads.length} threads.`);

    // 4. Fetch details for each thread
    console.log("Fetching details for each thread...");
    const emailPromises = threads.map(async (thread) => {
        if (!thread.id) return null;

        try {
            const threadDetails = await gmail.users.threads.get({
                userId: "me",
                id: thread.id,
                format: "metadata",
                metadataHeaders: ["Subject", "From", "Date"],
            });

            const message = threadDetails.data.messages?.[0];
            if (!message || !message.id || !message.payload) return null;

            const subjectHeader = message.payload.headers?.find(h => h.name === 'Subject');
            const fromHeader = message.payload.headers?.find(h => h.name === 'From');
            const dateHeader = message.payload.headers?.find(h => h.name === 'Date');

            const emailData: GmailApiEmailData = {
                id: message.id, // Store the message ID for context
                threadId: thread.id, // The crucial thread ID
                subject: subjectHeader?.value || "No Subject",
                sender: fromHeader?.value || "Unknown Sender",
                preview: message.snippet || "No Preview",
                date: dateHeader?.value || "",
            };
            return emailData;

        } catch (error) {
            console.error(`Error fetching details for thread ${thread.id}:`, error);
            // Don't let one failed thread stop others, but log it.
            return null;
        }
    });

    const emails = (await Promise.all(emailPromises)).filter(email => email !== null) as GmailApiEmailData[];
    console.log(`Successfully fetched details for ${emails.length} email threads.`);

    return emails;
} 