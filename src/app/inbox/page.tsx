import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import type { Tables } from '@/lib/database.types';

// Define types using Supabase generated types
type Bucket = Tables<"buckets">;
type Email = Tables<"emails">;

// LogoutButton remains the same, form action works in Server Components
function LogoutButton() {
  return (
    <form action="/auth/logout" method="post">
      <Button type="submit">Logout</Button>
    </form>
  );
}

// EmailList uses the Email (Tables<'emails'>) type now
function EmailList({ emails }: { emails: Email[] }) {
  return (
    <ul className="space-y-4">
      {emails.map((email) => (
        // Key remains email.id (which is the Gmail threadId)
        <li key={email.id} className="border rounded-md p-4 shadow-sm dark:border-gray-700">
          <p className="font-semibold text-lg">{email.subject || "No Subject"}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">From: {email.sender || "Unknown Sender"}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{email.preview || "No Preview"}</p>
          {/* Access email_date directly from the type */}
          {/* <p className="text-xs text-gray-400 mt-1">{email.email_date ? new Date(email.email_date).toLocaleString() : 'No Date'}</p> */}
        </li>
      ))}
    </ul>
  );
}

// The main inbox page component (now a Server Component)
export default async function InboxPage() {
  const supabase = await createClient();

  // Use getUser() for active session validation, crucial for RLS
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  // Log the user ID obtained from getUser()
  console.log("User ID from getUser():", user?.id);

  if (userError || !user) {
    console.error("Error getting authenticated user or no user found:", userError);
    // Redirect to login if not authenticated or error occurs
    redirect('/auth/login');
  }

  const userId = user.id; // Get user ID from the authenticated user object
  let pageError: string | null = null;
  let fetchedBuckets: Bucket[] = [];
  let fetchedEmails: Email[] = [];   // Use Email type alias

  try {
    // --- Default Bucket Handling ---
    console.log("Fetching user buckets...");
    const { data: currentBucketsData, error: fetchBucketsError } = await supabase
      .from('buckets')
      .select('*')
      .eq('user_id', userId);

    if (fetchBucketsError) {
      console.error("Error fetching buckets:", fetchBucketsError);
      throw new Error(`Failed to fetch buckets: ${fetchBucketsError.message}`);
    }

    // Add detailed log here
    console.log("Raw fetched buckets data:", currentBucketsData);
    console.log("Number of buckets fetched:", currentBucketsData?.length ?? 0);

    fetchedBuckets = currentBucketsData || [];

    // Check if NO buckets were found for this user
    if (fetchedBuckets.length === 0) {
      console.log("Condition (fetchedBuckets.length === 0) is TRUE. Creating defaults...");
      const defaultNames = ["Important", "Can wait", "Newsletter", "Uncategorized"];
      const defaultBucketsToInsert = defaultNames.map(name => ({
        user_id: userId,
        name: name
        // is_default can be handled by DB default or omitted if not strictly needed yet
      }));

      const { data: insertedBucketsData, error: insertBucketsError } = await supabase
        .from('buckets')
        .insert(defaultBucketsToInsert)
        .select();

      if (insertBucketsError) {
        console.error("Error inserting default buckets:", insertBucketsError);
        // Don't throw here, maybe page can still load with an error message
        pageError = `Failed to create default buckets: ${insertBucketsError.message}`;
      } else {
        console.log("Default buckets created successfully.");
        fetchedBuckets = insertedBucketsData || []; // Use the newly inserted buckets
      }
    } else {
      console.log(`Found ${fetchedBuckets.length} existing buckets.`);
    }

    // --- Fetch Emails from Supabase (Data Loading Step 3 - Simplified for now) ---
    // TODO: Implement full sync logic (fetch Gmail IDs, compare, fetch new details)
    // For now, just fetch existing emails from Supabase
    console.log("Fetching emails from Supabase...");
    const { data: emailsFromDbData, error: fetchEmailsError } = await supabase
      .from('emails')
      .select('*') // Supabase client infers the type based on '*', matching Tables<'emails'>
      .eq('user_id', userId)
      .order('email_date', { ascending: false, nullsFirst: false }) // Example ordering
      .limit(200);

    if (fetchEmailsError) {
      console.error("Error fetching emails from DB:", fetchEmailsError);
      throw new Error(`Failed to fetch emails: ${fetchEmailsError.message}`);
    }

    // No explicit mapping needed if DB columns match; Supabase client provides typed data
    fetchedEmails = emailsFromDbData || [];

    console.log(`Fetched ${fetchedEmails.length} emails from Supabase.`);

  } catch (err) {
    console.error("Error loading inbox page data:", err);
    pageError = err instanceof Error ? err.message : "An unknown error occurred while loading data.";
    // Reset arrays on major error?
    fetchedBuckets = [];
    fetchedEmails = [];
  }

  // --- Rendering ---
  const unclassifiedBucketId: string | null = fetchedBuckets.find(b => b.name === "Uncategorized")?.id || null;

  return (
    <div className="flex flex-col items-center w-full p-4 md:p-8">
      <header className="w-full flex justify-between items-center mb-6 pb-4 border-b dark:border-gray-700">
        <h1 className="text-3xl font-bold">Your Inbox</h1>
        <LogoutButton />
      </header>

      {/* TODO: Add UI for creating custom buckets here */}

      <div className="w-full max-w-4xl space-y-8">
        {pageError && <p className="text-center text-red-500">Error loading page: {pageError}</p>}

        {!pageError && fetchedBuckets.length === 0 && fetchedEmails.length === 0 && (
           <p className="text-center text-gray-500">No buckets or emails found. Loading defaults...</p> // Initial state before defaults created
        )}

        {!pageError && fetchedBuckets.map((bucket) => {
          // Filter emails for the current bucket
          const emailsInBucket = fetchedEmails.filter(email => email.bucket_id === bucket.id);
          // Skip rendering bucket if it's "Uncategorized" and we handle that separately, or if empty
          if (bucket.name === "Uncategorized" || emailsInBucket.length === 0) {
              return null;
          }
          return (
            <div key={bucket.id}>
              <h2 className="text-xl font-semibold mb-3 border-b pb-1 dark:border-gray-600">{bucket.name}</h2>
              <EmailList emails={emailsInBucket} />
            </div>
          );
        })}

        {/* Section for Uncategorized emails */}
        {!pageError && fetchedEmails.filter(email => email.bucket_id === unclassifiedBucketId || email.bucket_id === null).length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-3 border-b pb-1 dark:border-gray-600">Uncategorized</h2>
              <EmailList emails={fetchedEmails.filter(email => email.bucket_id === unclassifiedBucketId || email.bucket_id === null)} />
            </div>
        )}

        {!pageError && fetchedBuckets.length > 0 && fetchedEmails.length === 0 && (
            <p className="text-center text-gray-500">No emails found in Supabase yet. Emails will appear here after the first sync.</p>
        )}

      </div>
    </div>
  );
} 