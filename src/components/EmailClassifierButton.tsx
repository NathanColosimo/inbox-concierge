'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from "@/components/ui/button";
import type { Tables } from '@/lib/database.types';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Define the expected props
// We only need specific fields from the Email for the API call
type EmailForClassification = Pick<Tables<'emails'>, 'id' | 'subject' | 'sender' | 'preview' | 'bucket_id'>;
type BucketForApi = Pick<Tables<'buckets'>, 'id' | 'name' | 'description'>;

interface EmailClassifierButtonProps {
  allFetchedEmails: EmailForClassification[];
  availableBuckets: BucketForApi[];
  userId: string;
}

export function EmailClassifierButton({ allFetchedEmails, availableBuckets, userId }: EmailClassifierButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false); // Combined loading state
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedBucketIds, setSelectedBucketIds] = useState<Set<string>>(new Set());

  // Determine if any unclassified emails exist
  const hasUnclassified = allFetchedEmails.some(email => email.bucket_id === null);

  // Clear status message when dialog opens/closes
  useEffect(() => {
      setStatusMessage(null);
      // Reset selection when dialog closes
      if (!isDialogOpen) {
          setSelectedBucketIds(new Set());
      }
  }, [isDialogOpen]);

  const handleCheckboxChange = (bucketId: string, checked: boolean | string) => {
    setSelectedBucketIds(prev => {
        const next = new Set(prev);
        if (checked === true) {
            next.add(bucketId);
        } else {
            next.delete(bucketId);
        }
        return next;
    });
  };

  const handleClassification = async () => {
    // Filter emails: include ALL unclassified ones PLUS those from selected buckets
    const emailsToActuallyClassify = allFetchedEmails.filter(email =>
        (email.bucket_id === null) || (email.bucket_id && selectedBucketIds.has(email.bucket_id))
    );

    // Check if there are any emails to classify *after* filtering
    if (emailsToActuallyClassify.length === 0) {
        setStatusMessage("No emails matching the criteria (unclassified or in selected buckets).");
        return;
    }

    if (availableBuckets.length === 0) {
        setStatusMessage("Cannot classify: No buckets available.");
        return;
    }

    setIsLoading(true);
    // Simplified initial status message
    setStatusMessage(`Starting classification for ${emailsToActuallyClassify.length} emails...`);

    try {
      // 1. Call the classification API
      console.log(`Sending ${emailsToActuallyClassify.length} emails for classification...`);
      const apiPayload = {
        emails: emailsToActuallyClassify.map(e => ({ // Map to the structure expected by API
            threadId: e.id, // Map email.id to threadId for the API
            subject: e.subject,
            sender: e.sender,
            preview: e.preview
        })),
        // Pass all available buckets including description
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

      console.log("Classification API Result:", result);
      if (classificationErrors && classificationErrors.length > 0) {
          console.warn("Classification API reported errors:", classificationErrors);
          setStatusMessage(`Classification finished with some errors. Check console. Processing successful updates...`);
      } else {
          // Clear status if no errors and proceeding
          setStatusMessage("Processing successful classifications...");
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
          console.log("No successful classifications returned from API.");
          setStatusMessage(classificationErrors?.length > 0
            ? "Classification finished with errors and no successful updates."
            : "Classification ran, but no emails were assigned new buckets.");
          setIsLoading(false);
          return;
      }

      if (dbUpdates.length === 0) {
         console.log("No valid updates to send to the database.");
         setStatusMessage("Classification finished, but no valid updates were generated.");
         setIsLoading(false);
         return;
      }

      // 3. Update Database
      setStatusMessage(`Updating ${dbUpdates.length} emails in the database...`);
      console.log("Preparing to upsert email classifications:", dbUpdates);

      const supabase = createClient();
      const { error: upsertError } = await supabase
        .from('emails')
        .upsert(dbUpdates, { onConflict: 'id' });

      if (upsertError) {
        console.error("Database Upsert Error:", upsertError);
        throw new Error(`Failed to update email buckets: ${upsertError.message}`);
      }

      console.log(`Successfully updated ${dbUpdates.length} emails.`);
      setStatusMessage(classificationErrors?.length > 0
         ? `Partial success! ${dbUpdates.length} emails updated, but some errors occurred (see console).`
         : `Classification complete! ${dbUpdates.length} emails updated.`
      );

      // 4. Refresh Server Component Data & Close Dialog on Success
      startTransition(() => {
        router.refresh();
        // Don't close immediately, let user see the final message
        // setIsDialogOpen(false); 
        // setSelectedBucketIds(new Set()); // Reset happens in useEffect
      });
      // Add a slight delay before closing to show the success message
      setTimeout(() => {
          setIsDialogOpen(false);
      }, 2000); // Close after 2 seconds

    } catch (error) {
      console.error("Classification process failed:", error);
      setStatusMessage(`Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Determine if the main action button should be enabled
  const canStartClassification = hasUnclassified || selectedBucketIds.size > 0;

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
           variant="outline"
           // Disable if no emails loaded at all
           disabled={allFetchedEmails.length === 0}
        >
            Classify Emails...
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Classify Email Buckets</DialogTitle>
          {/* Simplified Description */}
          <DialogDescription>
             All currently unclassified emails will be included automatically.
             Optionally select existing buckets below to include their emails in the classification run as well.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
           {/* Checkbox list for buckets */}
           <div className="space-y-2">
                <Label>Optionally Include Emails from Buckets:</Label>
                {availableBuckets.length > 0 ? (
                    availableBuckets.map((bucket) => (
                        <div key={bucket.id} className="flex items-center space-x-2">
                            <Checkbox
                                id={bucket.id}
                                checked={selectedBucketIds.has(bucket.id)}
                                onCheckedChange={(checked) => handleCheckboxChange(bucket.id, checked)}
                                disabled={isLoading} // Disable during API call
                            />
                            <Label htmlFor={bucket.id} className="font-normal">
                                {bucket.name}
                            </Label>
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground italic">No buckets available.</p>
                )}
           </div>
            {/* Display status messages inside the dialog */} 
            {statusMessage && <p className="text-sm text-gray-600 dark:text-gray-400 pt-2">{statusMessage}</p>}
        </div>
        <DialogFooter>
           <DialogClose asChild>
               <Button type="button" variant="outline" disabled={isLoading}>
                  Cancel
               </Button>
            </DialogClose>
          <Button
            type="button"
            onClick={handleClassification}
            // Simplified disabled logic
            disabled={isLoading || isPending || !canStartClassification}
            aria-live="polite"
           >
            {/* Simplified button text */}
            {isLoading ? 'Classifying...' : isPending ? 'Refreshing...' : 'Start Classification'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 