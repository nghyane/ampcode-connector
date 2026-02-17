#!/usr/bin/env bun
/** ampcode-connector entry point. */

import * as configs from "./auth/configs.ts";
import type { OAuthConfig } from "./auth/oauth.ts";
import * as oauth from "./auth/oauth.ts";
import { line, s } from "./cli/ansi.ts";
import { setup } from "./cli/setup.ts";
import { dashboard } from "./cli/tui.ts";
import { loadConfig } from "./config/config.ts";
import { startServer } from "./server/server.ts";
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

  // Non-blocking update check — runs in background after server starts
  const { checkForUpdates } = await import("./utils/update-check.ts");
  checkForUpdates();
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
