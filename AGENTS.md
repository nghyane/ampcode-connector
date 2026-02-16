# AGENTS.md — ampcode-connector

## Project Overview

**ampcode-connector** is a lightweight proxy server that sits between **Amp CLI** (ampcode.com) and AI providers. Its sole purpose: intercept Amp CLI's API requests and route them through **local OAuth credentials** from Claude Code, OpenAI Codex CLI, Gemini CLI, and Antigravity subscriptions — so you use your existing subscriptions instead of paying Amp credits.

### Core Concept

```
Amp CLI → ampcode-connector (proxy) → Claude Code OAuth (Anthropic models, free)
                                    → OpenAI Codex CLI OAuth (OpenAI models, free)
                                    → Gemini CLI OAuth (Gemini models, free)
                                    → Antigravity OAuth (Gemini models via Vertex, free)
                                    → Amp Upstream (last resort, paid credits)
```

### Scope — What This Project Does NOT Do

- No multi-provider abstraction beyond the 4 supported (no Bedrock, Cursor, etc.)
- No management web UI
- No complex model mapping across different provider families
- No API key marketplace or sharing features

## Reference Materials

All reference code is in `references/`. **Do not modify files in this directory.**

| Directory | Source | Purpose |
|-----------|--------|---------|
| `references/CLIProxyAPI/` | github.com/router-for-me/CLIProxyAPI | Go-based proxy — architecture reference for Amp module, fallback routing, response rewriting |
| `references/oh-my-pi-ai/` | oh-my-pi/packages/ai | TypeScript LLM library — reference for Anthropic OAuth, Codex OAuth, streaming patterns |
| `references/ai-amp-cli/` | Reverse-engineered Amp CLI docs | Amp internals: API endpoints, models, request/response formats |

### Key Reference Files

**Amp routing & proxy logic (CLIProxyAPI):**
- `references/CLIProxyAPI/internal/api/modules/amp/fallback_handlers.go` — Smart routing: local provider → fallback to upstream
- `references/CLIProxyAPI/internal/api/modules/amp/routes.go` — Amp route registration (`/api/provider/{provider}/v1/...`)
- `references/CLIProxyAPI/internal/api/modules/amp/response_rewriter.go` — Model name rewriting in SSE streams
- `references/CLIProxyAPI/internal/api/modules/amp/proxy.go` — Reverse proxy to Amp upstream
- `references/CLIProxyAPI/internal/api/modules/amp/secret.go` — Amp API key resolution (config → env → file)

**OAuth flows (oh-my-pi-ai):**
- `references/oh-my-pi-ai/src/utils/oauth/anthropic.ts` — Claude Code OAuth (PKCE flow + token refresh)
- `references/oh-my-pi-ai/src/utils/oauth/openai-codex.ts` — OpenAI Codex OAuth
- `references/oh-my-pi-ai/src/utils/oauth/google-gemini-cli.ts` — Gemini CLI OAuth (Google Cloud OAuth)
- `references/oh-my-pi-ai/src/utils/oauth/google-antigravity.ts` — Antigravity OAuth (Google Cloud OAuth for Vertex)
- `references/oh-my-pi-ai/src/utils/oauth/pkce.ts` — PKCE utilities
- `references/oh-my-pi-ai/src/utils/oauth/callback-server.ts` — Local callback server for OAuth

**Provider implementations (oh-my-pi-ai):**
- `references/oh-my-pi-ai/src/providers/anthropic.ts` — Anthropic streaming, stealth mode headers, prompt caching
- `references/oh-my-pi-ai/src/providers/openai-responses.ts` — OpenAI Responses API streaming
- `references/oh-my-pi-ai/src/providers/google-gemini-cli.ts` — Gemini CLI streaming via Google Generative AI

**Amp CLI internals (ai-amp-cli):**
- `references/ai-amp-cli/amp-extractions/config/endpoints.md` — All Amp API endpoints and 34 model definitions
- `references/ai-amp-cli/amp-extractions/config/settings.md` — Amp settings and environment variables

## Architecture

### Language & Runtime
- **TypeScript** with **Bun** runtime
- ESM modules exclusively
- Strict mode TypeScript

### Request Flow

```
1. Amp CLI sends request to proxy (e.g., POST /api/provider/anthropic/v1/messages)
2. Proxy extracts: provider name, model name, request body
3. Route decision:
   a. Provider = anthropic & Claude OAuth available?      → Forward to api.anthropic.com with OAuth token
   b. Provider = openai & Codex OAuth available?          → Forward to api.openai.com with OAuth token
   c. Provider = google & Gemini CLI OAuth available?     → Forward to generativelanguage.googleapis.com with OAuth token
   d. Provider = google & Antigravity OAuth available?    → Forward to Vertex AI endpoint with OAuth token
   e. Otherwise                                           → Forward to ampcode.com upstream (paid)
4. Stream response back to Amp CLI (SSE passthrough)
5. Log routing decision (see Development Guidelines)
```

### Four Supported Providers

| Provider | OAuth Source | Upstream API | Models |
|----------|-------------|--------------|--------|
| **Claude Code** | Anthropic PKCE OAuth | `api.anthropic.com` | Claude Opus, Sonnet, Haiku |
| **OpenAI Codex** | OpenAI PKCE OAuth | `api.openai.com` | GPT-5, o3, Codex models |
| **Gemini CLI** | Google Cloud OAuth | `generativelanguage.googleapis.com` | Gemini Pro, Flash |
| **Antigravity** | Google Cloud OAuth | Vertex AI endpoint | Gemini models via Vertex |

