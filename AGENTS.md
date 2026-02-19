# AGENTS.md — ampcode-connector

## Build & Run
- Install: `bun install` | Start: `bun start` | Dev: `bun run dev` (with --watch)
- Format: `bun run format` | Check: `bun run check` | E2E: `bun run test:e2e`
- **Always `bun run format` before `bun run check`.**

## Architecture
TypeScript + Bun runtime, ESM-only, strict TS. Proxy intercepts Amp CLI requests at `/api/provider/{provider}/v1/...`, routes to local OAuth providers (anthropic, codex, gemini, antigravity) or falls back to Amp upstream. Non-provider routes forwarded to ampcode.com as-is. SSE streaming passthrough with model name rewriting. Config in `config.yaml` (YAML loaded via Bun.YAML). Entry point: `src/index.ts`. Key dirs: `src/auth/` (OAuth PKCE + token refresh), `src/providers/` (per-provider handlers), `src/routing/` (route decision + affinity + cooldown), `src/proxy/` (upstream proxy + SSE rewriter), `src/server/` (Bun.serve HTTP server), `src/config/`, `src/utils/`, `src/cli/`. Tests in `tests/`.

## Code Style (enforced by Biome + tsc)
- 2-space indent, double quotes, semicolons always, trailing commas, 120 char line width
- Biome linter: `recommended` rules enabled. Disabled: `noForEach`, `noExplicitAny`, `noNonNullAssertion`, `useNodejsImportProtocol`
- tsc strict mode with `noUnusedLocals` and `noUnusedParameters` enabled — no unused code allowed
- Imports: use `type` keyword for type-only imports (`import { type Foo, bar }`), include `.ts` extensions. Biome enforces alphabetical import sorting
- Prefer `const` over `let`. Prefix intentionally unused params with `_`
- Use `async/await`, not callbacks. Functions return `Promise<void>` or explicit types
- Each provider implements the `Provider` interface from `src/providers/base.ts`
- Log routing decisions: `LOCAL_CLAUDE`, `LOCAL_CODEX`, `LOCAL_GEMINI`, `LOCAL_ANTIGRAVITY`, `AMP_UPSTREAM`
- No external frameworks — uses Bun built-ins (Bun.serve, Bun.YAML, fetch)

## Design Principles
- **Specs before code** — New features must have a brief design/spec written (in PR description or doc) before implementation begins
- **Strict type safety** — Never bypass type errors; no implicit `any`. Fix types, don't cast around them
- **Immutable data** — Do not mutate shared data structures directly; prefer creating new copies or using immutable patterns
- **Pure functions** — Extract logic into pure functions (input → output, no side effects) for testability and clarity
- **Clear boundaries** — Respect layer separation (CLI → server → routing → providers → auth). Do not call across layers directly
- **Environment-agnostic** — Utilities and core logic must not depend on specific runtime details; isolate platform-specific code at the edges

## Important
- **Do NOT modify `references/`** — read-only reference code from external projects (oh-my-pi-ai proxy + CLIProxyAPI patterns used as architectural reference)
- Dependencies: `@google/genai`, `exa-js`, `@kreuzberg/html-to-markdown`. Prefer Bun built-ins over npm packages
