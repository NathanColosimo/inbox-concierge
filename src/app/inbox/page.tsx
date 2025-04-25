import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import type { Tables } from '@/lib/database.types';
import { prepareSyncActions } from '@/lib/sync/sync';
import { fetchGmailEmails, type GmailApiEmailData } from '@/lib/sync/emails';
import { EmailClassifierButton } from '@/components/EmailClassifierButton';
import { BucketManager } from '@/components/BucketManager';
import { InitialClassifier } from '@/components/InitialClassifier';

// Define types using Supabase generated types
type Bucket = Tables<"buckets">;
// The 'id' field in Email represents the Gmail Thread ID (TEXT)
type Email = Tables<"emails">;

// Type for email with joined bucket data - moved here for broader use
type EmailWithBucket = Email & { buckets: Pick<Bucket, 'name'> | null };

// --- Components ---

function LogoutButton() {
  return (
    <form action="/auth/logout" method="post">
      <Button type="submit">Logout</Button>
    </form>
  );
}

function EmailList({ emails }: { emails: Email[] }) {
  // Ensure emails is always an array
  if (!Array.isArray(emails) || emails.length === 0) {
    return <p className="text-gray-500 italic">No emails in this bucket.</p>;
  }
  return (
    <ul className="space-y-4">
      {emails.map((email) => {
        const emailWithBucket = email as EmailWithBucket;
        const bucketName = emailWithBucket.buckets?.name || 'Uncategorized'; // Access joined bucket name

        return (
          // Use the email's id (which is the Gmail Thread ID) for the React key
          <li key={email.id} className="border rounded-md p-4 shadow-sm dark:border-gray-700">
            <div className="flex justify-between items-start mb-1">
                <p className="font-semibold text-lg">{email.subject || "No Subject"}</p>
                <span className="text-xs font-medium bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {bucketName}
                </span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">From: {email.sender || "Unknown Sender"}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{email.preview || "No Preview"}</p>
            {email.email_date && (
               <p className="text-xs text-gray-400 mt-1">Date: {new Date(email.email_date).toLocaleString()}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Main Page Component ---

export default async function InboxPage() {
  const supabase = await createClient(); // Create client instance once for the page

  // --- Authentication ---
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    console.error("Authentication error or no user found:", userError);
    redirect('/auth/login');
  }
  const userId = user.id;
  console.log(`--- Starting Inbox Load for User: ${userId} ---`);

  // --- State Variables ---
  let pageError: string | null = null;
  let fetchedBuckets: Bucket[] = [];
  let finalEmailsForDisplay: Email[] = [];
  let allLatestGmailThreadIds: string[] = []; // Keep track of IDs fetched from Gmail
  let gmailApiEmails: GmailApiEmailData[] = []; // Declare outside the try block
  let unclassifiedEmailIdsForClient: string[] = []; // IDs for InitialClassifier

  // --- Data Fetching and Syncing ---
  try {
    // --- Step 1: Fetch/Ensure Buckets ---
    console.log("Step 1: Fetching/Ensuring Buckets...");
    try {
      const { data: currentBucketsData, error: fetchBucketsError } = await supabase
        .from('buckets')
        .select('*')
        .eq('user_id', userId);

      if (fetchBucketsError) throw new Error(`Failed to fetch buckets: ${fetchBucketsError.message}`);
      fetchedBuckets = currentBucketsData || [];

      if (fetchedBuckets.length === 0) {
        console.log("No buckets found, creating defaults...");
        // Use a more descriptive set of default buckets
        const defaultNames = ["Urgent & Important", "Read Later", "News & Subscriptions", "Marketing & Offers", "Notifications", "Receipts", "Other"];
        const defaultBucketsToInsert = defaultNames.map(name => ({ user_id: userId, name: name, description: null })); // Add null description explicitly
        const { data: insertedBucketsData, error: insertBucketsError } = await supabase
          .from('buckets')
          .insert(defaultBucketsToInsert)
          .select();
        if (insertBucketsError) throw new Error(`Failed to create default buckets: ${insertBucketsError.message}`);
        fetchedBuckets = insertedBucketsData || [];
        console.log("Default buckets created.");
      } else {
        console.log(`Found ${fetchedBuckets.length} existing buckets.`);
      }
    } catch (error) {
        console.error("Error in Step 1 (Buckets):", error);
        throw new Error(`Failed to load buckets: ${error instanceof Error ? error.message : String(error)}`); // Make bucket errors fatal
    }

    // --- Step 2: Fetch Latest Emails Directly from Gmail ---
    console.log("Step 2: Fetching latest emails directly from Gmail...");
    try {
      gmailApiEmails = await fetchGmailEmails(supabase, 200); // Assign to the outer variable
      console.log(`Fetched ${gmailApiEmails.length} email threads from Gmail API.`);
      allLatestGmailThreadIds = gmailApiEmails.map(g => g.threadId); // Store fetched IDs
    } catch (fetchError) {
      console.error("Error calling fetchGmailEmails:", fetchError);
      if (fetchError instanceof Error && (fetchError.message.includes("token") || fetchError.message.includes("authenticate"))) {
        pageError = `Authentication error: ${fetchError.message}. Please try logging out and back in.`;
      } else {
        pageError = `Error fetching Gmail data: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
      }
      // Don't throw here, allow page to render potentially stale data with an error message
    }

    // Proceed only if Gmail fetch didn't set a fatal error and we have thread IDs
    if (!pageError && allLatestGmailThreadIds.length > 0) {
        // --- Step 3: Fetch Existing Email IDs from Supabase ---
        console.log("Step 3: Fetching existing email thread IDs from Supabase...");
        const { data: existingEmailsData, error: fetchExistingError } = await supabase
        .from('emails')
        .select('id')
        .eq('user_id', userId)
        .in('id', allLatestGmailThreadIds); // Optimization: Only check IDs relevant to the latest fetch

        if (fetchExistingError) {
            throw new Error(`Failed to fetch existing email IDs: ${fetchExistingError.message}`);
        }
        const existingSupabaseEmails: { id: string }[] = existingEmailsData || [];
        console.log(`Found ${existingSupabaseEmails.length} existing email threads in DB among the latest ${allLatestGmailThreadIds.length}.`);

        // --- Step 4: Prepare Sync Actions ---
        console.log("Step 4: Preparing sync actions...");
        const { emailsToUpsert } = prepareSyncActions(
            gmailApiEmails,
            existingSupabaseEmails,
            userId
        );

        // --- Step 5: Upsert Email Threads ---
        if (emailsToUpsert.length > 0) {
            console.log(`Step 5: Upserting ${emailsToUpsert.length} email threads...`);
            // Optional: Add detailed debug logging here if needed
            const { error: upsertError } = await supabase
            .from('emails')
            .upsert(emailsToUpsert, { onConflict: 'id' });

            if (upsertError) {
                console.error("Error upserting emails:", upsertError);
                // Don't make upsert error fatal, but show a message
                pageError = `Failed to save some email data: ${upsertError.message}. Displaying potentially incomplete data.`;
            } else {
                console.log("Successfully upserted email threads.");
            }
        } else {
            console.log("Step 5: No new email threads to upsert.");
        }

        // --- Step 6: Fetch Final Email List for Display ---
        console.log("Step 6: Fetching final email list for display (up to 200 latest synced)...");
        const { data: finalEmailsData, error: fetchFinalError } = await supabase
            .from('emails')
            .select(`*, buckets ( name )`) // Select all email fields and bucket name
            .eq('user_id', userId)
            .order('email_date', { ascending: false, nullsFirst: false })
            .limit(200); // Fetch the latest 200 emails overall from the DB for this user

        if (fetchFinalError) {
            console.error("Error fetching final emails for display:", fetchFinalError);
            throw new Error(`Failed to fetch emails for display: ${fetchFinalError.message}`); // Make this fatal
        }
        // Cast needed due to the join with buckets
        finalEmailsForDisplay = (finalEmailsData as unknown as Email[]) || [];
        console.log(`Fetched ${finalEmailsForDisplay.length} emails from Supabase to display.`);

        // Identify unclassified email IDs for the client component
        unclassifiedEmailIdsForClient = finalEmailsForDisplay
            .filter(email => email.bucket_id === null)
            .map(email => email.id);
        console.log(`Identified ${unclassifiedEmailIdsForClient.length} unclassified email IDs for initial classification.`);

    } else if (!pageError && allLatestGmailThreadIds.length === 0) {
        console.log("Step 6: Skipped final fetch as no emails were retrieved from Gmail.");
        finalEmailsForDisplay = []; // Ensure it's empty
    }

  } catch (err) {
    // Catch fatal errors from steps 1, 3, 6, or re-thrown errors
    console.error("FATAL Error loading inbox page data:", err);
    // Overwrite pageError only if it wasn't previously set by a non-fatal fetch error
    if (!pageError) {
        pageError = err instanceof Error ? err.message : "An unknown error occurred while loading data.";
    }
    // Reset data on fatal error
    fetchedBuckets = [];
    finalEmailsForDisplay = [];
  }

  // --- Prepare Data for Client Component ---
  console.log("--- Preparing data for classification button and initial classifier ---");

  // Map *all* fetched emails to the format needed by the button/dialog AND InitialClassifier
  const allEmailsForClientComponents = finalEmailsForDisplay.map(email => ({
      id: email.id,
      subject: email.subject,
      sender: email.sender,
      preview: email.preview,
      bucket_id: email.bucket_id,
  }));

  // Map buckets to the format needed by the button AND the manager
  // Include description now (it might be null from DB initially)
  const availableBucketsMapped = fetchedBuckets.map(b => ({ 
      id: b.id, 
      name: b.name, 
      description: b.description
  }));

  console.log(`Passing ${allEmailsForClientComponents.length} total fetched emails to client components.`);
  console.log(`Passing ${unclassifiedEmailIdsForClient.length} unclassified IDs to InitialClassifier.`);
  console.log(`Passing ${availableBucketsMapped.length} buckets to manager/classifier.`);

  // --- Debugging: Inspect data before rendering ---
  console.log(`DEBUG: Total finalEmailsForDisplay count: ${finalEmailsForDisplay.length}`);
  const classifiedCount = finalEmailsForDisplay.filter(e => e.bucket_id !== null).length;
  const unclassifiedCount = finalEmailsForDisplay.filter(e => e.bucket_id === null).length;
  console.log(`DEBUG: Classified count: ${classifiedCount}, Unclassified count: ${unclassifiedCount}`);
  const emailBucketIds = new Set(finalEmailsForDisplay.map(e => e.bucket_id).filter(id => id !== null));
  const fetchedBucketIds = new Set(fetchedBuckets.map(b => b.id));
  console.log('DEBUG: Bucket IDs ON emails:', Array.from(emailBucketIds));
  console.log('DEBUG: Bucket IDs IN fetchedBuckets:', Array.from(fetchedBucketIds));
  const missingBucketIds = Array.from(emailBucketIds).filter(id => !fetchedBucketIds.has(id));
  if (missingBucketIds.length > 0) {
      console.warn(`DEBUG: Emails have bucket IDs that are NOT in fetchedBuckets:`, missingBucketIds);
  }
  // --- End Debugging ---

  // --- Rendering ---
  console.log("--- Rendering Inbox Page ----");

  return (
    <div className="flex flex-col items-center w-full p-4 md:p-8">
      <header className="w-full flex justify-between items-center mb-6 pb-4 border-b dark:border-gray-700">
        <h1 className="text-3xl font-bold">Your Inbox</h1>
        <LogoutButton />
      </header>

      {/* --- Main Content Area --- */}
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* --- Left Column (Bucket Manager) --- */}
          <div className="lg:col-span-1">
              <BucketManager 
                  initialBuckets={availableBucketsMapped}
                  userId={userId}
              />
          </div>

          {/* --- Right Column (Classifier Button + Email List) --- */}
          <div className="lg:col-span-3 space-y-8">
              {/* Add the classification button/dialog trigger here */}
              <EmailClassifierButton
                  allFetchedEmails={allEmailsForClientComponents} // Pass mapped emails
                  availableBuckets={availableBucketsMapped} // Pass mapped buckets
                  userId={userId}
              />

              {/* Add the Initial Classifier component here */}
              <InitialClassifier
                   unclassifiedEmailIds={unclassifiedEmailIdsForClient}
                   allEmailsData={allEmailsForClientComponents} // Pass the same full data
                   availableBuckets={availableBucketsMapped}
                   userId={userId}
              />

              {/* Display Page Error */}
              {pageError && (
                  <p className="text-center text-red-500 px-4 py-3 rounded relative bg-red-100 border border-red-400">
                      Error loading page: {pageError}
                  </p>
              )}

              {/* Loading/Empty States */}
              {!pageError && fetchedBuckets.length === 0 && finalEmailsForDisplay.length === 0 && (
                 <p className="text-center text-gray-500">Loading buckets and emails...</p>
              )}
              {!pageError && fetchedBuckets.length > 0 && finalEmailsForDisplay.length === 0 && allLatestGmailThreadIds.length === 0 && !gmailApiEmails.length && (
                   <p className="text-center text-gray-500">No emails found in Gmail or Supabase yet.</p>
              )}
               {!pageError && fetchedBuckets.length > 0 && finalEmailsForDisplay.length === 0 && allLatestGmailThreadIds.length > 0 && (
                   <p className="text-center text-gray-500">Fetched emails from Gmail, but none are available for display after sync. Check DB state or filters.</p>
              )}

              {/* Render Buckets and Emails */}
              {!pageError && fetchedBuckets.map((bucket) => {
                const emailsInBucket = finalEmailsForDisplay.filter(email => email.bucket_id === bucket.id);
                // Add log here to see count per bucket
                console.log(`DEBUG: Rendering bucket '${bucket.name}' (ID: ${bucket.id}) - Emails in this bucket: ${emailsInBucket.length}`);

                // Only render the heading if there are emails *in this specific bucket*
                if (emailsInBucket.length === 0) return null;

                return (
                  <div key={bucket.id}>
                    <h2 className="text-xl font-semibold mb-3 border-b pb-1 dark:border-gray-600">{bucket.name}</h2>
                    <EmailList emails={emailsInBucket} />
                  </div>
                );
              })}
          </div>
      </div>
    </div>
  );
} 