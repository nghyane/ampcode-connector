# ampcode-connector

Stop burning AmpCode credits. Route [AmpCode](https://ampcode.com) through your **existing** Claude Code, Codex CLI & Gemini CLI subscriptions — for free.

![demo](demo.gif)

```
AmpCode → ampcode-connector → Claude Code      (free)
                             → OpenAI Codex CLI (free)
                             → Gemini CLI       (free)
                             → AmpCode upstream (paid, last resort)
```

## Supported Providers

| Provider | Models | How |
|----------|--------|-----|
| **Claude Code** | Opus 4, Sonnet 4, Haiku | Anthropic OAuth |
| **OpenAI Codex CLI** | GPT-5, o3, Codex | OpenAI OAuth |
| **Gemini CLI** | Gemini Pro, Flash | Google OAuth (dual: Gemini + Vertex pools) |

> **Multi-account** — log in multiple times per provider to multiply your quota.

## Quick Start

Three commands. That's it.

```bash
bunx ampcode-connector setup    # point AmpCode → proxy
bunx ampcode-connector login    # authenticate providers (browser OAuth)
bunx ampcode-connector          # start proxy
```

<details>
<summary>Or clone & run locally</summary>

```bash
git clone https://github.com/nghyane/ampcode-connector.git
cd ampcode-connector
bun install

bun run setup
bun run login
bun start
```

</details>

Requires [Bun](https://bun.sh) 1.3+.

### Provider Login

```bash
bunx ampcode-connector login              # interactive TUI (↑↓ navigate, enter to login, d to disconnect)
bunx ampcode-connector login anthropic    # Claude Code
bunx ampcode-connector login codex        # OpenAI Codex CLI
bunx ampcode-connector login google       # Gemini CLI + Antigravity
```

Each login opens your browser. Log in multiple times to stack accounts.

## How It Works

```
Request in → local OAuth available? → yes → forward to provider API (free)
                                    → no  → forward to ampcode.com  (paid)

On 429 → retry with different account/pool
On 401 → fallback to AmpCode upstream
```

Non-AI routes (auth, threads, telemetry) pass through to `ampcode.com` transparently — the proxy is invisible to AmpCode.

### Smart Routing

- **Thread affinity** — same thread sticks to the same account for consistency
- **Least-connections** — new threads go to the least-loaded account
- **Cooldown** — rate-limited accounts are temporarily skipped
- **Google cascade** — Gemini → Antigravity (separate quota pools, double the free tier)

## Configuration

Edit [`config.yaml`](config.yaml) to change port, log level, or toggle providers.

Amp API key resolution: `config.yaml` → `AMP_API_KEY` env → `~/.local/share/amp/secrets.json`.

## Development

```bash
bun run dev        # --watch mode
bun test           # run tests
bun run check      # lint + typecheck + test
```

## License

[MIT](LICENSE)
