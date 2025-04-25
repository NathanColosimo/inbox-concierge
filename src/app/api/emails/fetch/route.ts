import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { google } from "googleapis";

// Define a type for the email data we want to return
interface EmailData {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  preview: string; // snippet
  date: string;
}

export async function GET() {
  console.log("Fetching emails API route hit"); // Debug log

  try {
    const supabase = await createClient();

    // 1. Get the session and check for authentication
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error("Error getting session:", sessionError);
      return NextResponse.json({ error: "Failed to get user session", details: sessionError.message }, { status: 500 });
    }

    if (!session) {
      console.log("No active session found.");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Log the session structure for debugging (optional, remove in production)
    // console.log("Session data:", JSON.stringify(session, null, 2));

    // 2. Extract the Google provider token
    const providerToken = session.provider_token;

    if (!providerToken) {
        console.error("Provider token not found in session.");
        // Consider prompting for re-authentication or specific scopes if this happens
        return NextResponse.json({ error: "Google provider token not found. Please ensure the correct scopes were granted." }, { status: 403 });
    }

    // 3. Initialize Google API Client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: providerToken });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // 4. Fetch email threads
    console.log("Fetching Gmail threads...");
    const threadListResponse = await gmail.users.threads.list({
      userId: "me",
      maxResults: 50, // Fetching 50 threads for now, adjust as needed
      // labelIds: ['INBOX'], // Optional: Only fetch from INBOX
    });

    const threads = threadListResponse.data.threads;
    if (!threads || threads.length === 0) {
        console.log("No threads found.");
        return NextResponse.json({ emails: [] });
    }
    console.log(`Found ${threads.length} threads.`);

    // 5. Fetch details for each thread
    const emailPromises = threads.map(async (thread) => {
      if (!thread.id) return null;

      try {
        const threadDetails = await gmail.users.threads.get({
          userId: "me",
          id: thread.id,
          format: "metadata", // Request metadata
          metadataHeaders: ["Subject", "From", "Date"], // Specify needed headers
        });

        const message = threadDetails.data.messages?.[0]; // Get the first message for preview/details
        if (!message || !message.id || !message.payload) return null;

        const subjectHeader = message.payload.headers?.find(h => h.name === 'Subject');
        const fromHeader = message.payload.headers?.find(h => h.name === 'From');
        const dateHeader = message.payload.headers?.find(h => h.name === 'Date');

        const emailData: EmailData = {
          id: message.id,
          threadId: thread.id,
          subject: subjectHeader?.value || "No Subject",
          sender: fromHeader?.value || "Unknown Sender",
          preview: message.snippet || "No Preview",
          date: dateHeader?.value || "",
        };
        return emailData;

      } catch (error) {
        console.error(`Error fetching details for thread ${thread.id}:`, error);
        return null; // Skip this thread if there's an error
      }
    });

    const emails = (await Promise.all(emailPromises)).filter(email => email !== null) as EmailData[];
    console.log(`Successfully fetched details for ${emails.length} emails.`);


    // 6. Return the email data
    return NextResponse.json({ emails });

  } catch (error) {
    console.error("Error in /api/emails/fetch:", error);
    let errorMessage = "An unexpected error occurred";
    let statusCode = 500;
    let errorDetails: string | undefined = undefined;

    if (error instanceof Error) {
      errorDetails = error.message;
    }

    // Define a minimal interface for expected Google API error shape
    interface GoogleApiError {
      code?: number;
      message?: string;
      response?: {
        data?: {
          error?: {
            message?: string;
          };
        };
        status?: number;
      };
    }

    // Check if the error matches the expected shape
    if (typeof error === 'object' && error !== null) {
      const potentialError = error as GoogleApiError;

      if (potentialError.code === 401) {
        errorMessage = "Google API authentication failed. Token might be expired or invalid.";
        statusCode = 401;
        errorDetails = potentialError.message || errorDetails;
      } else if (potentialError.response?.data?.error?.message) {
        errorMessage = "Google API Error";
        errorDetails = potentialError.response.data.error.message;
        statusCode = potentialError.response?.status || 500;
      }
    }

    return NextResponse.json({ error: errorMessage, details: errorDetails || String(error) }, { status: statusCode });
  }
} 