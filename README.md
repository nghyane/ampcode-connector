# ampcode-connector

Proxy [Amp CLI](https://ampcode.com) through your existing CLI subscriptions — use what you already have instead of Amp credits.

```
Amp CLI → ampcode-connector → Claude Code      (free)
                             → OpenAI Codex CLI (free)
                             → Gemini CLI       (free)
                             → Amp upstream     (paid, last resort)
```

## Why

| Provider | Models | Quota |
|----------|--------|-------|
| Claude Code | Opus, Sonnet, Haiku | Anthropic OAuth |
| OpenAI Codex CLI | GPT-5, o3 | OpenAI OAuth |
| Gemini CLI | Gemini Pro, Flash | Google OAuth (dual: Gemini + Vertex pools) |

Multi-account support — log in multiple times per provider for higher throughput.

## Quick Start

```bash
git clone https://github.com/nghyane/ampcode-connector.git
cd ampcode-connector
bun install

bun run setup          # auto-configures Amp CLI → proxy
bun run login          # interactive provider login (TUI)
bun start              # start proxy
```

Requires [Bun](https://bun.sh) 1.3+.

### Provider Login

```bash
bun run login              # interactive dashboard (↑↓ navigate, enter login, d disconnect)
bun run login anthropic    # Claude Code
bun run login codex        # OpenAI Codex CLI
bun run login google       # Gemini CLI + Antigravity
```

Each login opens your browser for OAuth. Log in multiple times to add accounts.

## Configuration

See [`config.yaml`](config.yaml) — port, log level, enable/disable providers.

Amp API key resolution: `config.yaml` → `AMP_API_KEY` env → `~/.local/share/amp/secrets.json`.

## How It Works

```
Request in → local OAuth available? → yes → forward to provider API (free)
                                    → no  → forward to ampcode.com  (paid)

On 429 → retry with different account/pool
On 401 → fallback to Amp upstream
```

Non-AI routes (auth, threads, telemetry) pass through to `ampcode.com` transparently.

### Routing

- **Thread affinity** — same thread sticks to same account
- **Least-connections** — new threads go to the least-loaded account
- **Cooldown** — 429'd accounts are temporarily skipped
- **Google cascade** — Gemini → Antigravity (separate quota pools)

## Development

```bash
bun run dev        # --watch
bun test           # tests
bun run check      # lint + typecheck + test
```

## License

[MIT](LICENSE)
