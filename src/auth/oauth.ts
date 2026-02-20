import { TOKEN_EXPIRY_BUFFER_MS } from "../constants.ts";
import * as browser from "../utils/browser.ts";
import { logger } from "../utils/logger.ts";
import { waitForCallback } from "./callback-server.ts";
import { generatePKCE, generateState } from "./pkce.ts";
import type { Credentials, ProviderName } from "./store.ts";
import * as store from "./store.ts";

export interface OAuthConfig {
  providerName: ProviderName;
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  callbackPort: number;
  callbackPath: string;
  scopes: string;
  bodyFormat: "json" | "form";
  authorizeExtra?: Record<string, string>;
  expiryBuffer?: boolean;
  sendStateInExchange?: boolean;
  extractIdentity?: (raw: Record<string, unknown>) => Promise<Partial<Credentials>>;
}

export async function token(config: OAuthConfig, account = 0): Promise<string | null> {
  const creds = store.get(config.providerName, account);

  if (!creds) {
    try {
      return (await serialize(config)).accessToken;
    } catch (err) {
      logger.error(`Auto-login failed for ${config.providerName}`, { error: String(err) });
      return null;
    }
  }

  if (store.fresh(creds)) return creds.accessToken;

  try {
    return (await refresh(config, creds.refreshToken, account)).accessToken;
  } catch (err) {
    logger.warn(`Token refresh failed for ${config.providerName}:${account}, retrying...`, { error: String(err) });
    try {
      await Bun.sleep(1000);
      return (await refresh(config, creds.refreshToken, account)).accessToken;
    } catch (retryErr) {
      logger.error(`Token refresh retry failed for ${config.providerName}:${account}`, { error: String(retryErr) });
      return null;
    }
  }
}

export async function tokenFromAny(config: OAuthConfig): Promise<{ accessToken: string; account: number } | null> {
  for (const { account, credentials: c } of store.getAll(config.providerName)) {
    if (store.fresh(c)) return { accessToken: c.accessToken, account };
  }

  for (const { account, credentials: c } of store.getAll(config.providerName)) {
    if (!c.refreshToken) continue;
    try {
      const refreshed = await refresh(config, c.refreshToken, account);
      return { accessToken: refreshed.accessToken, account };
    } catch (err) {
      logger.debug(`${config.providerName}:${account} refresh failed in tokenFromAny`, { error: String(err) });
    }
  }

  return null;
}

export function ready(config: OAuthConfig): boolean {
  return store.exists(config.providerName);
}

export function accountCount(config: OAuthConfig): number {
  return store.count(config.providerName);
}

export async function login(config: OAuthConfig): Promise<Credentials> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();
  const redirectUri = `http://localhost:${config.callbackPort}${config.callbackPath}`;

  const authUrl = new URL(config.authorizeUrl);
  const q = authUrl.searchParams;
  q.set("client_id", config.clientId);
  q.set("response_type", "code");
  q.set("redirect_uri", redirectUri);
  q.set("scope", config.scopes);
  q.set("code_challenge", challenge);
  q.set("code_challenge_method", "S256");
  q.set("state", state);
  if (config.authorizeExtra) {
    for (const [k, v] of Object.entries(config.authorizeExtra)) q.set(k, v);
  }

  logger.info(`Opening browser for ${config.providerName} OAuth...`);
  if (!(await browser.open(authUrl.toString()))) {
    logger.warn("Could not open browser. Please open this URL manually:");
    logger.info(authUrl.toString());
  }

  const callback = await waitForCallback(config.callbackPort, config.callbackPath, state);

  const exchangeParams: Record<string, string> = {
    grant_type: "authorization_code",
    code: callback.code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };
  if (config.sendStateInExchange) exchangeParams.state = callback.state;

  const raw = await exchange(config, exchangeParams);
  let credentials = parseTokenFields(raw, config);

  if (config.extractIdentity) {
    try {
      credentials = { ...credentials, ...(await config.extractIdentity(raw)) };
    } catch (err) {
      logger.error(`${config.providerName} identity extraction failed`, { error: String(err) });
    }
  }

  const existing = store.findByIdentity(config.providerName, credentials);
  const account = existing ?? store.nextAccount(config.providerName);

  if (!credentials.refreshToken) {
    credentials.refreshToken = store.get(config.providerName, account)?.refreshToken ?? "";
  }
  if (!credentials.refreshToken) {
    throw new Error(`No refresh token for ${config.providerName}. Revoke app access and try again.`);
  }

  store.save(config.providerName, credentials, account);
  logger.info(`${config.providerName}:${account} ${existing !== null ? "updated" : "added"}`);
  return credentials;
}

const loginLocks = new Map<ProviderName, Promise<Credentials>>();

function serialize(config: OAuthConfig): Promise<Credentials> {
  const pending = loginLocks.get(config.providerName);
  if (pending) return pending;

  const promise = login(config).finally(() => loginLocks.delete(config.providerName));
  loginLocks.set(config.providerName, promise);
  return promise;
}

async function refresh(config: OAuthConfig, refreshToken: string, account = 0): Promise<Credentials> {
  const raw = await exchange(config, { grant_type: "refresh_token", refresh_token: refreshToken });

  const credentials: Credentials = {
    ...store.get(config.providerName, account),
    ...parseTokenFields(raw, config),
    refreshToken: (raw.refresh_token as string) ?? refreshToken,
  };

  store.save(config.providerName, credentials, account);
  return credentials;
}

async function exchange(config: OAuthConfig, params: Record<string, string>): Promise<Record<string, unknown>> {
  const all: Record<string, string> = { client_id: config.clientId, ...params };
  if (config.clientSecret) all.client_secret = config.clientSecret;

  const isJson = config.bodyFormat === "json";
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded" },
    body: isJson ? JSON.stringify(all) : new URLSearchParams(all).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${config.providerName} token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as Record<string, unknown>;
}

function parseTokenFields(raw: Record<string, unknown>, config: OAuthConfig): Credentials {
  if (typeof raw.access_token !== "string" || !raw.access_token) {
    throw new Error(`${config.providerName} token response missing access_token`);
  }
  if (typeof raw.expires_in !== "number" || Number.isNaN(raw.expires_in)) {
    throw new Error(`${config.providerName} token response missing or invalid expires_in`);
  }
  const buffer = config.expiryBuffer !== false ? TOKEN_EXPIRY_BUFFER_MS : 0;
  return {
    accessToken: raw.access_token,
    refreshToken: (raw.refresh_token as string) ?? "",
    expiresAt: Date.now() + raw.expires_in * 1000 - buffer,
  };
}
