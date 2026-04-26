# 2026-04-26 Codex Deep Mode fixes

## Context

Amp Deep Mode requests routed through local Codex were failing with:

```text
Unsupported parameter: stream_options
```

After stripping that parameter locally, a second streaming issue appeared: thinking/output could display briefly and then disappear when the stream completed.

## Changes made

- Added Codex request sanitization for unsupported fields (`prompt_cache_retention`, `safety_identifier`, `stream_options`) in `src/providers/codex.ts`.
- Added final forward-layer sanitization for `OpenAI Codex` requests in `src/providers/forward.ts`.
- Added a Codex SSE backfill in `src/providers/forward.ts` that rebuilds empty `response.completed.response.output` from prior `response.output_item.done` events.
- Added regression coverage in `tests/forward.test.ts`.
- Documented behavior in `docs/codex-deep-mode-compatibility.md`.

## Testing

Planned validation:

```bash
bun run format
bun run check
```

Manual verification should use the fork checkout directly until published:

```bash
bun /Users/cyron/Documents/extras/ampcode-connector/src/index.ts
```

Then retry Amp Deep Mode with local Codex routing enabled.

## Rollback

Revert the changes to:

- `src/providers/codex.ts`
- `src/providers/forward.ts`
- `tests/forward.test.ts`
- `docs/codex-deep-mode-compatibility.md`
- this activity log

No Amp CLI files are modified.
