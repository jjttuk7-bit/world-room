# Creative Brief Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a text-first creative brief that authorizes and contextualizes every new voice writing session.

**Architecture:** Keep editable brief state in the client, generate a structured suggestion server-side, persist it with the session/world, and inject only approved fields into the Realtime opening prompt.

**Tech Stack:** React, TypeScript, Vitest, Node.js, OpenAI Responses API, Supabase.

---

### Task 1: Brief models and validation

**Files:** Create `src/brief/models.ts`, `src/brief/models.test.ts`; modify `server.mjs`, `server.test.mjs`.

1. Write failing tests for required intent, five brief fields, and approved-only opening context.
2. Run focused test; observe RED.
3. Implement minimal typed brief validation and structured generation.
4. Run focused tests; observe GREEN.
5. Commit `feat: add creative brief model`.

### Task 2: Persist and expose briefs

**Files:** Modify `supabase/schema.sql`, `server.mjs`, `server.test.mjs`; create `api/briefs.js`.

1. Add failing repository/API tests for owner-scoped create/read brief.
2. Add session/world brief storage and API route.
3. Verify focused server tests.
4. Commit `feat: persist creative briefs`.

### Task 3: Build the text-first brief experience

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`.

1. Add failing tests: voice start disabled before approval; free input; one follow-up question; approved brief enables start.
2. Implement the calm text brief pane and editable five-field summary.
3. Pass approved brief into `sendOpeningGreeting` and retain it in workspace.
4. Run all tests and build.
5. Commit `feat: guide voice sessions with creative briefs`.
