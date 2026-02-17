/** Cloud Code Assist request/URL helpers shared by Gemini CLI and Antigravity. */

interface WrapOptions {
  projectId: string;
  model: string;
  body: Record<string, unknown>;
  userAgent: "antigravity" | "pi-coding-agent";
  requestIdPrefix: "agent" | "pi";
  requestType?: "agent";
}

/** Wrap a raw request body in the Cloud Code Assist envelope. */
export function wrapRequest(opts: WrapOptions): string {
  return JSON.stringify({
    project: opts.projectId,
    model: opts.model,
    request: opts.body,
    ...(opts.requestType && { requestType: opts.requestType }),
    userAgent: opts.userAgent,
    requestId: `${opts.requestIdPrefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  });
}

/** Build the Cloud Code Assist URL for a given action. Preserves the original action
 *  (generateContent vs streamGenerateContent). Only adds ?alt=sse for streaming actions. */
export function buildUrl(endpoint: string, action: string): string {
  const streaming = action.toLowerCase().includes("stream");
  return `${endpoint}/v1internal:${action}${streaming ? "?alt=sse" : ""}`;
}

/** Unwrap Cloud Code Assist SSE envelope: {"response":{...},"traceId":"..."} → inner response.
 *  Returns empty string for [DONE] sentinel (Google SDK doesn't expect it). */
export function unwrap(data: string): string {
  if (data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as { response?: unknown };
    if (parsed.response !== undefined) return JSON.stringify(parsed.response);
    return data;
  } catch {
    return data;
  }
}

/** Chain CCA unwrap with an optional rewrite function. */
export function withUnwrap(rewrite?: (d: string) => string): (d: string) => string {
  return rewrite ? (d: string) => rewrite(unwrap(d)) : unwrap;
}

/** Wrap body in CCA envelope if not already wrapped. */
export function maybeWrap(
  parsed: Record<string, unknown> | null,
  raw: string,
  projectId: string,
  model: string,
  opts: { userAgent: "antigravity" | "pi-coding-agent"; requestIdPrefix: "agent" | "pi"; requestType?: "agent" },
): string {
  if (!parsed) return raw;
  if (parsed["project"]) return raw;
  return wrapRequest({ projectId, model, body: parsed, ...opts });
}
