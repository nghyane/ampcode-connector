#!/usr/bin/env bun
/** ampcode-connector entry point. */

import { startAutoRefresh } from "./auth/auto-refresh.ts";
import * as configs from "./auth/configs.ts";
import type { OAuthConfig } from "./auth/oauth.ts";
import * as oauth from "./auth/oauth.ts";
import { line, s } from "./cli/ansi.ts";
import { setup } from "./cli/setup.ts";
import * as status from "./cli/status.ts";
import { dashboard } from "./cli/tui.ts";
import { loadConfig, type ProxyConfig } from "./config/config.ts";
import { startServer } from "./server/server.ts";
import { bannerAd } from "./utils/ads.ts";
import { logger, setLogLevel } from "./utils/logger.ts";

const providers: Record<string, OAuthConfig> = {
  anthropic: configs.anthropic,
  codex: configs.codex,
  google: configs.google,
};

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  if (command === "setup") return setup();

  if (command === "login") {
    if (!arg) return dashboard();

    const config = providers[arg];
    if (!config) {
      logger.error(`Unknown provider: ${arg}. Available: ${Object.keys(providers).join(", ")}`);
      process.exit(1);
    }
    await oauth.login(config);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const config = await loadConfig();
  setLogLevel(config.logLevel);
  startServer(config);
  startAutoRefresh();
  banner(config);

  // Non-blocking update check — runs in background after server starts
  const { checkForUpdates } = await import("./utils/update-check.ts");
  checkForUpdates();
}

function banner(config: ProxyConfig): void {
  const providers = status.all();
  const upstream = config.ampUpstreamUrl.replace(/^https?:\/\//, "");

  line();
  line(`  ${s.bold}ampcode-connector${s.reset}`);
  line(`  ${s.dim}http://localhost:${config.port}${s.reset}`);
  line();

  for (const p of providers) {
    const count = p.accounts.length;
    const label = p.label.padEnd(16);
    const countStr = count > 0 ? `${count} account${count > 1 ? "s" : ""}` : "--";
    const dot = count > 0 ? `${s.green}●${s.reset}` : `${s.dim}○${s.reset}`;
    line(`  ${label}  ${countStr.padEnd(12)}${dot}`);
  }

  line();
  line(`  ${s.dim}upstream → ${upstream}${s.reset}`);
  line();
  bannerAd();
  line();
}

function usage(): void {
  line();
  line(`${s.bold}ampcode-connector${s.reset} ${s.dim}— proxy Amp CLI through local OAuth subscriptions${s.reset}`);
  line();
  line(`${s.bold}USAGE${s.reset}`);
  line(`  ${s.cyan}bun start${s.reset}              Start the proxy server`);
  line(`  ${s.cyan}bun run setup${s.reset}          Configure Amp CLI to use this proxy`);
  line(`  ${s.cyan}bun run login${s.reset}          Interactive login dashboard`);
  line(`  ${s.cyan}bun run login <p>${s.reset}      Login to a specific provider`);
  line();
  line(`${s.bold}PROVIDERS${s.reset}`);
  line(`  anthropic     Claude Code ${s.dim}(Anthropic models)${s.reset}`);
  line(`  codex         OpenAI Codex ${s.dim}(GPT/o3 models)${s.reset}`);
  line(`  google        Google ${s.dim}(Gemini CLI + Antigravity, dual quota)${s.reset}`);
  line();
  line(`${s.bold}CONFIG${s.reset}`);
  line(`  Edit ${s.cyan}config.yaml${s.reset} to customize port, providers, and log level.`);
  line();
}

main().catch((err) => {
  logger.error("Fatal", { error: String(err) });
  process.exit(1);
});
