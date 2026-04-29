# Anthropic Smart Mode Handoff Compatibility

## Purpose

Amp smart mode may route `/handoff` through the local Anthropic/Claude provider. Amp's Anthropic handoff path forces a specific tool call with:

```json
{
  "tool_choice": { "type": "tool", "name": "create_handoff_context" }
}
```

Anthropic extended thinking is incompatible with forced tool choice (`tool_choice.type` of `tool` or `any`). If a request includes both, the provider can reject the request or the Amp UI can surface the handoff as a cancelled operation.

## Implemented behavior

`src/providers/anthropic.ts` strips the top-level `thinking` field when `tool_choice.type` is either:

- `tool`
- `any`

It preserves thinking for compatible tool choice modes such as `auto`.

## Integration points

- `prepareBody` injects the Claude Code billing header, strips `speed`, and now removes incompatible thinking configuration for forced handoff/tool requests.
- `tests/forward.test.ts` covers both forced-tool stripping and `auto` preservation.

## Reference

This mirrors the behavior used by CLIProxyAPI for Amp handoff compatibility:

- `router-for-me/CLIProxyAPI#630` — handoff failure with thinking and forced tool choice
- `router-for-me/CLIProxyAPI#757` — disables thinking when `tool_choice` forces tool use
