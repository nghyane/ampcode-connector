# 2026-04-29 Codex gpt-5.5 version gate

## Context

Amp Deep Mode was configured with:

```json
{
  "amp.internal.model": { "deep": "openai:gpt-5.5" }
}
```

The local Codex route failed with:

```text
OpenAI Codex API error (400): {"detail":"The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}
```

The installed Codex CLI was already current enough for the model:

```bash
codex --version
# codex-cli 0.125.0
```

## Investigation

The connector was still advertising an older hard-coded Codex CLI identity:

- `CODEX_CLI_VERSION = "0.101.0"`
- `User-Agent: codex_cli_rs/0.101.0 (...)`
- `Version: 0.101.0`

OpenAI Codex CLI 0.125.0 constructs a Codex CLI `User-Agent` from its package version and `originator`; it does not send the old standalone `Version` header on Responses HTTP requests.

## Changes made

- Detect the installed `codex --version` at connector startup.
- Build the Codex CLI-style `User-Agent` from the detected version.
- Fall back to `0.125.0` if the `codex` executable is unavailable.
- Stop sending the legacy standalone `Version` header.
- Added tests for Codex user-agent formatting and removal of the legacy header value.
- Updated Codex compatibility documentation.

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

Then retry Amp Deep Mode with `openai:gpt-5.5`.

## Rollback

Revert changes to:

- `src/constants.ts`
- `src/providers/codex.ts`
- `tests/forward.test.ts`
- `docs/codex-deep-mode-compatibility.md`
- this activity log
