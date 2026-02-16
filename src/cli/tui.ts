/** Single-screen TUI dashboard for login and status. */

import * as configs from "../auth/configs.ts";
import type { OAuthConfig } from "../auth/oauth.ts";
import * as oauth from "../auth/oauth.ts";
import type { ProviderName } from "../auth/store.ts";
import * as store from "../auth/store.ts";
import { cursor, eol, line, out, s, screen } from "./ansi.ts";
import type { ConnectionStatus, ProviderStatus } from "./status.ts";
import * as status from "./status.ts";

const oauthConfigs: Record<ProviderName, OAuthConfig> = {
  anthropic: configs.anthropic,
  codex: configs.codex,
  google: configs.google,
};

const icon: Record<ConnectionStatus, string> = {
  connected: `${s.green}●${s.reset}`,
  expired: `${s.yellow}●${s.reset}`,
  disconnected: `${s.dim}○${s.reset}`,
};

const LABEL_WIDTH = 16;

let selected = 0;
let providers: ProviderStatus[] = [];
let message = "";
let busy = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function dashboard(): void {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive dashboard requires a TTY. Run in a terminal, not piped.");
  }

  providers = status.all();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  cursor.hide();
  screen.clear();

  render();
  timer = setInterval(render, 1_000);

  process.stdin.on("data", onKey);
  process.on("exit", cleanup);
  process.on("SIGINT", () => process.exit());
  process.on("SIGTERM", () => process.exit());
}

function cleanup(): void {
  if (timer) clearInterval(timer);
  cursor.show();
  screen.clear();
}

function render(): void {
  cursor.home();

  line(`${s.bold} ampcode-connector${s.reset}`);
  line(`${s.dim} ↑↓ navigate · enter login · d disconnect · q quit${s.reset}`);
  line();

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const sel = i === selected;
    const ic = icon[p.status];
    const name = p.label.padEnd(LABEL_WIDTH);
    const info = formatInfo(p);

    if (sel) {
      line(`${s.inverse} › ${ic} ${s.bold}${name}${s.reset}${s.inverse} ${info} ${s.reset}`);
    } else {
      line(`   ${ic} ${s.dim}${name}${s.reset} ${info}`);
    }

    if (p.sublabel) {
      line(`     ${s.dim}${p.sublabel}${s.reset}`);
    }
  }

  line();

  if (busy) {
    line(`${s.cyan}   ⟳ waiting for browser…${s.reset}`);
  } else if (message) {
    line(`   ${message}`);
  } else {
    line();
  }
}

function formatInfo(p: ProviderStatus): string {
  if (p.status === "disconnected") return `${s.dim}—${s.reset}`;

  const parts: string[] = [];

  if (p.status === "connected") {
    parts.push(`${s.green}connected${s.reset}`);
  } else {
    parts.push(`${s.yellow}expired${s.reset}`);
  }

  if (p.expiresAt && p.status === "connected") {
    parts.push(`${s.dim}${status.remaining(p.expiresAt)}${s.reset}`);
  }

  if (p.email) parts.push(`${s.dim}${p.email}${s.reset}`);

  return parts.join(`${s.dim} · ${s.reset}`);
}

async function onKey(data: string): Promise<void> {
  if (busy) return;

  if (data === "\x03" || data === "q") {
    process.exit();
    return;
  }

  if (data === "\x1b[A") {
    selected = Math.max(0, selected - 1);
    render();
    return;
  }
  if (data === "\x1b[B") {
    selected = Math.min(providers.length - 1, selected + 1);
    render();
    return;
  }

  if (data === "\r" || data === "\n") {
    await doLogin(providers[selected]!);
    return;
  }

  if (data === "d" || data === "D") {
    doDisconnect(providers[selected]!);
    return;
  }
}

async function doLogin(p: ProviderStatus): Promise<void> {
  busy = true;
  message = "";
  render();

  try {
    await oauth.login(oauthConfigs[p.name]);
    message = `${s.green}✓ ${p.label} logged in${s.reset}`;
  } catch (err) {
    message = `${s.red}✗ ${err instanceof Error ? err.message : String(err)}${s.reset}`;
  }

  providers = status.all();
  busy = false;
  render();
}

function doDisconnect(p: ProviderStatus): void {
  if (p.status === "disconnected") return;

  store.remove(p.name);
  message = `${s.yellow}✗ ${p.label} disconnected${s.reset}`;
  providers = status.all();
  render();
}
