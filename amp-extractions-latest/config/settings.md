# AMP CLI Settings Reference (Latest Binary)

- **Source binary:** `~/.amp/bin/amp`
- **Version:** `0.0.1773129970-gb3ab74 (released 2026-03-10T08:11:50.960Z, 2h ago)`
- **Extraction date:** 2026-03-10T11:04:01.398Z
- **Method:** `amp --help` + binary strings extraction of internal settings registry object `UE0`.

## Summary

- **Total registry settings:** 42
- **Visible/public settings:** 23
- **Internal/hidden settings:** 19

## Public Settings

| Key | Default | Description |
|---|---|---|
| `amp.agent.deepReasoningEffort` | `high` | Default GPT-5.3 Codex reasoning effort for new deep-mode threads (medium, high, xhigh). |
| `amp.bitbucketToken` | `undefined` | Personal access token for Bitbucket Enterprise. Used with a workspace-level Bitbucket connection configured by an admin. |
| `amp.dangerouslyAllowAll` | `false` | Disable all command confirmation prompts (agent will execute all commands without asking) |
| `amp.defaultVisibility` | `{"github.com/sourcegraph/amp":"workspace"}` | Define default thread visibility per repository origin using mappings like "github.com/org/repo": "workspace". Values: private, public, workspace, group. |
| `amp.experimental.modes` | `[]` | Enable experimental agent modes by name. Available modes: deep |
| `amp.fuzzy.alwaysIncludePaths` | `[]` | Glob patterns for paths that should always be included in fuzzy file search, even if gitignored |
| `amp.git.commit.ampThread.enabled` | `true` | Enable adding Amp-Thread trailer in git commits |
| `amp.git.commit.coauthor.enabled` | `true` | Enable adding Amp as co-author in git commits |
| `amp.guardedFiles.allowlist` | `[]` | Array of file glob patterns that are allowed to be accessed without confirmation. Takes precedence over the built-in denylist. |
| `amp.mcpServers` | `{"filesystem":{"command":"npx","args":["@modelcontextprotocol/server-filesystem","/path/to/allowed/dir"]}}` | Model Context Protocol servers to connect to for additional tools |
| `amp.network.timeout` | `30` | How many seconds to wait for network requests to the Amp server before timing out |
| `amp.notifications.enabled` | `true` | Enable system sound notifications when agent completes tasks |
| `amp.notifications.system.enabled` | `true` | Enable system notifications when terminal is not focused |
| `amp.permissions` | `[{"tool":"Bash","action":"ask","matches":{"cmd":["git push*","git commit*","git branch -D*","git checkout HEAD*"]}}]` | Permission rules for tool calls. See amp permissions --help |
| `amp.proxy` | `undefined` | Proxy URL used for both HTTP and HTTPS requests to the Amp server |
| `amp.showCosts` | `true` | Set to false to hide costs while working on a thread |
| `amp.skills.path` | `undefined` | Path to additional directories containing skills. Supports colon-separated paths (semicolon on Windows). Use ~ for home directory. |
| `amp.terminal.animation` | `true` | Set to false to disable terminal animations (or use the equivalent NO_ANIMATION=1 env var) |
| `amp.terminal.theme` | `terminal` | Color theme for the CLI. Built-in: terminal, dark, light, catppuccin-mocha, solarized-dark, solarized-light, gruvbox-dark-hard, nord. Custom themes: ~/.config/amp/themes/<name>/colors.toml |
| `amp.toolbox.path` | `undefined` | Path to the directory containing toolbox scripts. Supports colon-separated paths. |
| `amp.tools.disable` | `["browser_navigate","builtin:edit_file"]` | Array of tool names to disable. Use 'builtin:toolname' to disable only the builtin tool with that name (allowing an MCP server to provide a tool by that name). |
| `amp.tools.enable` | `undefined` | Array of tool name patterns to enable. Supports glob patterns (e.g., 'mcp__metabase__*'). If not set, all tools are enabled. If set, only matching tools are enabled. |
| `amp.updates.mode` | `auto` | Control update checking behavior: "warn" shows update notifications, "disabled" turns off checking, "auto" automatically runs update. |

## Internal/Hidden Settings

