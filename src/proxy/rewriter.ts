/**
 * SSE response rewriting: model name substitution + thinking block suppression.
 *
 * Thinking blocks are filtered when tool_use is present because the Amp client
 * struggles with both simultaneously (ref: CLIProxyAPI response_rewriter.go:72-94).
 */

import { modelFieldPaths } from "../constants.ts";

export function rewrite(originalModel: string): (data: string) => string {
  return (data: string) => {
    if (data === "[DONE]") return data;

    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      let modified = false;

      for (const path of modelFieldPaths) {
        const current = getField(parsed, path);
        if (current !== undefined && current !== originalModel) {
          setField(parsed, path, originalModel);
          modified = true;
        }
      }

      if (suppressThinking(parsed)) modified = true;

      return modified ? JSON.stringify(parsed) : data;
    } catch {
      return data;
    }
  };
}

function getField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  if (current != null && typeof current === "object") {
    (current as Record<string, unknown>)[parts[parts.length - 1]!] = value;
  }
}

function suppressThinking(data: Record<string, unknown>): boolean {
  const content = data["content"];
  if (!Array.isArray(content)) return false;

  const hasToolUse = content.some((b: Record<string, unknown>) => b["type"] === "tool_use");
  if (!hasToolUse) return false;

  const hasThinking = content.some((b: Record<string, unknown>) => b["type"] === "thinking");
  if (!hasThinking) return false;

  data["content"] = content.filter((b: Record<string, unknown>) => b["type"] !== "thinking");
  return true;
}
