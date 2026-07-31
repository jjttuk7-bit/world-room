# Writer Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dashboard-like World Room screen with a private, writer-focused studio that turns conversations into traceable scene drafts, a manuscript, and a persistent world bible.

**Architecture:** Reuse the existing Realtime transcript and Spark extraction, then layer a focused three-mode client shell over the story-draft domain model. Persist drafts, scenes, and source references server-side; surface a single primary creative action per mode and keep supporting controls behind overlays or panels.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Node.js HTTP server, OpenAI Responses API, Supabase, CSS.

---

### Task 1: Stabilize the story draft domain model

**Files:**
- Modify: `src/story/models.ts`
- Modify: `src/story/models.test.ts`

**Step 1:** Run `npm test -- src/story/models.test.ts --run` to capture the existing baseline.

**Step 2:** Add any missing model fields required by the writer studio: source transcript ids, related canon ids, title, body, created timestamp, and revision relationship.

**Step 3:** Add failing tests for immutable source-reference preservation through hold, revision, and acceptance.

**Step 4:** Implement only the model changes required for the failing tests and rerun the focused suite.

**Step 5:** Commit with `git add src/story && git commit -m "feat: track story draft sources"`.

### Task 2: Persist private drafts, scenes, and source references

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `server.mjs`
- Modify: `server.test.mjs`

**Step 1:** Write failing repository tests for creating a draft, revising it, accepting it as the next scene, and reading a world manuscript with ordered scenes.

**Step 2:** Run `npm test -- server.test.mjs --run` and confirm the new tests fail.

**Step 3:** Add `story_drafts`, `story_scenes`, and source-reference columns/tables with world-scoped foreign keys, status constraints, ordering index, and cascaded deletion through the private `worlds` record.

**Step 4:** Add repository methods that scope every read/write by `world_id`, insert a draft, create a revision, accept once, and list manuscript data. Preserve source references.

**Step 5:** Re-run focused tests and commit: `git add supabase/schema.sql server.mjs server.test.mjs && git commit -m "feat: persist private story workspace"`.

### Task 3: Add draft generation and manuscript API routes

**Files:**
- Modify: `server.mjs`
- Modify: `api/worlds/[id].js`
- Create: `api/worlds/[id]/story.js`
- Create: `api/story/drafts.js`
- Create: `api/story/drafts/[id]/accept.js`
- Create: `api/story/drafts/[id]/revise.js`
- Modify: `server.test.mjs`

**Step 1:** Add failing tests for validation and structured generation output (title, 3–6 sentence body, canon references, source transcript ids).

**Step 2:** Implement a server-only Responses API call that receives only relevant, bounded transcript and canon context, returns JSON, and never exposes service-role or OpenAI secrets.

**Step 3:** Implement list/create/revise/accept endpoints and consistent recoverable error JSON.

**Step 4:** Re-run focused server tests and commit: `git add server.mjs server.test.mjs api && git commit -m "feat: add writer studio story api"`.

### Task 4: Build the focused three-mode client shell

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Step 1:** Write failing UI tests for mode navigation, removal of the permanent seed form from the home canvas, and a visible primary start action.

**Step 2:** Implement `대화`, `원고`, `세계 성경` navigation and a compact world identity header. Move new-world setup into a dialog/overlay opened by a single action.

**Step 3:** Render transcript as the default canvas. Defer recent worlds, technical guide, validation list, and advanced controls into contextual panels.

**Step 4:** Re-run focused UI tests and commit: `git add src/App.tsx src/App.test.tsx src/styles.css && git commit -m "feat: add focused writer studio shell"`.

### Task 5: Integrate scene draft review into the conversation canvas

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Step 1:** Add failing UI tests for generated-draft visibility, source-context link, loading/error state, and accept/hold/revise actions.

**Step 2:** Wire client requests to the draft endpoints. Require meaningful context, prevent duplicate pending generation, and keep the generated draft compact and dismissible.

**Step 3:** Turn low-level failures into action-oriented Korean messages that state whether token issuance, story generation, or saving failed.

**Step 4:** Re-run focused UI tests and commit: `git add src/App.tsx src/App.test.tsx src/styles.css && git commit -m "feat: review story drafts in conversation"`.

### Task 6: Build manuscript and world-bible views

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Step 1:** Add failing tests for ordered accepted scenes, empty states, source link visibility, and canon categories/status display.

**Step 2:** Implement manuscript rendering with scene metadata, source links, and an edit affordance. Implement grouped world-bible rendering using existing sparks/canon data, including proposed versus confirmed state.

**Step 3:** Re-run focused tests and commit: `git add src/App.tsx src/App.test.tsx src/styles.css && git commit -m "feat: add manuscript and world bible views"`.

### Task 7: Document and verify the launch path

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new configuration variable is introduced

**Step 1:** Document the private-by-default model, Supabase migration, draft lifecycle, and production troubleshooting for token, generation, and storage failures.

**Step 2:** Run `npm test`; confirm every suite passes.

**Step 3:** Run `npm run build`; confirm TypeScript compilation and production build pass.

**Step 4:** Manually verify: create world → voice/text conversation → generate a draft → hold/revise/accept → reload → review manuscript and world bible → start a new session using saved context.

**Step 5:** Commit: `git add README.md .env.example && git commit -m "docs: describe private writer studio"`.
