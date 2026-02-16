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
 *  (generateContent vs streamGenerateContent) — the ?alt=sse param handles SSE streaming. */
export function buildUrl(endpoint: string, action: string): string {
  return `${endpoint}/v1internal:${action}?alt=sse`;
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
