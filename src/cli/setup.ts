/** Auto-configure Amp CLI to route through ampcode-connector. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../config/config.ts";
import { line, out, s } from "./ansi.ts";
import * as status from "./status.ts";

const AMP_SECRETS_DIR = join(homedir(), ".local", "share", "amp");
const AMP_SECRETS_PATH = join(AMP_SECRETS_DIR, "secrets.json");

const AMP_SETTINGS_PATHS = [
  join(homedir(), ".config", "amp", "settings.json"),
  join(homedir(), ".amp", "settings.json"),
];

function ampSettingsPaths(): string[] {
  const envPath = process.env["AMP_SETTINGS_FILE"];
  return envPath ? [envPath] : AMP_SETTINGS_PATHS;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function findAmpApiKey(proxyUrl: string): string | undefined {
  if (process.env["AMP_API_KEY"]) return process.env["AMP_API_KEY"];

  const secrets = readJson(AMP_SECRETS_PATH);
  const exact = secrets[`apiKey@${proxyUrl}`];
  if (typeof exact === "string" && exact.length > 0) return exact;

  for (const value of Object.values(secrets)) {
    if (typeof value === "string" && value.startsWith("sgamp_")) return value;
  }
  return undefined;
}

/** Save key under proxy URL and migrate stale entries to keep secrets.json clean. */
function saveAmpApiKey(token: string, proxyUrl: string): void {
  const secrets = readJson(AMP_SECRETS_PATH);
  for (const key of Object.keys(secrets)) {
    if (key.startsWith("apiKey")) delete secrets[key];
  }
  secrets[`apiKey@${proxyUrl}`] = token;
  mkdirSync(AMP_SECRETS_DIR, { recursive: true, mode: 0o700 });
  writeJson(AMP_SECRETS_PATH, secrets);
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    out(question);
    const chunks: string[] = [];

    const onData = (data: Buffer) => {
      const str = data.toString();
      if (str.includes("\n") || str.includes("\r")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(chunks.join("").trim());
        return;
      }
      chunks.push(str);
    };

    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
  });
}

export async function setup(): Promise<void> {
  const config = await loadConfig();
  const proxyUrl = `http://localhost:${config.port}`;

  line();
  line(`${s.bold}ampcode-connector setup${s.reset}`);
  line();

  // Step 1: Configure amp.url in all settings files
  for (const settingsPath of ampSettingsPaths()) {
    const settings = readJson(settingsPath);
    if (settings["amp.url"] === proxyUrl) continue;
    settings["amp.url"] = proxyUrl;
    writeJson(settingsPath, settings);
  }
  line(`${s.green}ok${s.reset} amp.url = ${s.cyan}${proxyUrl}${s.reset}`);

  // Step 2: Amp API key
  const existingKey = findAmpApiKey(proxyUrl);

  if (existingKey) {
    saveAmpApiKey(existingKey, proxyUrl);
    const preview = existingKey.slice(0, 10) + "...";
    line(`${s.green}ok${s.reset} Amp token found  ${s.dim}${preview}${s.reset}`);
  } else {
    line();
    line(`${s.yellow}!${s.reset}  No Amp token found.`);
    line(`   Get one from ${s.cyan}https://ampcode.com/settings${s.reset}`);
    line(`   Or run ${s.cyan}amp login${s.reset} after starting the proxy.`);
    line();

    const token = await prompt(`   Paste token (or press Enter to skip): `);
    line();

    if (token) {
      saveAmpApiKey(token, proxyUrl);
      line(`${s.green}ok${s.reset} Token saved  ${s.dim}${AMP_SECRETS_PATH}${s.reset}`);
    } else {
      line(`${s.dim}-- skipped${s.reset}`);
    }
  }

  // Step 3: Provider status
  line();
  line(`${s.bold}Providers${s.reset}`);

  const providers = status.all();
  let hasAny = false;

  for (const p of providers) {
    const connected = p.accounts.filter((a) => a.status === "connected");
    const total = p.accounts.filter((a) => a.status !== "disconnected");

    if (connected.length > 0) {
      hasAny = true;
      const emails = connected
        .map((a) => a.email)
        .filter(Boolean)
        .join(", ");
      const info = emails ? `  ${s.dim}${emails}${s.reset}` : "";
      line(`  ${p.label.padEnd(16)} ${s.green}${connected.length} account(s)${s.reset}${info}`);
    } else if (total.length > 0) {
      line(`  ${p.label.padEnd(16)} ${s.yellow}${total.length} expired${s.reset}`);
    } else {
      line(`  ${p.label.padEnd(16)} ${s.dim}--${s.reset}`);
    }
  }

  if (!hasAny) {
    line();
    line(`  Run ${s.cyan}bun run login${s.reset} to authenticate providers.`);
  }

  // Summary
  line();
  line(`${s.bold}Next${s.reset}`);
  line(`  ${s.cyan}bun start${s.reset}       Start proxy`);
  if (!existingKey) {
    line(`  ${s.cyan}amp login${s.reset}       Authenticate with ampcode.com (proxy must be running)`);
  }
  line(`  ${s.cyan}amp "hello"${s.reset}     Test`);
  line();
}
