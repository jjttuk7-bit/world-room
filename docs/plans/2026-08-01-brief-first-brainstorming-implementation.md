# Brief-first brainstorming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make realtime World Room conversations consistently brainstorm within the user's active creative brief.

**Architecture:** Keep the server's baseline safety and conversation instructions unchanged. In the browser, build an active-brief instruction from the selected new-world fields or saved world's continuity brief, then send it in a Realtime `session.update` event once the data channel opens. Request the opening response only after that event has been sent.

**Tech Stack:** React 19, TypeScript, WebRTC Realtime data channel, Vitest, Testing Library.

---

### Task 1: Build explicit brief-first instructions

**Files:**
- Modify: `src/App.tsx:327-334`
- Test: `src/App.test.tsx`

**Step 1: Write the failing test**

Add and export a pure instruction builder, then test its required constraints.

```tsx
it("builds brief-first instructions that confirm conflicts", () => {
  expect(buildBriefFirstInstructions({
    title: "조용한 외판 시골",
    seed: "그리스의 조용한 외딴 시골에서 벌어지는 미스터리",
    mood: "고요한",
    genre: "미스터리",
    companionMode: "질문 위주",
  })).toContain("창작 브리프를 최우선 기준으로 삼아라");
  expect(buildBriefFirstInstructions(/* same brief */)).toContain("충돌하는 제안은 채택하지 말고");
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx --exclude '**/.worktrees/**'`

Expected: FAIL because `buildBriefFirstInstructions` does not exist.

**Step 3: Write the minimal implementation**

In `src/App.tsx`, add a `Brief` type and export the pure builder:

```tsx
export function buildBriefFirstInstructions(brief: Brief) {
  return `창작 브리프를 최우선 기준으로 삼아라.
제목: ${brief.title || "아직 정해지지 않음"}
세계 씨앗: ${brief.seed || "아직 정해지지 않음"}
분위기: ${brief.mood}
장르: ${brief.genre}
동반자 방식: ${brief.companionMode}
새 아이디어는 이 브리프를 구체화할 때만 제안하라.
브리프와 충돌하는 제안은 채택하지 말고, 먼저 사용자의 확인을 받아라.
한국어로 짧게 답하고 매번 하나의 질문만 던져라.`;
}
```

For a saved world, map its title and continuity brief into the same shape and label absent fields as saved-world context.

**Step 4: Run the test to verify it passes**

Run: `npx vitest run src/App.test.tsx --exclude '**/.worktrees/**'`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "Add brief-first realtime instructions"
```

### Task 2: Apply instructions before the opening response

**Files:**
- Modify: `src/App.tsx:137-145, 201-220`
- Test: `src/App.test.tsx`

**Step 1: Write the failing test**

Mock an open RTC data channel, start a session using a filled creative brief, and assert send order:

```tsx
expect(sentEvents.map((event) => event.type)).toEqual([
  "session.update",
  "conversation.item.create",
  "response.create",
]);
expect(sentEvents[0].session.instructions).toContain("그리스의 조용한 외딴 시골");
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx --exclude '**/.worktrees/**'`

Expected: FAIL because the client only sends an opening user message and `response.create`.

**Step 3: Write the minimal implementation**

Add a `sendBriefFirstSessionUpdate` helper that emits:

```tsx
{
  type: "session.update",
  session: { instructions: buildBriefFirstInstructions(activeBrief) },
}
```

In the data-channel `open` handler, call this helper before `sendOpeningGreeting()`. Keep `sendOpeningGreeting()` as the single source for the short initial scene question, but remove duplicated full-brief prose from its user message.

**Step 4: Run the test to verify it passes**

Run: `npx vitest run src/App.test.tsx --exclude '**/.worktrees/**'`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "Apply creative brief before realtime greeting"
```

### Task 3: Verify the project without unrelated worktree tests

**Files:**
- Modify: none
- Test: `src/App.test.tsx`, `server.test.mjs`

**Step 1: Run focused project tests**

Run: `npx vitest run --exclude '**/.worktrees/**'`

Expected: PASS for the World Room root test suite.

**Step 2: Run the production build**

Run: `npm run build`

Expected: `tsc && vite build` exits with code 0.

**Step 3: Manually verify the browser flow**

Open `https://world-room.vercel.app`, enter a creative brief, allow microphone access, and confirm the first companion question refers to that brief without adding conflicting premises.

**Step 4: Commit**

```bash
git status --short
```

Expected: only the intended implementation changes are present.
