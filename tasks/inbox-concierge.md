# Inbox Concierge Project Overview & Tasks

## Project Goal

Create a web application demonstrating engineering skills. The app will authenticate a user's Gmail account, fetch recent email threads, classify them into buckets using an LLM, display them, and allow users to create custom buckets leading to re-classification.

## Core Technologies

*   **Frontend Framework:** Next.js (v15+ App Router)
*   **Language:** TypeScript
*   **UI Library:** React v19+ (via Next.js) Shadcn/ui
*   **Authentication:** Supabase Auth (with Google Provider via @supabase/ssr)
*   **Database:** Supabase (PostgreSQL)
*   **LLM Integration:** Vercel AI SDK
*   **Gmail API:** Google APIs Node.js Client library
*   **Hosting:** Vercel

## Implementation Plan & Tasks

**Phase 1: Project Setup & Authentication**

*   [x] Initialize Project (`create-next-app`)
*   [x] Set up Git repository (`git init`, initial commit)
*   [x] Install Core Dependencies (`@supabase/ssr`, `googleapis`, `ai`, `@supabase/auth-ui-react`)
*   [x] Set up Supabase Project (on supabase.com)
*   [x] Configure Supabase Google Auth Provider (Client ID, Secret, Scopes)
*   [x] Configure Google Cloud Console Credentials (Project, Gmail API, OAuth Client ID, Redirect URIs, JS Origins)
*   [x] Set up Environment Variables (`.env.local` with Supabase URL/Anon Key)
*   [x] Define Database Schema (`buckets` table)
*   [x] Implement Authentication Flow (Frontend: Supabase client setup, Login/Logout UI, Route protection)
*   [x] Ensure correct Gmail Scopes requested & handled

**Phase 2: Gmail Integration & Initial Display**

*   [x] Create Backend API Function (`/lib/sync/emails.ts`)
    *   [x] Get authenticated user & Google token from Supabase session
    *   [x] Initialize Gmail API client
    *   [x] Fetch recent thread IDs (`gmail.users.threads.list`)
    *   [x] Fetch thread metadata/snippet (`gmail.users.threads.get`)
    *   [x] Return thread list (Subject, Preview, Sender, ID) as JSON
    *   [x] Handle API errors
*   [x] Develop Frontend Display
    *   [x] Fetch gmail data from on authenticated page load
    *   [x] Implement loading state
    *   [x] Display fetched emails (initially with `bucket_id = null`)

**Phase 3: LLM Classification Pipeline**

*   [x] Set up Vercel AI SDK & LLM Provider API Key (Environment Variable)
*   [x] Define Default Buckets (Hardcoded list)
*   [x] Create Classification API Route (`/api/core/classify`)
    *   [x] Accept email data and bucket list (Updated to use bucket {id, name})
    *   [x] Design LLM prompt for classification
    *   [x] Use Vercel AI SDK (`generateObject`) to classify emails
    *   [x] Parse LLM responses
    *   [x] Return emails with assigned bucket names (Updated to return bucket IDs)
*   [x] Integrate Classification into Frontend
    *   [x] User triggers classification via button/dialog (Changed from automatic on load)
    *   [x] Update emails in DB via client-side call after API response
    *   [x] Refresh server component data to show updated buckets

**Phase 4: Custom Buckets & Re-classification**

*   [-] Implement Custom Bucket Management API Routes (Superseded by client-side component)
    *   [-] `POST /api/buckets` (Create new bucket in DB) - Handled by client component
    *   [-] `GET /api/buckets` (Fetch user's buckets from DB) - Handled by initial server load + refresh
*   [x] Develop Custom Bucket UI (Client Component: `BucketManager`)
    *   [x] Inline form for create/edit (name, description)
    *   [x] Client-side Supabase calls for create/update
    *   [x] Display list of custom buckets with edit capability (Inline Edit)
*   [ ] Implement Re-classification Logic
    *   [ ] Trigger re-classification on new bucket creation
    *   [ ] Fetch updated bucket list
    *   [ ] Re-run classification (`/api/emails/classify` with new bucket list)
    *   [ ] Update frontend with re-classified emails

**Phase 5: Refinement & Deployment**

*   [ ] UI/UX Improvements (Loading states, error handling, styling, responsiveness)
*   [ ] Code Quality (Typing, comments, structure)

**Key Challenges:**

*   LLM Cost/Speed
*   LLM Accuracy & Prompt Engineering
*   API Rate Limits (Google, LLM)
*   OAuth Token Management (Rely on Supabase)
*   Security (Environment Variables) 