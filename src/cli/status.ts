/** Provider status checking for the TUI dashboard. */

import type { Credentials, ProviderName } from "../auth/store.ts";
import * as store from "../auth/store.ts";

export type ConnectionStatus = "connected" | "expired" | "disconnected";

export interface ProviderStatus {
  name: ProviderName;
  label: string;
  sublabel?: string;
  status: ConnectionStatus;
  email?: string;
  expiresAt?: number;
}

const PROVIDERS: { name: ProviderName; label: string; sublabel?: string }[] = [
  { name: "anthropic", label: "Claude Code" },
  { name: "codex", label: "OpenAI Codex" },
  { name: "google", label: "Google", sublabel: "Gemini CLI + Antigravity" },
];

function connectionOf(creds: Credentials | undefined): ConnectionStatus {
  if (!creds?.refreshToken) return "disconnected";
  return store.fresh(creds) ? "connected" : "expired";
}

export function all(): ProviderStatus[] {
  return PROVIDERS.map(({ name, label, sublabel }) => {
    const creds = store.get(name);
    return { name, label, sublabel, status: connectionOf(creds), email: creds?.email, expiresAt: creds?.expiresAt };
  });
}

export function remaining(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}
