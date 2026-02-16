import type { Credentials, ProviderName } from "../auth/store.ts";
import * as store from "../auth/store.ts";

export type ConnectionStatus = "connected" | "expired" | "disconnected";

export interface AccountStatus {
  account: number;
  status: ConnectionStatus;
  email?: string;
  expiresAt?: number;
}

export interface ProviderStatus {
  name: ProviderName;
  label: string;
  sublabel?: string;
  accounts: AccountStatus[];
}

const PROVIDERS: { name: ProviderName; label: string; sublabel?: string }[] = [
  { name: "anthropic", label: "Claude Code" },
  { name: "codex", label: "OpenAI Codex" },
  { name: "google", label: "Google", sublabel: "Gemini CLI + Antigravity" },
];

function connectionOf(creds: Credentials): ConnectionStatus {
  if (!creds.refreshToken) return "disconnected";
  return store.fresh(creds) ? "connected" : "expired";
}

export function all(): ProviderStatus[] {
  return PROVIDERS.map(({ name, label, sublabel }) => ({
    name,
    label,
    sublabel,
    accounts: store.getAll(name).map((e) => ({
      account: e.account,
      status: connectionOf(e.credentials),
      email: e.credentials.email,
      expiresAt: e.credentials.expiresAt,
    })),
  }));
}

export function remaining(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}
