'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Tables } from '@/lib/database.types';

// Define the prop types, aligning with data passed from the page
type EmailForClassification = Pick<Tables<'emails'>, 'id' | 'subject' | 'sender' | 'preview'>;
type BucketForApi = Pick<Tables<'buckets'>, 'id' | 'name' | 'description'>;

interface InitialClassifierProps {
  unclassifiedEmailIds: string[]; // IDs of emails with bucket_id = null
  allEmailsData: (EmailForClassification & { bucket_id: string | null })[]; // All emails fetched on page load
  availableBuckets: BucketForApi[];
  userId: string;
}

export function InitialClassifier({
  unclassifiedEmailIds,
  allEmailsData,
  availableBuckets,
  userId,
}: InitialClassifierProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const classifyInitialEmails = async () => {
      // Find the actual email data for the unclassified IDs
      const emailsToClassify = allEmailsData.filter(email =>
        unclassifiedEmailIds.includes(email.id) && email.bucket_id === null
      );

      if (emailsToClassify.length === 0 || availableBuckets.length === 0) {
        // console.log("InitialClassifier: No unclassified emails found or no buckets available.");
        return; // Nothing to do
      }

      console.log(`InitialClassifier: Found ${emailsToClassify.length} unclassified emails to process.`);
      setIsLoading(true);
      setStatusMessage(`Classifying ${emailsToClassify.length} new emails...`);

      try {
        // 1. Call the classification API
        const apiPayload = {
          emails: emailsToClassify.map(e => ({
            threadId: e.id,
            subject: e.subject,
            sender: e.sender,
            preview: e.preview,
          })),
          buckets: availableBuckets,
        };

        const response = await fetch('/api/core/classify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(apiPayload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`API Error (${response.status}): ${errorData.error || response.statusText}`);
        }

        const result = await response.json();
        const { classifications, errors: classificationErrors } = result;

        if (classificationErrors && classificationErrors.length > 0) {
          console.warn("InitialClassifier: Classification API reported errors:", classificationErrors);
          setStatusMessage(`Initial classification finished with errors for ${classificationErrors.length} batch(es).`);
          // Continue processing successful ones
        }

        // 2. Prepare DB Updates
        const dbUpdates: { id: string; bucket_id: string; user_id: string }[] = [];
        if (classifications && Object.keys(classifications).length > 0) {
            for (const [threadId, bucketId] of Object.entries(classifications)) {
                if (typeof threadId === 'string' && typeof bucketId === 'string') {
                   dbUpdates.push({ id: threadId, bucket_id: bucketId, user_id: userId });
                }
            }
        } else {
            console.log("InitialClassifier: No successful classifications returned from API.");
            // Only update status if no errors previously shown
            if (!classificationErrors || classificationErrors.length === 0) {
              setStatusMessage("Initial classification ran, but no emails were assigned buckets.");
            }
            setIsLoading(false);
            return;
        }

        if (dbUpdates.length === 0) {
            console.log("InitialClassifier: No valid updates to send to the database.");
            // Only update status if no errors previously shown
             if (!classificationErrors || classificationErrors.length === 0) {
                setStatusMessage("Initial classification finished, but no valid updates were generated.");
             }
             setIsLoading(false);
            return;
        }

        // 3. Update Database
        console.log(`InitialClassifier: Updating ${dbUpdates.length} emails in the database...`);
        setStatusMessage(`Saving classifications for ${dbUpdates.length} emails...`);

        const supabase = createClient();
        const { error: upsertError } = await supabase
          .from('emails')
          .upsert(dbUpdates, { onConflict: 'id' });

        if (upsertError) {
          console.error("InitialClassifier: Database Upsert Error:", upsertError);
          throw new Error(`Failed to save initial classifications: ${upsertError.message}`);
        }

        console.log(`InitialClassifier: Successfully updated ${dbUpdates.length} emails.`);
        setStatusMessage(classificationErrors?.length > 0
            ? `Initial classification: ${dbUpdates.length} updated, some errors occurred.`
            : `Initial classification complete! ${dbUpdates.length} emails categorized.`
        );

        // 4. Refresh Server Component Data
        startTransition(() => {
          console.log("InitialClassifier: Refreshing page data...");
          router.refresh();
        });

      } catch (error) {
        console.error("Initial classification process failed:", error);
        setStatusMessage(`Error during initial classification: ${error instanceof Error ? error.message : 'An unknown error occurred'}`);
      } finally {
        // Keep the final status message for a bit unless it was just 'no emails'
        if (emailsToClassify.length > 0) {
            setTimeout(() => setIsLoading(false), 3000); // Hide loading indicator after a delay
        } else {
             setIsLoading(false);
        }

      }
    };

    // Check if data is ready before running
    if (unclassifiedEmailIds && allEmailsData && availableBuckets && userId) {
      classifyInitialEmails();
    }

    // Run only once when the necessary props are available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unclassifiedEmailIds, allEmailsData, availableBuckets, userId]);

  // Render a subtle status message while loading/processing
  if (!isLoading && !statusMessage) return null;
  // Don't show if the initial check found nothing to do immediately
  if (!isLoading && statusMessage?.startsWith("Initial classification ran")) return null;

  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 italic text-center my-4">
      {isLoading ? '⏳' : (statusMessage?.includes('Error') || statusMessage?.includes('errors') ? '⚠️' : '✅')}{' '}
      {statusMessage || (isLoading ? 'Checking for new emails to classify...' : '')}
    </div>
  );
} 