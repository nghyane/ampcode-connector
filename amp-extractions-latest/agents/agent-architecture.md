# AMP CLI Agent Architecture Notes (Latest Binary)

- **Source binary:** `~/.amp/bin/amp`
- **Version:** `0.0.1773129970-gb3ab74 (released 2026-03-10T08:11:50.960Z, 2h ago)`
- **Extraction date:** 2026-03-10T11:07:32.130Z
- **Method:** `amp tools list --json --mode <mode>` + binary strings extraction (objects `Xy` and `Wt`).

## Tool Availability By Mode

| Mode | Tool Count | Tools |
|---|---:|---|
| `smart` | 23 | `Bash`, `chart`, `create_file`, `edit_file`, `find_thread`, `finder`, `glob`, `Grep`, `handoff`, `librarian`, `look_at`, `mermaid`, `oracle`, `painter`, `Read`, `read_mcp_resource`, `read_thread`, `read_web_page`, `skill`, `Task`, `task_list`, `undo_edit`, `web_search` |
| `deep` | 13 | `apply_patch`, `chart`, `find_thread`, `finder`, `handoff`, `librarian`, `oracle`, `painter`, `read_thread`, `read_web_page`, `shell_command`, `skill`, `web_search` |
| `rush` | 23 | `Bash`, `chart`, `create_file`, `edit_file`, `find_thread`, `finder`, `glob`, `Grep`, `handoff`, `librarian`, `look_at`, `mermaid`, `oracle`, `painter`, `Read`, `read_mcp_resource`, `read_thread`, `read_web_page`, `skill`, `Task`, `task_list`, `undo_edit`, `web_search` |
| `free` | 15 | `Bash`, `chart`, `create_file`, `edit_file`, `find_thread`, `finder`, `glob`, `Grep`, `mermaid`, `Read`, `read_thread`, `read_web_page`, `skill`, `task_list`, `web_search` |

## Primary Model By Agent Mode

| Mode | Primary Model Constant |
|---|---|
| `smart` | `CLAUDE_OPUS_4_6` |
| `free` | `CLAUDE_HAIKU_4_5` |
| `rush` | `CLAUDE_HAIKU_4_5` |
| `agg-man` | `CLAUDE_OPUS_4_6` |
| `large` | `CLAUDE_SONNET_4_6` |
| `deep` | `GPT_5_3_CODEX` |
| `internal` | `GPT_5_4` |

## Subagent Model Mapping

| Subagent | Model Constant |
|---|---|
| `finder` | `CLAUDE_HAIKU_4_5` |
| `oracle` | `GPT_5_4` |
| `librarian` | `CLAUDE_SONNET_4_6` |
| `task-subagent` | `(dynamic/default)` |
| `code-review` | `CLAUDE_SONNET_4_5` |
| `code-tour` | `CLAUDE_OPUS_4_6` |
| `codereview-check` | `CLAUDE_HAIKU_4_5` |

## Notes

- Full assembled system prompts are not publicly retrievable in this environment (`amp tools list --inspect` returns permission denied).
- This file complements `agents/agent-tools.md` with mode/subagent model mapping inferred from binary internals.
