# 2026-04-27 Anthropic smart-mode handoff fix

## Context

After Codex deep-mode handoff was fixed, Amp `/handoff` still failed in smart mode. The UI showed loading, the local provider request completed, then the handoff appeared cancelled without a visible connector error.

Connector logs showed smart mode was routing handoff to `LOCAL_CLAUDE`.

## Investigation

Amp's bundled handoff implementation chooses a provider-specific path from the active model provider. The Anthropic path calls `messages.create` with a forced tool choice:

```json
{
  "tool_choice": { "type": "tool", "name": "create_handoff_context" }
}
```

CLIProxyAPI has the same handoff failure family in `router-for-me/CLIProxyAPI#630`, fixed by `#757`, which strips Anthropic thinking when `tool_choice.type` is `tool` or `any`.

## Changes made

- Updated `src/providers/anthropic.ts` to remove top-level `thinking` when `tool_choice.type` forces tool use (`tool` or `any`).
- Exported `prepareBody` for focused regression coverage.
- Added tests in `tests/forward.test.ts` for forced-tool stripping and `auto` preservation.
- Added `docs/anthropic-handoff-compatibility.md`.

## Testing

Run:

```bash
bun run format
bun run check
```

Manual verification:

```bash
bun run dev
```

Then retry Amp `/handoff` in smart mode with local Claude routing enabled.

## Rollback

Revert changes to:

- `src/providers/anthropic.ts`
- `tests/forward.test.ts`
- `docs/anthropic-handoff-compatibility.md`
- this activity log
