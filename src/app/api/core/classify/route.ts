import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import { NextResponse } from 'next/server';

// --- Configuration ---
const BATCH_SIZE = 10; // Process emails in batches of 10
const RATE_PER_SECOND = 4; // Max batches to START per second
const RATE_LIMIT_DELAY_BUFFER_MS = 100; // Small buffer for the 1-second window

// --- Input Validation ---
// Accept full bucket objects
const classifyRequestSchema = z.object({
  emails: z.array(
    z.object({
      threadId: z.string(),
      subject: z.string().optional().nullable(),
      sender: z.string().optional().nullable(),
      preview: z.string().optional().nullable(),
    }).passthrough()
  ).min(1, "At least one email is required for classification."),
  // Expect an array of bucket objects including their IDs
  buckets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional().nullable(),
    })
  ).min(1, "At least one bucket object (with id and name) is required."),
});

// --- Result Structures ---
// Result maps threadId to bucket *ID*
interface ClassificationResult {
    [threadId: string]: string; // Map threadId to bucketId
}

interface ClassificationError {
    batchThreadIds: string[]; // IDs in the failed batch
    error: string; // Reason for batch failure
}

// --- Helper Functions ---
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// --- API Route Handler ---
export async function POST(request: Request) {
  console.log("Classify API route hit (Parallel Batch Mode with Rate Limiting)");

  // 1. Validate Input
  let requestData;
  try {
    const body = await request.json();
    requestData = classifyRequestSchema.parse(body);
    console.log(`Received ${requestData.emails.length} emails and ${requestData.buckets.length} buckets (with IDs) for batch classification.`);
  } catch (error) {
    console.error("Invalid request body:", error);
    return NextResponse.json({ error: 'Invalid request body', details: error instanceof z.ZodError ? error.errors : String(error) }, { status: 400 });
  }

  const { emails, buckets } = requestData;
  const emailChunks = chunkArray(emails, BATCH_SIZE);
  const totalBatches = emailChunks.length;
  console.log(`Split into ${totalBatches} batches of size ${BATCH_SIZE}.`);

  // 2. Initialize OpenRouter Client
  if (!process.env.OPENROUTER_API_KEY) {
      console.error("OPENROUTER_API_KEY environment variable is not set.");
      return NextResponse.json({ error: 'Server configuration error: Missing OpenRouter API key.' }, { status: 500 });
  }
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  // 3. Prepare Static Data for LLM
  const bucketNamesOnly = buckets.map(b => b.name);
  const bucketNameToIdMapLookup = new Map(buckets.map(b => [b.name, b.id]));
  const formattedBucketListWithDesc = buckets.map(b =>
      `${b.name}${b.description ? ` (Description: ${b.description})` : ''}`
  ).join(', ');
  const BucketNameEnum = z.enum(bucketNamesOnly as [string, ...string[]]);
  const systemPrompt = `You are an expert email classification assistant. Classify **each** of the provided email threads into one of the available buckets. Use the bucket descriptions provided to help you choose the most appropriate category: ${formattedBucketListWithDesc}. Return an array containing **exactly one** classification object (with 'threadId' and 'bucketName') for **each** email thread ID listed in the user prompt. Ensure the 'threadId' in your output objects matches exactly one of the IDs provided in the prompt for the current batch. Use only the provided bucket names.`;

  // --- Helper Function to Process a Single Batch ---
  async function processSingleBatch(
    batch: typeof emails[number][],
    batchIndex: number // For logging/error reporting
  ): Promise<{ classifications: ClassificationResult; errors: ClassificationError[] }> {
    const batchThreadIds = batch.map(email => email.threadId);
    const batchClassifications: ClassificationResult = {};
    const batchErrors: ClassificationError[] = [];

    console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Starting processing for ${batch.length} emails. IDs: ${batchThreadIds.join(', ')}`);

    if (batchThreadIds.length === 0) {
        console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Skipped empty batch.`);
        return { classifications: {}, errors: [] };
    }

    try {
        const ThreadIdEnum = z.enum(batchThreadIds as [string, ...string[]]);
        const singleClassificationSchema = z.object({
            threadId: ThreadIdEnum.describe('The unique ID of the email thread being classified, must be one of the IDs provided for this batch.'),
            bucketName: BucketNameEnum.describe('The name of the bucket the email should be classified into.'),
        });

        const formattedEmails = batch.map(email =>
            `Thread ID: ${email.threadId}\nSubject: ${email.subject || 'N/A'}\nSender: ${email.sender || 'N/A'}\nPreview: ${email.preview || 'N/A'}`
        ).join('\n---\n');

        const userPrompt = `Classify the following ${batch.length} email threads. Return an array with exactly ${batch.length} classification objects, one for each of these thread IDs: ${batchThreadIds.join(', ')}.\n\nEmails:\n${formattedEmails}`;

        const { object: rawResults } = await generateObject({
            model: openrouter('google/gemini-2.5-flash-preview'),
            output: 'array',
            schema: singleClassificationSchema,
            system: systemPrompt,
            prompt: userPrompt,
        });

        // ** Strict Validation **
        let batchIsValid = false;
        let validationError = 'Unknown validation error';

        if (!Array.isArray(rawResults)) {
            validationError = `LLM result was not an array. Got: ${typeof rawResults}`;
        } else if (rawResults.length !== batch.length) {
            validationError = `LLM returned ${rawResults.length} classifications, but expected exactly ${batch.length}.`;
        } else {
            const resultThreadIds = new Set();
            let hasDuplicates = false;
            for (const r of rawResults) {
                if (!r || typeof r.threadId !== 'string') continue; // Skip invalid structures for this check
                if (resultThreadIds.has(r.threadId)) {
                    hasDuplicates = true;
                    break;
                }
                resultThreadIds.add(r.threadId);
            }

            if (hasDuplicates) {
                 validationError = 'LLM returned duplicate thread IDs in its classification results.';
            } else {
                 const inputThreadIdsSet = new Set(batchThreadIds);
                 if (resultThreadIds.size !== inputThreadIdsSet.size) {
                     validationError = `Mismatch between input thread IDs (${inputThreadIdsSet.size}) and valid returned thread IDs (${resultThreadIds.size}) count.`;
                 } else {
                     let allInputIdsPresent = true;
                     for (const inputId of inputThreadIdsSet) {
                         if (!resultThreadIds.has(inputId)) {
                             allInputIdsPresent = false;
                             validationError = `LLM classification result is missing thread ID: ${inputId}`;
                             break;
                         }
                     }
                     if (allInputIdsPresent) {
                         const validBucketNamesSet = new Set(bucketNamesOnly);
                         let invalidBucketFound = false;
                         for (const result of rawResults) {
                             if (!result || typeof result.threadId !== 'string' || typeof result.bucketName !== 'string') {
                                 validationError = `LLM returned an invalid object structure in the array.`;
                                 invalidBucketFound = true;
                                 break;
                             }
                             if (!validBucketNamesSet.has(result.bucketName)) {
                                 validationError = `LLM returned invalid bucket name '${result.bucketName}' for thread ID ${result.threadId}.`;
                                 invalidBucketFound = true;
                                 break;
                             }
                         }
                         if (!invalidBucketFound) {
                             batchIsValid = true; // All checks passed!
                         }
                     }
                 }
            }
        }
         // ** End of Manual Validation Block **

        if (batchIsValid) {
            console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Validation successful.`);
            rawResults.forEach(result => {
                const bucketName = result.bucketName as string;
                const threadId = result.threadId as string;
                const bucketId = bucketNameToIdMapLookup.get(bucketName);
                if (bucketId) {
                    batchClassifications[threadId] = bucketId;
                } else {
                    console.warn(`[Batch ${batchIndex + 1}] Validation passed, but could not find bucket ID for name '${bucketName}' (Thread ID: ${threadId}). Skipping.`);
                    // Optionally add to errors if this should be treated as a failure
                    // batchErrors.push({ batchThreadIds: [threadId], error: `Internal Error: Could not map validated bucket name '${bucketName}' back to an ID.` });
                }
            });
        } else {
            console.error(`[Batch ${batchIndex + 1}/${totalBatches}] Validation failed: ${validationError}`);
            batchErrors.push({ batchThreadIds, error: `Validation Failed: ${validationError}` });
        }

    } catch (error) {
        console.error(`[Batch ${batchIndex + 1}/${totalBatches}] Processing error:`, error);
        if (NoObjectGeneratedError.isInstance(error)) {
             batchErrors.push({ batchThreadIds, error: `LLM did not return a valid classification array. Cause: ${error.cause}` });
        } else {
             batchErrors.push({ batchThreadIds, error: `LLM API Error: ${error instanceof Error ? error.message : String(error)}` });
        }
    }
    console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Finished processing.`);
    return { classifications: batchClassifications, errors: batchErrors };
  }

  // 4. Process Batches with Rate Limiting
  const allPromises: Promise<{ classifications: ClassificationResult; errors: ClassificationError[] }>[] = [];
  let requestCounter = 0;
  let windowStartTime = Date.now();

  console.log(`Starting parallel processing with rate limit: ${RATE_PER_SECOND} req/s`);

  for (let i = 0; i < emailChunks.length; i++) {
    const batch = emailChunks[i];

    // Start the promise, don't await yet
    const promise = processSingleBatch(batch, i);
    allPromises.push(promise);
    requestCounter++;

    // Check if rate limit for the current second is reached
    if (requestCounter >= RATE_PER_SECOND) {
      const elapsedTime = Date.now() - windowStartTime;
      const delayNeeded = Math.max(0, (1000 + RATE_LIMIT_DELAY_BUFFER_MS) - elapsedTime); // Ensure at least 1 sec + buffer has passed

      if (delayNeeded > 0) {
        console.log(`Rate limit hit (${RATE_PER_SECOND} reqs). Waiting ${delayNeeded}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
      }

      // Reset counter and timer for the next window
      requestCounter = 0;
      windowStartTime = Date.now();
    }
  }

  // 5. Wait for all promises to settle and Aggregate Results
  console.log("All batch promises initiated. Waiting for completion...");
  const results = await Promise.allSettled(allPromises);
  console.log("All batches completed processing.");

  const finalClassifications: ClassificationResult = {};
  const finalErrors: ClassificationError[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
        const batchResult = result.value;
        // Merge successful classifications
        Object.assign(finalClassifications, batchResult.classifications);
        // Add errors from this batch (validation errors, etc.)
        finalErrors.push(...batchResult.errors);
    } else {
        // Handle promise rejection (unexpected error during batch processing)
        console.error(`[Batch ${index + 1}/${totalBatches}] Promise rejected:`, result.reason);
        // Try to get original IDs if possible (might require passing batch info with rejection)
        const originalBatchIds = emailChunks[index]?.map(e => e.threadId) || [`Batch Index ${index + 1} Failed`];
        finalErrors.push({
            batchThreadIds: originalBatchIds,
            error: `Batch processing promise rejected: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        });
    }
  });

  // 6. Return Aggregated Results
  console.log(`Parallel classification complete. Total Success: ${Object.keys(finalClassifications).length}, Batches with Errors/Failures: ${finalErrors.length}`);
  return NextResponse.json({ classifications: finalClassifications, errors: finalErrors });
}
