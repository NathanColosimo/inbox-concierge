'use client'; // Convert to Client Component

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
// Removed server-side imports: createClient, cookies, redirect

// Define the EmailData type (should match the API route's type)
interface EmailData {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  preview: string;
  date: string;
}

// Component to handle Logout
function LogoutButton() {
  return (
    <form action="/auth/logout" method="post">
      <Button type="submit">Logout</Button>
    </form>
  );
}

// Updated Component to display fetched emails
function EmailList({ emails }: { emails: EmailData[] }) { // Use EmailData type
  return (
    <ul className="space-y-4">
      {emails.map((email) => (
        <li key={email.id} className="border rounded-md p-4 shadow-sm">
          <p className="font-semibold text-lg">{email.subject}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">From: {email.sender}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{email.preview}</p>
          {/* Optional: Display date */}
          {/* <p className="text-xs text-gray-400 mt-1">{new Date(email.date).toLocaleString()}</p> */}
        </li>
      ))}
    </ul>
  );
}

// The main inbox page component (now a Client Component)
export default function InboxPage() {
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch emails on component mount
  useEffect(() => {
    const fetchEmails = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/emails/fetch');
        if (!response.ok) {
          const errorData = await response.json();
          console.error("API Error Response:", errorData); // Log the full error data
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setEmails(data.emails || []);
      } catch (err) {
        console.error("Failed to fetch emails:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmails();
  }, []); // Empty dependency array ensures this runs only once on mount

  // Removed server-side session check - middleware handles protection

  return (
    <div className="flex flex-col items-center w-full p-4 md:p-8">
      <header className="w-full flex justify-between items-center mb-6 pb-4 border-b">
        <h1 className="text-3xl font-bold">Your Inbox</h1>
        <LogoutButton />
      </header>

      <div className="w-full max-w-4xl">
        {isLoading && <p className="text-center text-gray-500">Loading emails...</p>}
        {error && <p className="text-center text-red-500">Error loading emails: {error}</p>}
        {!isLoading && !error && emails.length === 0 && (
          <p className="text-center text-gray-500">No emails found.</p>
        )}
        {!isLoading && !error && emails.length > 0 && (
          <EmailList emails={emails} />
        )}
        {/* Add bucket UI later */}
      </div>
    </div>
  );
} 