| Key | Default | Description |
|---|---|---|
| `amp.agent.skipTitleGenerationIfMessageContains` | `[]` | List of strings that, if present in a message, will skip title generation |
| `amp.anthropic.effort` | `high` | Effort level for Anthropic models that support auto-thinking (low, medium, high, max). Higher effort means more thinking and better performance. |
| `amp.anthropic.interleavedThinking.enabled` | `false` | Enable interleaved thinking for Claude 4 models (allows reasoning between tool calls) |
| `amp.anthropic.provider` | `anthropic` | Which provider to use for Anthropic Claude inference: "anthropic" or "vertex" |
| `amp.anthropic.speed` | `undefined` | Speed mode for Anthropic models (standard or fast) |
| `amp.anthropic.temperature` | `1` | Temperature setting for Anthropic models (0.0 = deterministic, 1.0 = creative). Note: Only takes effect when thinking is disabled. Internal use only. |
| `amp.anthropic.thinking.enabled` | `false` | Enable Claude thinking process output for debugging |
| `amp.debugLogs` | `false` | Enable debug logging output |
| `amp.experimental.cli.nativeSecretsStorage.enabled` | `false` | Use native secret storage instead of the plain-text secrets configuration file |
| `amp.experimental.tools` | `[]` | Enable experimental tools by name |
| `amp.gemini.thinkingLevel` | `undefined` | Thinking level for Gemini models (minimal, low, medium, high, or undefined) |
| `amp.hooks` | `[]` | Custom hooks for extending Amp functionality |
| `amp.jetbrains.skipInstall` | `false` | Skip JetBrains plugin installation |
| `amp.submitOnEnter` | `true` | Whether to submit messages on Enter (true) or require Ctrl+Enter (false) |
| `amp.systemPrompt` | `undefined` | Custom system prompt text to append (SDK use only) |
| `amp.terminal.commands.nodeSpawn.loadProfile` | `daily` | How often to load shell profile in node-spawn mode (always, daily, never) |
| `amp.tools.inactivityTimeout` | `300` | How many seconds of no output to wait before canceling bash commands |
| `amp.tools.stopTimeout` | `300` | Timeout for stopping tools |
| `amp.url` | `https://ampcode.com` | The Amp server URL to connect to |

## Raw Public Help Block

```text
amp.agent.deepReasoningEffort
      Default GPT-5.3 Codex reasoning effort for new deep-mode threads (medium, high, xhigh).
  amp.bitbucketToken
      Personal access token for Bitbucket Enterprise. Used with a workspace-level Bitbucket connection configured by an
      admin.
  amp.dangerouslyAllowAll
      Disable all command confirmation prompts (agent will execute all commands without asking)
  amp.defaultVisibility
      Define default thread visibility per repository origin using mappings like "github.com/org/repo": "workspace".
      Values: private, public, workspace, group.
  amp.experimental.modes
      Enable experimental agent modes by name. Available modes: deep
  amp.fuzzy.alwaysIncludePaths
      Glob patterns for paths that should always be included in fuzzy file search, even if gitignored
  amp.git.commit.ampThread.enabled
      Enable adding Amp-Thread trailer in git commits
  amp.git.commit.coauthor.enabled
      Enable adding Amp as co-author in git commits
  amp.guardedFiles.allowlist
      Array of file glob patterns that are allowed to be accessed without confirmation. Takes precedence over the
      built-in denylist.
  amp.mcpServers
      Model Context Protocol servers to connect to for additional tools
  amp.network.timeout
      How many seconds to wait for network requests to the Amp server before timing out
  amp.notifications.enabled
      Enable system sound notifications when agent completes tasks
  amp.notifications.system.enabled
      Enable system notifications when terminal is not focused
  amp.permissions
      Permission rules for tool calls. See amp permissions --help
  amp.proxy
      Proxy URL used for both HTTP and HTTPS requests to the Amp server
  amp.showCosts
      Set to false to hide costs while working on a thread
  amp.skills.path
      Path to additional directories containing skills. Supports colon-separated paths (semicolon on Windows). Use ~ for
      home directory.
  amp.terminal.animation
      Set to false to disable terminal animations (or use the equivalent NO_ANIMATION=1 env var)
  amp.terminal.theme
      Color theme for the CLI. Built-in: terminal, dark, light, catppuccin-mocha, solarized-dark, solarized-light,
      gruvbox-dark-hard, nord. Custom themes: ~/.config/amp/themes/<name>/colors.toml
  amp.toolbox.path
      Path to the directory containing toolbox scripts. Supports colon-separated paths.
  amp.tools.disable
      Array of tool names to disable. Use 'builtin:toolname' to disable only the builtin tool with that name (allowing
      an MCP server to provide a tool by that name).
  amp.tools.enable
      Array of tool name patterns to enable. Supports glob patterns (e.g., 'mcp__metabase__*'). If not set, all tools
      are enabled. If set, only matching tools are enabled.
  amp.updates.mode
      Control update checking behavior: "warn" shows update notifications, "disabled" turns off checking, "auto"
      automatically runs update.
```
