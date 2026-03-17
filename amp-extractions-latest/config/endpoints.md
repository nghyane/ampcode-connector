# AMP CLI Endpoints Reference (Latest Binary)

- **Source binary:** `~/.amp/bin/amp`
- **Version:** `0.0.1773129970-gb3ab74 (released 2026-03-10T08:11:50.960Z, 2h ago)`
- **Extraction date:** 2026-03-10T11:04:35.859Z
- **Method:** static strings scan from binary (best-effort).

## Provider Proxy Paths

- `/api/provider/anthropic`
- `/api/provider/baseten/v1`
- `/api/provider/cerebras`
- `/api/provider/fireworks/v1`
- `/api/provider/google`
- `/api/provider/groq`
- `/api/provider/kimi`
- `/api/provider/openai/v1`
- `/api/provider/xai/v1`

## Other API Path Candidates

- `/api/1.0/projects/`
- `/api/1.0/repos`
- `/api/durable-thread-workers`
- `/api/events`
- `/api/hello`
- `/api/hello/:name`
- `/api/http`
- `/api/internal`
- `/api/internal/bitbucket-instance-url`
- `/api/internal/github-auth-status`
- `/api/internal/github-proxy/`
- `/api/session`
- `/api/sessions`
- `/api/telemetry`
- `/api/threads`
- `/api/threads/`
- `/api/threads/find`
- `/api/threads/sync`
- `/api/users/:id`
- `/api/v1`
- `/api/v2/`
- `/api/v2/spans`

## Related Service URLs Found

- `http://localhost:4318/`
- `http://localhost:9411/api/v2/spans`
- `https://aiplatform.googleapis.com/`
- `https://ampcode.com`
- `https://ampcode.com/`
- `https://ampcode.com/manual`
- `https://ampcode.com/manual/appendix`
- `https://ampcode.com/models`
- `https://ampcode.com/news/stick-a-fork-in-it`
- `https://ampcode.com/settings`
- `https://ampcode.com/threads/`
- `https://ampcode.com/threads/T-3f1beb2b-bded-4fda-96cc-1af7192f24b6`
- `https://ampcode.com/threads/T-5928a90d-d53b-488f-a829-4e36442142ee`
- `https://ampcode.com/threads/T-95e73a95-f4fe-4f22-8d5c-6297467c97a5`
- `https://ampcode.com/threads/T-f916b832-c070-4853-8ab3-5e7596953bec`
- `https://ampcode.com/threads/T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- `https://api.anthropic.com`
- `https://api.anthropic.com/`
- `https://api.cerebras.ai`
- `https://api.openai.com/v1`
- `https://generativelanguage.googleapis.com`
- `https://generativelanguage.googleapis.com/`
- `https://openrouter.ai/api/v1`
- `https://storage.googleapis.com/amp-public-assets-prod-0/cli`
- `https://storage.googleapis.com/amp-public-assets-prod-0/cli/cli-version.txt`
- `https://storage.googleapis.com/amp-public-assets-prod-0/jetbrains/latest.json`
- `https://storage.googleapis.com/amp-public-assets-prod-0/ripgrep/ripgrep-binaries/`

## Notes

- Static string extraction can include dead code or SDK/internal paths.
- Use runtime logging/proxy capture to verify which endpoints are actually invoked in your environment.
