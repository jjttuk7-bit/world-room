# Brief-first brainstorming design

## Goal

Keep every World Room realtime conversation anchored to the user's creative brief while still supporting collaborative brainstorming.

## Behavior

- Treat the world title, seed, mood, genre, and companion mode as the active creative brief.
- Send the active brief as Realtime session instructions before the opening response is created.
- Generate ideas only when they refine or extend the active brief.
- When a suggestion would materially conflict with the brief, ask the user to approve the change instead of adopting it.
- Open with one short question that narrows an unresolved brief element.

## Data flow

1. The client builds a structured active brief from the new-world controls or a saved world's continuity brief.
2. Once the realtime data channel opens, the client sends a `session.update` event containing brief-first instructions.
3. The client sends the opening user message and only then requests the model response.

## Error handling

- If the session-update event cannot be sent because the channel is closed, do not request an opening response and show the normal reconnect state.
- Saved worlds retain their continuity brief as the active brief.

## Tests

- Verify the session-update instructions contain each active brief field and the conflict-confirmation rule.
- Verify the opening prompt is only sent after the brief-first update event.
- Keep existing session-save behavior unchanged.
