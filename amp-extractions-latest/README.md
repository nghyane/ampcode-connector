# Amp CLI Extractions (Latest Local Binary)

This directory is a refreshed extraction snapshot built from the latest local Amp CLI binary.

## Source

- **Binary:** `~/.amp/bin/amp`
- **Version detected:** `0.0.1773129970-gb3ab74`
- **Generated:** 2026-03-10

## Files

- `config/settings.md` — settings registry from help + internal `UE0` object (public + hidden keys)
- `config/endpoints.md` — endpoint and service URL candidates from binary strings scan
- `agents/agent-tools.md` — full tool descriptions and schemas from `amp tools show`
- `agents/agent-architecture.md` — mode tool matrix + mode/subagent model mapping

## Notes

- This folder is separate from `references/` to avoid modifying read-only reference content.
- Endpoint extraction is static/best-effort; verify runtime traffic if you need exact invocation behavior.
