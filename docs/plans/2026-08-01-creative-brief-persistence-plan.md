# Creative Brief Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 세계별 승인 창작 브리프와 이력을 저장하고, 다음 방문에서 현재 브리프를 불러와 안전하게 이어 쓰게 한다.

**Architecture:** `creative_briefs` 테이블은 세계와 소유자에 귀속된 불변 이력을 저장한다. 새 브리프 승인 시 기존 현재 항목을 이력으로 전환하고 새 항목을 현재 항목으로 만드는 원자적 RPC를 사용한다. 서버 저장소와 `/api/worlds/[id]/brief` 라우트가 이를 감싸며, React는 저장된 현재 브리프를 로드해 음성 시작 맥락으로 사용한다.

**Tech Stack:** Supabase PostgreSQL/RLS/RPC, Vercel serverless API, Node.js, React/TypeScript, Vitest.

---

### Task 1: Add schema and atomic activation contract

**Files:**
- Modify: `supabase/schema.sql`
- Test: `server.test.mjs`

**Step 1: Write the failing repository test**

Add a repository contract test that expects `saveCreativeBrief(worldId, brief)` to assert ownership and invoke `activate_creative_brief` with an owner id and generated id.

**Step 2: Run test to verify it fails**

Run: `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run server.test.mjs --pool=threads --maxWorkers=1`
Expected: FAIL because `saveCreativeBrief` is missing.

**Step 3: Add minimal SQL schema**

Create `public.creative_briefs` with: id, world_id, owner_id, intent, conflict, tone, required_elements, session_goal, status, created_at. Add an owner-checked `activate_creative_brief` SECURITY DEFINER function that marks an existing active row historical, inserts the new active row, and returns the selected fields. Enable RLS, revoke anon/authenticated access, and grant service_role only.

**Step 4: Run test to verify it passes**

Run the Task 1 command.
Expected: PASS.

**Step 5: Commit**

`git add supabase/schema.sql server.test.mjs server.mjs && git commit -m "feat: persist approved creative briefs"`

### Task 2: Expose current brief through server and Vercel API

**Files:**
- Modify: `server.mjs`
- Create: `api/worlds/[id]/brief.js`
- Test: `api/worlds/[id]/brief.test.mjs`

**Step 1: Write failing API tests**

Test `GET` returns the latest active brief for an owned world and `POST` only accepts an approved brief, then saves it.

**Step 2: Run API tests to verify RED**

Run: `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run api/worlds/[id]/brief.test.mjs --pool=threads --maxWorkers=1`
Expected: FAIL because the route does not exist.

**Step 3: Implement minimal route and server methods**

Add `getCurrentCreativeBrief(worldId)` and `saveCreativeBrief(worldId, brief)`. Require `approved === true` on POST. Return structured API errors through existing `sendApiError`.

**Step 4: Run API tests to verify GREEN**

Run the Task 2 command.
Expected: PASS.

**Step 5: Commit**

`git add server.mjs api/worlds/[id]/brief.js api/worlds/[id]/brief.test.mjs && git commit -m "feat: add creative brief API"`

### Task 3: Load, save, and reuse the brief in the studio

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Step 1: Write failing UI test**

Test opening a saved world loads an active brief, shows `지난 브리프로 이어가기`, and lets the user start only after using that brief. Test approving a new brief for a saved world POSTs it to the world brief endpoint.

**Step 2: Run UI test to verify RED**

Run: `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run src/App.test.tsx --pool=threads --maxWorkers=1`
Expected: FAIL because current brief loading/saving does not exist.

**Step 3: Implement minimal UI wiring**

Fetch the active brief whenever a saved world is selected. Save a newly approved brief when a world id exists; show a non-blocking save status. Keep editing as a deliberate `다시 정리` action and preserve the active brief until a replacement is approved.

**Step 4: Run UI test to verify GREEN**

Run the Task 3 command.
Expected: PASS.

**Step 5: Commit**

`git add src/App.tsx src/App.test.tsx src/styles.css && git commit -m "feat: resume sessions from saved creative briefs"`

### Task 4: Verify integrated behavior

**Files:**
- Verify: `supabase/schema.sql`, `server.mjs`, `api/worlds/[id]/brief.js`, `src/App.tsx`

**Step 1: Run full test suite**

Run: `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1`
Expected: PASS.

**Step 2: Run production build**

Run: `npm run build`
Expected: PASS.

**Step 3: Inspect formatting and working tree**

Run: `git diff --check && git status --short`
Expected: no whitespace errors and only intended files.

**Step 4: Push the verified branch**

Run: `git push origin codex/story-coauthoring`