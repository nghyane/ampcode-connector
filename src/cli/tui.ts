import * as configs from "../auth/configs.ts";
import type { OAuthConfig } from "../auth/oauth.ts";
import * as oauth from "../auth/oauth.ts";
import type { ProviderName } from "../auth/store.ts";
import * as store from "../auth/store.ts";
import { cursor, line, s, screen } from "./ansi.ts";
import type { AccountStatus, ConnectionStatus, ProviderStatus } from "./status.ts";
import * as status from "./status.ts";

const oauthConfigs: Record<ProviderName, OAuthConfig> = {
  anthropic: configs.anthropic,
  codex: configs.codex,
  google: configs.google,
};

const ICON: Record<ConnectionStatus, string> = {
  connected: `${s.green}●${s.reset}`,
  expired: `${s.yellow}●${s.reset}`,
  disabled: `${s.red}●${s.reset}`,
  disconnected: `${s.dim}○${s.reset}`,
};

type Item =
  | { type: "provider"; provider: ProviderStatus }
  | { type: "account"; provider: ProviderStatus; account: AccountStatus };

let selected = 0;
let items: Item[] = [];
let message = "";
let busy = false;
let timer: Timer | null = null;

export function dashboard(): void {
  if (!process.stdin.isTTY) throw new Error("Interactive dashboard requires a TTY.");

  rebuild();
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

function rebuild(): void {
  items = [];
  for (const p of status.all()) {
    items.push({ type: "provider", provider: p });
    for (const a of p.accounts) items.push({ type: "account", provider: p, account: a });
  }
  if (selected >= items.length) selected = Math.max(0, items.length - 1);
}

function cleanup(): void {
  if (timer) clearInterval(timer);
  cursor.show();
  screen.clear();
}

function render(): void {
  cursor.home();
  line(`${s.bold} ampcode-connector${s.reset}`);
  line(`${s.dim} ↑↓ navigate · enter login/add · d disconnect · q quit${s.reset}`);
  line();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const sel = i === selected;

    if (item.type === "provider") {
      renderProvider(item.provider, sel);
    } else {
      renderAccount(item.account, sel);
    }
  }

  line();
  if (busy) line(`${s.cyan}   ⟳ waiting for browser…${s.reset}`);
  else if (message) line(`   ${message}`);
  else line();
}

function renderProvider(p: ProviderStatus, sel: boolean): void {
  const n = p.accounts.length;
  const connected = p.accounts.filter((a) => a.status === "connected").length;
  const suffix = n > 0 ? ` ${s.dim}(${connected}/${n})${s.reset}` : "";
  const label = p.label.padEnd(16);

  if (sel) line(`${s.inverse} › ${s.bold}${label}${s.reset}${s.inverse}${suffix} ${s.reset}`);
  else line(`   ${s.bold}${label}${s.reset}${suffix}`);

  if (p.sublabel) line(`     ${s.dim}${p.sublabel}${s.reset}`);
}

function renderAccount(a: AccountStatus, sel: boolean): void {
  const ic = ICON[a.status];
  const tag = `#${a.account}`.padEnd(4);
  const info = formatInfo(a);

  if (sel) line(`${s.inverse}     ${ic} ${tag} ${info} ${s.reset}`);
  else line(`     ${ic} ${s.dim}${tag}${s.reset} ${info}`);
}

function formatInfo(a: AccountStatus): string {
  if (a.status === "disconnected") return `${s.dim}—${s.reset}`;

  const parts: string[] = [];
  if (a.status === "connected") parts.push(`${s.green}connected${s.reset}`);
  else if (a.status === "disabled") parts.push(`${s.red}disabled${s.reset}`);
  else parts.push(`${s.yellow}expired${s.reset}`);
  if (a.expiresAt && a.status === "connected") parts.push(`${s.dim}${status.remaining(a.expiresAt)}${s.reset}`);
  if (a.email) parts.push(`${s.dim}${a.email}${s.reset}`);
  return parts.join(`${s.dim} · ${s.reset}`);
}

async function onKey(data: string): Promise<void> {
  if (busy) return;

  if (data === "\x03" || data === "q") return void process.exit();
  if (data === "\x1b[A") {
    selected = Math.max(0, selected - 1);
    render();
    return;
  }
  if (data === "\x1b[B") {
    selected = Math.min(items.length - 1, selected + 1);
    render();
    return;
  }

  if (data === "\r" || data === "\n") {
    const item = items[selected]!;
    await doLogin(item.provider);
    return;
  }

  if (data === "d" || data === "D") {
    const item = items[selected]!;
    if (item.type === "account") doDisconnect(item.provider, item.account.account);
    else doDisconnectAll(item.provider);
    return;
  }
}

async function doLogin(p: ProviderStatus): Promise<void> {
  busy = true;
  message = "";
  render();

  try {
    const creds = await oauth.login(oauthConfigs[p.name]);
    message = `${s.green}✓ ${p.label} ${creds.email ?? "account"} logged in${s.reset}`;
  } catch (err) {
    message = `${s.red}✗ ${err instanceof Error ? err.message : String(err)}${s.reset}`;
  }

  rebuild();
  busy = false;
  render();
}

function doDisconnect(p: ProviderStatus, account: number): void {
  store.remove(p.name, account);
  message = `${s.yellow}✗ ${p.label} #${account} disconnected${s.reset}`;
  rebuild();
  render();
}

function doDisconnectAll(p: ProviderStatus): void {
  if (p.accounts.length === 0) return;
  store.remove(p.name);
  message = `${s.yellow}✗ ${p.label} all disconnected${s.reset}`;
  rebuild();
  render();
}
