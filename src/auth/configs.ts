import { ANTHROPIC_TOKEN_URL, GOOGLE_TOKEN_URL, OPENAI_TOKEN_URL } from "../constants.ts";
import { discoverAnthropic, discoverCodex, discoverGoogle } from "./discovery.ts";
import type { OAuthConfig } from "./oauth.ts";

export const anthropic: OAuthConfig = {
  providerName: "anthropic",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: ANTHROPIC_TOKEN_URL,
  callbackPort: 54545,
  callbackPath: "/callback",
  scopes: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers",
  bodyFormat: "json",
  expiryBuffer: true,
  sendStateInExchange: true,
  authorizeExtra: { code: "true" },
  extractIdentity: discoverAnthropic,
};

export const codex: OAuthConfig = {
  providerName: "codex",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: OPENAI_TOKEN_URL,
  callbackPort: 1455,
  callbackPath: "/auth/callback",
  scopes: "openid profile email offline_access",
  bodyFormat: "form",
  expiryBuffer: true,
  authorizeExtra: {
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "opencode",
  },
  extractIdentity: discoverCodex,
};

export const google: OAuthConfig = {
  providerName: "google",
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: GOOGLE_TOKEN_URL,
  callbackPort: 51121,
  callbackPath: "/oauth-callback",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ].join(" "),
  bodyFormat: "form",
  expiryBuffer: true,
  authorizeExtra: { access_type: "offline", prompt: "consent" },
  extractIdentity: discoverGoogle,
};
