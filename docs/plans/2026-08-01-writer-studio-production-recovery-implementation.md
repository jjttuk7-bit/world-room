# Writer Studio Production Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the writer-studio branch enforce approved creative briefs from Realtime session creation and retain both user and companion speech in the saved transcript.

**Architecture:** The client posts its approved brief to the token endpoint, which validates it and passes composed brief-first instructions to the Realtime client-secret request. The event reducer recognizes OpenAI output-audio transcript events as companion speech, keeping the UI and saved session transcript bidirectional.

**Tech Stack:** React 19, TypeScript, Node.js serverless functions, OpenAI Realtime WebRTC, Vitest, Vite, Vercel.

---

### Task 1: Make the token endpoint brief-aware

**Files:**
- Modify: `server.mjs:93-135,978-987`
- Modify: `api/token.js:3-16`
- Test: `brief.server.test.mjs`, `server.test.mjs`

**Step 1: Write the failing tests**

Add a server test that passes an approved brief to `createClientSecret` and asserts the outgoing `session.instructions` contains the brief intent, conflict, tone, required elements, session goal, and conflict-confirmation rule. Add a route test proving `POST /api/token` rejects an unapproved brief and accepts an approved brief.

```js
expect(requestBody.session.instructions).toContain("승인된 창작 브리프를 최우선으로 따른다");
expect(requestBody.session.instructions).toContain("기억을 잃은 잠수사의 귀환");
expect(requestBody.session.instructions).toContain("충돌하면 사용자 확인을 요청한다");
```

**Step 2: Run the focused tests to verify RED**

Run: `npm test -- brief.server.test.mjs server.test.mjs`

Expected: FAIL because the token API accepts only GET and `createClientSecret` has fixed instructions.

**Step 3: Implement the minimum secure path**

- Export a `buildBriefFirstRealtimeInstructions(brief)` helper in `server.mjs`.
- Validate the supplied brief with the existing brief model; reject missing or unapproved briefs with HTTP 400.
- Extend `createClientSecret(brief)` to use the composed instructions.
- Change `api/token.js` to accept `POST`, parse JSON with `readRequestJson`, and pass the approved brief.
- Retain `GET` only as a development compatibility path with no brief; production UI must use POST.

**Step 4: Run focused tests to verify GREEN**

Run: `npm test -- brief.server.test.mjs server.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add server.mjs api/token.js brief.server.test.mjs server.test.mjs
git commit -m "Enforce approved briefs in realtime sessions"
```

### Task 2: Send the approved brief before WebRTC negotiation

**Files:**
- Modify: `src/App.tsx:128-220,304-328`
- Test: `src/App.test.tsx`

**Step 1: Write the failing test**

Start an approved brief session and assert the first token fetch is a POST to `/api/token` whose JSON body is the approved creative brief, before the WebRTC SDP request.

```tsx
expect(fetch).toHaveBeenCalledWith("/api/token", expect.objectContaining({
  method: "POST",
  body: expect.stringContaining("안개 속 항구의 사공"),
}));
```

**Step 2: Run the focused test to verify RED**

Run: `npm test -- src/App.test.tsx`

Expected: FAIL because the client fetches the token with GET and sends brief context only after the data channel opens.

**Step 3: Implement the minimum client change**

- Send `fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creativeBrief) })`.
- Stop sending a duplicate client-side `session.update`; the server-issued client secret is the authoritative initial session instruction.
- Keep the opening message short and scoped to asking one question that advances `sessionGoal`.
- Surface token-route validation failures using the existing session error status.

**Step 4: Run the focused test to verify GREEN**

Run: `npm test -- src/App.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "Send approved brief when opening realtime session"
```

### Task 3: Record companion output-audio transcripts

**Files:**
- Modify: `src/realtime/events.ts:67-98`
- Test: `src/realtime/events.test.ts`

**Step 1: Write the failing test**

```ts
it("records OpenAI output-audio transcript events as companion speech", () => {
  expect(reduceRealtimeEvent({
    type: "response.output_audio_transcript.done",
    transcript: "설정: 항구의 시계는 바닷물을 거슬러 갑니다.",
  })).toContainEqual(expect.objectContaining({ speaker: "동반자", final: true }));
});
```

**Step 2: Run the focused test to verify RED**

Run: `npm test -- src/realtime/events.test.ts`

Expected: FAIL because only `response.audio_transcript` event names match.

**Step 3: Implement the minimum reducer extension**

Match both `response.audio_transcript` and `response.output_audio_transcript` event families. Preserve delta merging and spark extraction; finalize on `.done` or `.completed`.

**Step 4: Run the focused test to verify GREEN**

Run: `npm test -- src/realtime/events.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/realtime/events.ts src/realtime/events.test.ts
git commit -m "Record companion output audio transcripts"
```

### Task 4: Verify and promote the correct UI

**Files:**
- Modify: none
- Test: complete suite and Vercel Preview

**Step 1: Verify project quality**

Run: `npm test && npm run build`

Expected: all writer-studio tests pass and the Vite build exits 0.

**Step 2: Push the writer-studio branch**

Run: `git push origin codex/story-coauthoring`

Expected: Vercel creates a Preview deployment with the writer-studio UI.

**Step 3: Verify the Preview manually**

- Confirm the creative-brief UI is rendered.
- Approve a brief, begin voice, and confirm the companion's first reply cites the brief.
- Confirm both `사용자` and `동반자` rows appear in the transcript.

**Step 4: Integrate only after Preview approval**

Merge `codex/story-coauthoring` into `main`, push `main`, and confirm the Production alias serves the writer-studio UI.
