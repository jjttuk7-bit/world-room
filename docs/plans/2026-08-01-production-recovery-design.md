# Writer studio production recovery design

## Goal

Restore the writer-studio experience as the production source of truth and ensure every voice turn follows the approved creative brief while recording both speakers.

## Branch and deployment policy

- `codex/story-coauthoring` is the implementation source for the writer-studio UI.
- Do not add new product behavior to the legacy World Room dashboard on `main`.
- Validate the writer-studio branch on a Preview deployment before merging it into `main` for Production.

## Brief enforcement

- The browser sends the approved creative brief to `/api/token` when opening a realtime session.
- The token route validates that the brief is approved and passes it to `createClientSecret`.
- `createClientSecret` composes baseline collaboration rules with the approved brief and sets those instructions in the initial Realtime client-secret session.
- The companion may only elaborate the brief. A material conflict must be presented as a question for user approval rather than silently adopted.
- The opening response asks one short question that advances the approved session goal.

## Transcript integrity

- Treat `response.output_audio_transcript.delta` and its completed event as companion speech, alongside the older compatible audio-transcript event names.
- Merge deltas into one in-progress companion line and finalize it on completion.
- Keep the existing user input transcription behavior and include both speaker lines when saving.

## Verification

- Server tests prove an approved brief is embedded in the client-secret instructions and an unapproved/malformed brief is rejected.
- App tests prove the approved brief is posted to the token route before WebRTC negotiation.
- Realtime event tests prove `response.output_audio_transcript` events produce companion transcript lines.
- Run the full suite and production build in the writer-studio worktree, then validate a Preview before a Production merge.
