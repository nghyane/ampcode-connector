import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  AUTOPUSH_ENDPOINT,
  CODE_ASSIST_ENDPOINT,
  DEFAULT_ANTIGRAVITY_PROJECT,
} from "../constants.ts";
import { fromBase64url } from "../utils/encoding.ts";
import { logger } from "../utils/logger.ts";
import type { Credentials } from "./store.ts";

type Raw = Record<string, unknown>;

export async function discoverAnthropic(raw: Raw): Promise<Partial<Credentials>> {
  const account = raw.account as { uuid?: string; email_address?: string } | undefined;
  return {
    ...(account?.email_address ? { email: account.email_address } : {}),
    ...(account?.uuid ? { accountId: account.uuid } : {}),
  };
}

export async function discoverCodex(raw: Raw): Promise<Partial<Credentials>> {
  const accessToken = raw.access_token as string;
  const accountId = accountIdFromJWT(accessToken);
  const email = await fetchEmail("https://api.openai.com/v1/me", accessToken);
  return {
    ...(accountId ? { accountId } : {}),
    ...(email ? { email } : {}),
  };
}

export async function discoverGoogle(raw: Raw): Promise<Partial<Credentials>> {
  const accessToken = raw.access_token as string;
  const email = await fetchEmail("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", accessToken);
  const projectId = await findProject(accessToken);
  return { ...(email ? { email } : {}), ...(projectId ? { projectId } : {}) };
}

function accountIdFromJWT(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as Raw;
    const auth = payload["https://api.openai.com/auth"] as Raw | undefined;
    return (auth?.chatgpt_account_id as string) ?? null;
  } catch {
    return null;
  }
}

async function fetchEmail(url: string, accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return undefined;
    return ((await res.json()) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

const CCA_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
} as const;

const CCA_BODY = JSON.stringify({
  metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
});

async function findProject(accessToken: string): Promise<string | undefined> {
  for (const endpoint of [CODE_ASSIST_ENDPOINT, ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT]) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: { ...CCA_HEADERS, Authorization: `Bearer ${accessToken}` },
        body: CCA_BODY,
      });

      if (!res.ok) {
        logger.debug(`loadCodeAssist ${res.status} at ${endpoint}`);
        continue;
      }

      const body = (await res.json()) as { cloudaicompanionProject?: string | { id?: string } };
      const proj = body.cloudaicompanionProject;
      const id = typeof proj === "string" ? proj : proj?.id;
      if (id) return id;
    } catch (err) {
      logger.debug(`loadCodeAssist error at ${endpoint}`, { error: String(err) });
    }
  }

  logger.warn(`Project discovery failed, using fallback: ${DEFAULT_ANTIGRAVITY_PROJECT}`);
  return DEFAULT_ANTIGRAVITY_PROJECT;
}
