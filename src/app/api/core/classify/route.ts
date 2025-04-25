import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import { NextResponse } from 'next/server';

// --- Configuration ---
const BATCH_SIZE = 15; // Process emails in batches of 10
const DELAY_BETWEEN_REQUESTS_MS = 100; // Wait 100ms between starting new requests

// --- Input Validation ---
// Accept full bucket objects now
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
  console.log("Classify API route hit (Batch Mode with generateObject)");

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

  const { emails, buckets } = requestData; // Use 'buckets' array directly
  const emailChunks = chunkArray(emails, BATCH_SIZE);

  // 2. Initialize OpenRouter Client
  if (!process.env.OPENROUTER_API_KEY) {
      console.error("OPENROUTER_API_KEY environment variable is not set.");
      return NextResponse.json({ error: 'Server configuration error: Missing OpenRouter API key.' }, { status: 500 });
  }
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  // 3. Prepare Static Data for LLM
  // Get bucket names and map for lookup BEFORE formatting the list for the prompt
  const bucketNamesOnly = buckets.map(b => b.name);
  const bucketNameToIdMapLookup = new Map(buckets.map(b => [b.name, b.id]));

  // Create a formatted string for the bucket list including descriptions
  const formattedBucketListWithDesc = buckets.map(b => 
      `${b.name}${b.description ? ` (Description: ${b.description})` : ''}`
  ).join(', ');

  // Use the bucket names for the Enum
  const BucketNameEnum = z.enum(bucketNamesOnly as [string, ...string[]]);
  
  // Use the formatted list with descriptions in the system prompt
  const systemPrompt = `You are an expert email classification assistant. Classify **each** of the provided email threads into one of the available buckets. Use the bucket descriptions provided to help you choose the most appropriate category: ${formattedBucketListWithDesc}. Return an array containing **exactly one** classification object (with 'threadId' and 'bucketName') for **each** email thread ID listed in the user prompt. Ensure the 'threadId' in your output objects matches exactly one of the IDs provided in the prompt for the current batch. Use only the provided bucket names.`;

  // 4. Process Batches
  const classifications: ClassificationResult = {};
  const errors: ClassificationError[] = [];

  for (const batch of emailChunks) {
    const batchThreadIds = batch.map(email => email.threadId);
    console.log(`Processing batch with ${batch.length} emails. IDs: ${batchThreadIds.join(', ')}`);

    // --- Dynamic Schema Definition per Batch ---
    if (batchThreadIds.length === 0) continue;

    const ThreadIdEnum = z.enum(batchThreadIds as [string, ...string[]]);

    const singleClassificationSchema = z.object({
      threadId: ThreadIdEnum.describe('The unique ID of the email thread being classified, must be one of the IDs provided for this batch.'),
      bucketName: BucketNameEnum.describe('The name of the bucket the email should be classified into.'),
    });

    // --- Construct User Prompt for Batch ---
    const formattedEmails = batch.map(email =>
      `Thread ID: ${email.threadId}\nSubject: ${email.subject || 'N/A'}\nSender: ${email.sender || 'N/A'}\nPreview: ${email.preview || 'N/A'}`
    ).join('\n---\n');

    const userPrompt = `Classify the following ${batch.length} email threads. Return an array with exactly ${batch.length} classification objects, one for each of these thread IDs: ${batchThreadIds.join(', ')}.\n\nEmails:\n${formattedEmails}`;

    // --- Call LLM with generateObject and Validate ---
    try {
      const { object: rawResults } = await generateObject({
        model: openrouter('google/gemini-2.5-flash-preview'), // Using specified model
        output: 'array', // Specify array output
        schema: singleClassificationSchema, // Schema for *each element*
        system: systemPrompt,
        prompt: userPrompt,
        // No tools needed here
      });

      // **Strict Validation (Remains largely the same, checks rawResults which is the object) **
      let batchIsValid = false;
      let validationError = 'Unknown validation error';

      if (!Array.isArray(rawResults)) {
          validationError = `LLM result was not an array. Got: ${typeof rawResults}`;
      } else if (rawResults.length !== batch.length) {
          validationError = `LLM returned ${rawResults.length} classifications, but expected exactly ${batch.length}.`;
      } else {
          const resultThreadIds = new Set(rawResults.map(r => r?.threadId));
          const inputThreadIdsSet = new Set(batchThreadIds);

          if (resultThreadIds.size !== rawResults.length) {
              validationError = 'LLM returned duplicate thread IDs in its classification results.';
          } else if (resultThreadIds.size !== inputThreadIdsSet.size) {
              validationError = 'Mismatch between input thread IDs and returned thread IDs count.';
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
                   for(const result of rawResults) {
                       // Additional check: Zod schema handles this, but good to be explicit
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

      if (batchIsValid) {
          console.log(`Batch validation successful for IDs: ${batchThreadIds.join(', ')}`);
          rawResults.forEach(result => {
              // Type assertion is safe here due to validation
              const bucketName = result.bucketName as string;
              const threadId = result.threadId as string;
              const bucketId = bucketNameToIdMapLookup.get(bucketName);

              if (bucketId) {
                  classifications[threadId] = bucketId; // Store bucket ID
              } else {
                  // This case should ideally not happen due to validation, but good to handle
                  console.warn(`Validation passed, but could not find bucket ID for name '${bucketName}' (Thread ID: ${threadId}). Skipping.`);
              }
          });
      } else {
          console.error(`Batch validation failed for IDs ${batchThreadIds.join(', ')}: ${validationError}`);
          errors.push({ batchThreadIds, error: `Validation Failed: ${validationError}` });
      }
      // ** End of Manual Validation Block **
      // Explicit checks (array length, unique/matching IDs, valid buckets) ensure
      // the LLM output strictly adheres to the batch requirements beyond basic schema types.

    } catch (error) {
        // Handle potential NoObjectGeneratedError specifically
        if (NoObjectGeneratedError.isInstance(error)) {
            console.error(`Error processing batch for IDs ${batchThreadIds.join(', ')}: LLM did not generate a valid object.`, error.cause);
            errors.push({ batchThreadIds, error: `LLM did not return a valid classification array. Cause: ${error.cause}` });
        } else {
            console.error(`Error processing batch for IDs ${batchThreadIds.join(', ')}:`, error);
            errors.push({ batchThreadIds, error: `LLM API Error: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // Add a 1-second delay at the end of the batch processing loop
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
  } // End of batch loop

  // 5. Return Aggregated Results
  console.log(`Batch classification complete. Total Success: ${Object.keys(classifications).length}, Batches with Errors: ${errors.length}`);
  return NextResponse.json({ classifications, errors });
}
