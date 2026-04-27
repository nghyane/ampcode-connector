# Codex Deep Mode Compatibility

## Purpose

Amp Deep Mode can route OpenAI provider requests through the local Codex OAuth provider. Recent Deep Mode requests use the OpenAI Responses API shape and may include streaming metadata that the Codex backend does not accept directly.

This compatibility layer keeps local Codex routing usable without changing Amp CLI.

## Implemented behavior

### Request sanitization

Codex Responses API requests strip unsupported top-level request fields before forwarding upstream:

- `prompt_cache_retention`
- `safety_identifier`
- `stream_options`

Some Amp Deep Mode requests include payloads like:

```json
{
  "stream": true,
  "stream_options": { "include_obfuscation": false }
}
```

The Codex backend rejects that field with:

```json
{ "detail": "Unsupported parameter: stream_options" }
```

`src/providers/codex.ts` removes unsupported fields during Codex body normalization, and `src/providers/forward.ts` also strips them as a final safety check for `OpenAI Codex` requests.

### Streaming output backfill

Some Codex streaming responses emit useful `response.output_item.done` events but leave the final `response.completed.response.output` array empty or populated only with non-message items such as reasoning. Clients that rely on the final completed event can briefly display thinking or text, then clear the UI or report that no message output was found.

For `OpenAI Codex` SSE streams, `src/providers/forward.ts` now:

1. Collects `response.output_item.done.item` values.
2. Preserves `output_index` ordering when present.
3. When `response.completed.response.output` is missing, empty, or lacks a message while a message was collected, fills or supplements it from the collected output items.
4. Applies any existing response rewrite after the backfill.

## Integration points

- `src/providers/codex.ts` performs provider-specific request transformation for Codex.
- `src/providers/forward.ts` performs final HTTP forwarding and SSE proxying.
- `src/utils/streaming.ts` parses and re-emits SSE events used by the backfill path.
- `tests/forward.test.ts` covers request stripping and streaming completed-output backfill.

## Reference

This mirrors the compatibility behavior used by CLIProxyAPI for Amp Deep Mode and Codex Responses API routing.
