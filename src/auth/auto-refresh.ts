import { TOKEN_EXPIRY_BUFFER_MS } from "../constants.ts";
import { logger } from "../utils/logger.ts";
import * as configs from "./configs.ts";
import type { OAuthConfig } from "./oauth.ts";
import * as oauth from "./oauth.ts";
import { getAll, type ProviderName } from "./store.ts";

const REFRESH_INTERVAL_MS = 60_000;

const providerConfigs: Record<ProviderName, OAuthConfig> = {
  anthropic: configs.anthropic,
  codex: configs.codex,
  google: configs.google,
};

let timer: Timer | null = null;

async function refreshAll(): Promise<void> {
  const now = Date.now();

  for (const [provider, config] of Object.entries(providerConfigs) as [ProviderName, OAuthConfig][]) {
    for (const { account, credentials } of getAll(provider)) {
      if (credentials.expiresAt - now > TOKEN_EXPIRY_BUFFER_MS) continue;

      try {
        logger.debug("Auto-refreshing token", { provider, account });
        await oauth.token(config, account);
      } catch (err) {
        logger.error("Auto-refresh failed", { provider, account, error: String(err) });
      }
    }
  }
}

export function startAutoRefresh(): void {
  if (timer) return;
  timer = setInterval(refreshAll, REFRESH_INTERVAL_MS);
}

export function stopAutoRefresh(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
