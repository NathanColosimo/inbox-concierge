import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import type { Tables } from '@/lib/database.types';
import { fetchGmailEmails, type GmailApiEmailData } from '@/lib/sync/emails';
import { EmailClassifierButton } from '@/components/EmailClassifierButton';
import { BucketManager } from '@/components/BucketManager';
import { InitialClassifier } from '@/components/InitialClassifier';
import { fetchAndEnsureBuckets } from '@/lib/inbox/buckets';
import { processEmailSync } from '@/lib/inbox/syncProcessor';
import { fetchDisplayEmails } from '@/lib/inbox/displayEmails';

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

function EmailList({ emails }: { emails: EmailWithBucket[] }) {
  if (!Array.isArray(emails) || emails.length === 0) {
    return <p className="text-gray-500 italic">No emails found.</p>;
  }
  return (
    <ul className="space-y-4">
      {emails.map((email) => {
        const bucketName = email.buckets?.name || 'Uncategorized';
        return (
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
  let syncWarnings: string[] = [];
  let fetchedBuckets: Bucket[] = [];
  let finalEmailsForDisplay: EmailWithBucket[] = [];
  let unclassifiedEmailIdsForClient: string[] = [];

  try {
    // --- Step 1: Fetch/Ensure Buckets ---
    const bucketResult = await fetchAndEnsureBuckets(supabase, userId);
    fetchedBuckets = bucketResult.buckets;
    if (bucketResult.error) {
      // Bucket errors are fatal for loading
      throw new Error(bucketResult.error);
    }

    // --- Step 2: Fetch Latest Emails from Gmail ---
    let gmailApiEmails: GmailApiEmailData[] = [];
    try {
      gmailApiEmails = await fetchGmailEmails(supabase, 200);
    } catch (fetchError) {
      console.error("Error calling fetchGmailEmails:", fetchError);
      // Set pageError but continue to display stale data
      if (fetchError instanceof Error && (fetchError.message.includes("token") || fetchError.message.includes("authenticate"))) {
        pageError = `Authentication error fetching emails: ${fetchError.message}. Displaying stored data. Please try logging out and back in if issues persist.`;
      } else {
        pageError = `Error fetching Gmail data: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}. Displaying stored data.`;
      }
    }

    // --- Step 3-5: Process Email Sync (if Gmail fetch was successful) ---
    if (gmailApiEmails.length > 0) {
      syncWarnings = await processEmailSync(supabase, userId, gmailApiEmails);
      if (syncWarnings.length > 0) {
          // Combine sync warnings with existing pageError
          const warningsString = `Sync Warnings: ${syncWarnings.join('; ')}`;
          pageError = pageError ? `${pageError}; ${warningsString}` : warningsString;
      }
    }

    // --- Step 6: Fetch Final Email List for Display ---
    const displayResult = await fetchDisplayEmails(supabase, userId);
    finalEmailsForDisplay = displayResult.emails;
    if (displayResult.error) {
        // This error is fatal for display
        throw new Error(displayResult.error);
    }

    // --- Identify Unclassified Emails for Client ---
    unclassifiedEmailIdsForClient = finalEmailsForDisplay
      .filter(email => email.bucket_id === null)
      .map(email => email.id);
    console.log(`Identified ${unclassifiedEmailIdsForClient.length} unclassified email IDs.`);

  } catch (err) {
    // Catch fatal errors from Step 1 (Buckets), Step 6 (Final Fetch), or auth check
    console.error("FATAL Error loading inbox page data:", err);
    if (!pageError) {
        pageError = err instanceof Error ? err.message : "An unknown error occurred while loading critical data.";
    }
    // Ensure data is reset on fatal error
    fetchedBuckets = [];
    finalEmailsForDisplay = [];
    unclassifiedEmailIdsForClient = [];
  }

  // --- Prepare Data for Client Component ---
  console.log("--- Preparing data for client components ---");
  const allEmailsForClientComponents = finalEmailsForDisplay.map(email => ({
      id: email.id,
      subject: email.subject,
      sender: email.sender,
      preview: email.preview,
      bucket_id: email.bucket_id,
  }));

  const availableBucketsMapped = fetchedBuckets.map(b => ({
      id: b.id,
      name: b.name,
      description: b.description
  }));

  console.log(`Passing ${allEmailsForClientComponents.length} emails and ${availableBucketsMapped.length} buckets to client components.`);

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
              {/* Classifier Buttons/Triggers */}
              <EmailClassifierButton
                  allFetchedEmails={allEmailsForClientComponents}
                  availableBuckets={availableBucketsMapped}
                  userId={userId}
              />
              <InitialClassifier
                   unclassifiedEmailIds={unclassifiedEmailIdsForClient}
                   allEmailsData={allEmailsForClientComponents}
                   availableBuckets={availableBucketsMapped}
                   userId={userId}
              />

              {/* Display Page Error/Warnings */}
              {pageError && (
                  <p className="text-center text-red-500 px-4 py-3 rounded relative bg-red-100 border border-red-400">
                      Notice: {pageError}
                  </p>
              )}

              {/* Loading/Empty States - Adjust based on finalEmailsForDisplay */}
              {!pageError && fetchedBuckets.length > 0 && finalEmailsForDisplay.length === 0 && (
                   <p className="text-center text-gray-500">No emails found to display.</p>
              )}
              {!pageError && fetchedBuckets.length === 0 && finalEmailsForDisplay.length === 0 && (
                  <p className="text-center text-gray-500">Loading data...</p>
              )}

              {/* Render Buckets and Emails */}
              {fetchedBuckets.map((bucket) => {
                const emailsInBucket = finalEmailsForDisplay.filter(email => email.bucket_id === bucket.id);
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