## Directory Structure

```
ampcode-connector/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── config.yaml              # User config (API keys, upstream URL, credentials)
├── src/
│   ├── index.ts             # Entry point — start proxy server
│   ├── server/
│   │   ├── server.ts        # HTTP server (Bun.serve or Hono)
│   │   └── middleware.ts    # Auth, logging, CORS
│   ├── proxy/
│   │   ├── upstream.ts      # Reverse proxy to ampcode.com for non-intercepted routes
│   │   └── rewriter.ts      # Response rewriting (model name replacement in SSE)
│   ├── providers/
│   │   ├── anthropic.ts     # OAuth token → forward to api.anthropic.com
│   │   ├── codex.ts         # OAuth token → forward to api.openai.com
│   │   ├── gemini.ts        # OAuth token → forward to generativelanguage.googleapis.com
│   │   └── antigravity.ts   # OAuth token → forward to Vertex AI endpoint
│   ├── auth/
│   │   ├── anthropic.ts     # Anthropic PKCE OAuth + token refresh
│   │   ├── codex.ts         # OpenAI Codex PKCE OAuth + token refresh
│   │   ├── google.ts        # Google Cloud OAuth + token refresh (shared by Gemini CLI & Antigravity)
│   │   └── store.ts         # Token persistence (file-based)
│   ├── routing/
│   │   └── router.ts        # Route decision: local provider or upstream fallback
│   ├── config/
│   │   └── config.ts        # YAML config loader
│   └── utils/
│       ├── logger.ts        # Structured logging with route decisions
│       └── streaming.ts     # SSE stream utilities
├── references/              # DO NOT MODIFY
│   ├── CLIProxyAPI/
│   ├── oh-my-pi-ai/
│   └── ai-amp-cli/
└── tests/
    ├── router.test.ts
    └── rewriter.test.ts
```

## Key Design Decisions

1. **Transparent Proxy**: For routes the proxy doesn't intercept (auth, threads, telemetry, user, meta), forward everything to `ampcode.com` as-is. Only AI provider routes (`/api/provider/...`) get intercepted.

2. **SSE Passthrough**: When forwarding to a local provider, stream the SSE response directly back to Amp CLI. Minimal transformation — only rewrite model names if needed.

3. **Token Auto-Refresh**: OAuth tokens expire. The proxy should auto-refresh tokens before they expire, using the refresh token from the initial OAuth flow.

4. **Amp API Key Resolution**: Support the same resolution chain as Amp CLI — config file → `AMP_API_KEY` env var → `~/.local/share/amp/secrets.json`.

5. **Stealth Mode for Anthropic**: When using Claude Code OAuth, mimic Claude Code CLI headers (as seen in oh-my-pi-ai's anthropic provider) to avoid being blocked.

## Development Guidelines

- Use `async/await` everywhere
- Keep it simple — four providers, one proxy, one config file
- Each provider in its own file, implementing the same interface
- Log every routing decision clearly:
  - `LOCAL_CLAUDE` — routed to Claude Code OAuth
  - `LOCAL_CODEX` — routed to OpenAI Codex OAuth
  - `LOCAL_GEMINI` — routed to Gemini CLI OAuth
  - `LOCAL_ANTIGRAVITY` — routed to Antigravity OAuth
  - `AMP_UPSTREAM` — forwarded to ampcode.com (paid)
- SSE streaming is the primary response format — ensure it works correctly
- Write tests for routing logic and SSE rewriting
- Follow existing code style — check neighboring files for patterns
- All changes must be tested — if you're not testing your changes, you're not done
- Be humble & honest — never overstate what works in commits, PRs, or messages

## Bun Features Worth Knowing

- **`Bun.markdown.render()`** — built-in Markdown parser with custom callbacks, useful for ANSI terminal output in logging
- **HTTP/2 + gRPC** — fixed in 1.3.8, relevant for Google API calls
- **`Bun.serve()` with `routes`** — built-in parameterized routing (`/api/:id`, `/*`), method-specific handlers (GET/POST), no framework needed (v1.3+)
- **`Bun.wrapAnsi()`** — 33-88x faster than `wrap-ansi` npm, ANSI-aware text wrapping for CLI output (v1.3.7+)
- **`Bun.JSON5` / `Bun.JSONC`** — built-in JSON5 and JSONC parsers, useful for config files with comments (v1.3.6+)
- **`Bun.JSONL`** — built-in JSONL parser with `parseChunk()` for streaming, useful for SSE event parsing (v1.3.7+)
- **`Bun.YAML`** — built-in YAML parse/stringify, can import `.yaml` files directly (v1.3+)
- **`Bun.secrets`** — OS-native encrypted credential storage (Keychain/libsecret/Credential Manager) (v1.3+)
- **`Bun.CookieMap`** — Map-like API for cookie parsing/serialization (v1.3+)
- **Fetch header casing** — `fetch()` now preserves original header casing, important for API compatibility (v1.3.7+)
- **`using` keyword** — `Symbol.dispose` support across Bun APIs for automatic resource cleanup

## Build & Run

```bash
bun install
bun run src/index.ts
# or
bun run dev  # with --watch
```

## Testing

```bash
bun test
```
