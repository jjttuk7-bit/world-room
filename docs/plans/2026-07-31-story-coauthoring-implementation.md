# Story Coauthoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn voice worldbuilding conversations into reviewable scene drafts and an approved, persistent story manuscript.

**Architecture:** Keep Realtime event reduction in the browser, add explicit draft/scene domain models, and call server-side Responses API endpoints for prose generation. Persist only drafts and accepted scenes in Supabase, while the client owns temporary selection and request state.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Node.js HTTP server, OpenAI Responses API, Supabase.

---

### Task 1: Define story models and pure client state helpers

**Files:**
- Create: `src/story/models.ts`
- Create: `src/story/models.test.ts`
- Modify: `src/App.tsx`

**Step 1:** Write failing tests for `StoryDraft` state transitions (`proposed` → `held`/`accepted`, revision creates a new draft) and `StoryScene` ordering.

**Step 2:** Run `npm test -- src/story/models.test.ts` and confirm failure because the module does not exist.

**Step 3:** Add typed draft, scene, request, and status models plus pure `holdDraft`, `acceptDraft`, and `createRevision` helpers. Keep accepted scenes immutable.

**Step 4:** Re-run the focused test and confirm it passes.

**Step 5:** Commit: `git add src/story/models.ts src/story/models.test.ts && git commit -m "feat: add story draft state models"`.

### Task 2: Add Supabase schema and repository persistence

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `server.mjs`
- Modify: `server.test.mjs`

**Step 1:** Write failing server tests asserting draft insertion, accepted-scene insertion, revision linkage, and position assignment per world.

**Step 2:** Run `npm test -- server.test.mjs` and confirm the new assertions fail.

**Step 3:** Add `story_drafts` and `story_scenes` tables with `world_id` foreign keys, draft status constraints, revision parent id, timestamps, and world/position indexes. Add repository methods to create/update drafts, accept a draft atomically in the application flow, and list story data for a world.

**Step 4:** Re-run `npm test -- server.test.mjs` and confirm it passes.

**Step 5:** Commit: `git add supabase/schema.sql server.mjs server.test.mjs && git commit -m "feat: persist story drafts and scenes"`.

### Task 3: Add server-side story drafting API

**Files:**
- Modify: `server.mjs`
- Create: `api/story/drafts.js`
- Create: `api/story/drafts/[id]/accept.js`
- Create: `api/story/drafts/[id]/revise.js`
- Create: `api/worlds/[id]/story.js`
- Modify: `server.test.mjs`

**Step 1:** Add failing tests for input validation: a draft request needs `worldId`, recent transcript, and world context; blank revision feedback must be rejected.

**Step 2:** Run `npm test -- server.test.mjs` and confirm failure.

**Step 3:** Implement a structured Responses API request that returns title, 3–6 sentence body, source canon references, and a short rationale. Use the existing server-only API key and safety identifier. Expose matching local routes and small Vercel adapters; do not expose secrets to the client.

**Step 4:** Implement acceptance/revision/list endpoints and explicit JSON errors for unavailable API credentials, invalid state, and repository failures.

**Step 5:** Re-run focused server tests, then commit: `git add server.mjs server.test.mjs api && git commit -m "feat: add story drafting endpoints"`.

### Task 4: Build the coauthoring workspace UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/App.test.tsx`

**Step 1:** Write failing UI tests for draft visibility, disabled generation without story context, and accept/hold actions updating the manuscript region.

**Step 2:** Run `npm test -- src/App.test.tsx` and confirm failure.

**Step 3:** Add the four regions from the approved design: transcript, world-design sparks, scene drafts, and manuscript. Show a clear lifecycle badge and buttons for generate, accept, revise, hold, and retry. Make network requests resilient to loading and error states.

**Step 4:** Re-run UI tests and confirm pass.

**Step 5:** Commit: `git add src/App.tsx src/styles.css src/App.test.tsx && git commit -m "feat: add story coauthoring workspace"`.

### Task 5: Connect automatic suggestions without excessive calls

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/realtime/events.ts`
- Modify: `src/realtime/events.test.ts`
- Modify: `src/App.test.tsx`

**Step 1:** Write failing tests for identifying new meaningful spark sets and preventing duplicate automatic requests.

**Step 2:** Run `npm test -- src/realtime/events.test.ts src/App.test.tsx` and confirm failure.

**Step 3:** Add a pure eligibility helper keyed by deduplicated sparks and a manual fallback button. Trigger automatic draft generation only after new meaningful context, never while a generation request is pending.

**Step 4:** Re-run focused tests and confirm pass.

**Step 5:** Commit: `git add src/App.tsx src/realtime/events.ts src/realtime/events.test.ts src/App.test.tsx && git commit -m "feat: suggest scenes from worldbuilding signals"`.

### Task 6: Update documentation and verify end to end

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (only if a new documented configuration value is required)

**Step 1:** Document the draft/approval workflow, schema migration requirement, API routes, and manual microphone test.

**Step 2:** Run `npm test` and confirm all tests pass.

**Step 3:** Run `npm run build` and confirm TypeScript compilation and production build pass.

**Step 4:** Manually test: start voice session → create a new spark → generate draft → hold/revise/accept → save/reload world → confirm accepted scene order.

**Step 5:** Commit: `git add README.md .env.example && git commit -m "docs: explain story coauthoring workflow"`.
