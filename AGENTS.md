# AGENTS.md — ampcode-connector

## Build & Run
- Install: `bun install` | Start: `bun start` | Dev: `bun run dev` (with --watch)
- Lint+typecheck+test: `bun run check` (runs `biome check src/ tests/ && tsc --noEmit && bun test`)
- Format: `bun run format` | Test: `bun test` | Single test: `bun test tests/router.test.ts`

## Architecture
TypeScript + Bun runtime, ESM-only, strict TS. Proxy intercepts Amp CLI requests at `/api/provider/{provider}/v1/...`, routes to local OAuth providers (anthropic, codex, gemini, antigravity) or falls back to Amp upstream. Non-provider routes forwarded to ampcode.com as-is. SSE streaming passthrough with model name rewriting. Config in `config.yaml` (YAML loaded via Bun.YAML). Entry point: `src/index.ts`. Key dirs: `src/auth/` (OAuth PKCE + token refresh), `src/providers/` (per-provider handlers), `src/routing/` (route decision + affinity + cooldown), `src/proxy/` (upstream proxy + SSE rewriter), `src/server/` (Bun.serve HTTP server), `src/config/`, `src/utils/`, `src/cli/`. Tests in `tests/`.

## Code Style (enforced by Biome)
- 2-space indent, double quotes, semicolons always, trailing commas, 120 char line width
- Imports: use `type` keyword for type-only imports (`import type { Foo }`), include `.ts` extensions
- Use `async/await`, not callbacks. Functions return `Promise<void>` or explicit types
- Each provider implements the `Provider` interface from `src/providers/base.ts`
- Log routing decisions: `LOCAL_CLAUDE`, `LOCAL_CODEX`, `LOCAL_GEMINI`, `LOCAL_ANTIGRAVITY`, `AMP_UPSTREAM`
- No external frameworks — uses Bun built-ins (Bun.serve, Bun.YAML, Bun.secrets, fetch)

## Important
- **Do NOT modify `references/`** — read-only reference code from external projects (oh-my-pi-ai proxy + CLIProxyAPI patterns used as architectural reference)
- Only dependency: `@google/genai`. Prefer Bun built-ins over npm packages
