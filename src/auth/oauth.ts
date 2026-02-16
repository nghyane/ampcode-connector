/**
 * Generic OAuth flow parameterized by provider config.
 * Handles login (browser → callback → token exchange) and token refresh.
 */

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
  tokenContentType: "json" | "form";
  authorizeExtraParams?: Record<string, string>;
  useExpiryBuffer?: boolean;
  /** Include state param in token exchange (Anthropic needs it, OpenAI rejects it). */
  sendStateInTokenExchange?: boolean;
  onTokenExchange?: (data: TokenResponse, config: OAuthConfig) => Promise<Partial<Credentials>>;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const loginLocks = new Map<ProviderName, Promise<Credentials>>();

export async function token(config: OAuthConfig): Promise<string | null> {
  const creds = store.get(config.providerName);

  if (!creds) {
    try {
      const fresh = await lazyLogin(config);
      return fresh.accessToken;
    } catch (err) {
      logger.error(`Auto-login failed for ${config.providerName}`, { error: String(err) });
      return null;
    }
  }

  if (store.fresh(creds)) return creds.accessToken;

  try {
    const refreshed = await refresh(config, creds.refreshToken);
    return refreshed.accessToken;
  } catch (err) {
    logger.error(`Token refresh failed for ${config.providerName}`, { error: String(err) });
    return null;
  }
}

async function lazyLogin(config: OAuthConfig): Promise<Credentials> {
  const existing = loginLocks.get(config.providerName);
  if (existing) return existing;

  const promise = login(config).finally(() => loginLocks.delete(config.providerName));
  loginLocks.set(config.providerName, promise);
  return promise;
}

export function ready(config: OAuthConfig): boolean {
  return store.exists(config.providerName);
}

export async function login(config: OAuthConfig): Promise<Credentials> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();
  const redirectUri = `http://localhost:${config.callbackPort}${config.callbackPath}`;

  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", config.scopes);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  if (config.authorizeExtraParams) {
    for (const [key, value] of Object.entries(config.authorizeExtraParams)) {
      authUrl.searchParams.set(key, value);
    }
  }

  logger.info(`Opening browser for ${config.providerName} OAuth...`);
  const opened = await browser.open(authUrl.toString());
  if (!opened) {
    logger.warn("Could not open browser. Please open this URL manually:");
    logger.info(authUrl.toString());
  }

  const result = await waitForCallback(config.callbackPort, config.callbackPath, state);

  const exchangeParams: Record<string, string> = {
    grant_type: "authorization_code",
    code: result.code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };
  if (config.sendStateInTokenExchange) exchangeParams["state"] = result.state;

  const body = buildBody(config, exchangeParams);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": contentType(config.tokenContentType) },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${config.providerName} token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenResponse;

  const existing = store.get(config.providerName);
  let credentials = toCredentials(data, config);

  if (!credentials.refreshToken && existing?.refreshToken) {
    credentials.refreshToken = existing.refreshToken;
  }

  if (!credentials.refreshToken) {
    throw new Error(`No refresh token for ${config.providerName}. Revoke app access and try again.`);
  }

  if (config.onTokenExchange) {
    try {
      const extra = await config.onTokenExchange(data, config);
      credentials = { ...credentials, ...extra };
    } catch (err) {
      logger.error(`${config.providerName} onTokenExchange failed`, { error: String(err) });
    }
  }

  store.save(config.providerName, credentials);
  logger.info(`${config.providerName} OAuth login successful`);
  return credentials;
}

async function refresh(config: OAuthConfig, refreshTokenValue: string): Promise<Credentials> {
  const body = buildBody(config, {
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
  });

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": contentType(config.tokenContentType) },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${config.providerName} token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as TokenResponse;

  const existing = store.get(config.providerName);
  const credentials: Credentials = {
    ...existing,
    ...toCredentials(data, config),
    refreshToken: data.refresh_token ?? refreshTokenValue,
  };

  store.save(config.providerName, credentials);
  return credentials;
}

function toCredentials(data: TokenResponse, config: OAuthConfig): Credentials {
  const buffer = config.useExpiryBuffer !== false ? TOKEN_EXPIRY_BUFFER_MS : 0;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + data.expires_in * 1000 - buffer,
  };
}

function contentType(type: "json" | "form"): string {
  return type === "json" ? "application/json" : "application/x-www-form-urlencoded";
}

function buildBody(config: OAuthConfig, params: Record<string, string>): string {
  const all: Record<string, string> = { client_id: config.clientId, ...params };
  if (config.clientSecret) all["client_secret"] = config.clientSecret;
  return config.tokenContentType === "json" ? JSON.stringify(all) : new URLSearchParams(all).toString();
}
