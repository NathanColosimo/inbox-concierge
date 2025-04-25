I chose the: **Inbox Concierge.** 

Stack:
- Next JS, Typescript
- Supabase for Auth + DB
- Vercel AI SDK with Openrouter provider, Gemini 2.5 flash non-thinking for classification
- Deployed on vercel: [https://inbox-concierge.vercel.app](https://inbox-concierge.vercel.app/)
- Video of me doing it: https://supercut.video/share/sharpsenders/XMzjM8SCB_VZ-BnVcNHEYU
- The load times can take long sometimes, that is because I purposely lowered batch size + rate limit because this is my test openrouter account with not that many credits, so rate limit is low.

**IMPORTANT:**
- Google oauth is currently in "test" mode, so I have to specify the google accounts allowed to oauth. Currently I have only allowed myself, and 
arman@tenex.co
alex@tenex.co

If you need a different email approved to verify, just let me know.

Instructions:
1. Go to https://inbox-concierge.vercel.app
2. Sign in with google
3. Wait for initial classification

From there, you can
- create new buckets
- delete old buckets
- modify current buckets (add descriptions change name etc)

Press "classify emails" and select which buckets you want to reclassify.
