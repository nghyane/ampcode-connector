/** Provider-specific post-login hooks: JWT extraction, Google project discovery. */

import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  AUTOPUSH_ENDPOINT,
  CODE_ASSIST_ENDPOINT,
  DEFAULT_ANTIGRAVITY_PROJECT,
} from "../constants.ts";
import { fromBase64url } from "../utils/encoding.ts";
import { logger } from "../utils/logger.ts";

/** Extract ChatGPT account ID from an OpenAI JWT access token. */
export function accountIdFromJWT(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length < 2 || !parts[1]) return null;

  const payloadBytes = fromBase64url(parts[1]);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
  const authClaim = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  return (authClaim?.["chatgpt_account_id"] as string) ?? null;
}

interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string | { id?: string };
}

function extractProjectId(data: LoadCodeAssistPayload): string | null {
  const proj = data.cloudaicompanionProject;
  if (typeof proj === "string" && proj) return proj;
  if (proj && typeof proj === "object" && proj.id) return proj.id;
  return null;
}

/** Discover Google Cloud project for Cloud Code Assist API.
 *  Tries prod → daily → autopush (matching oh-my-pi-ai antigravity reference). */
export async function discoverProject(accessToken: string): Promise<{ projectId?: string; email?: string }> {
  const email = await fetchEmail(accessToken);

  const endpoints = [CODE_ASSIST_ENDPOINT, ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "google-api-nodejs-client/9.15.1",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": JSON.stringify({
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.debug(`loadCodeAssist ${res.status} at ${endpoint}`, { error: text.slice(0, 200) });
        continue;
      }

      const data = (await res.json()) as LoadCodeAssistPayload;
      const projectId = extractProjectId(data);
      if (projectId) return { projectId, email };

      logger.debug(`loadCodeAssist: no project id at ${endpoint}`);
    } catch (err) {
      logger.debug(`loadCodeAssist error at ${endpoint}`, { error: String(err) });
    }
  }

  logger.warn(`Project discovery failed, using fallback: ${DEFAULT_ANTIGRAVITY_PROJECT}`);
  return { projectId: DEFAULT_ANTIGRAVITY_PROJECT, email };
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "google-api-nodejs-client/9.15.1",
      },
    });
    if (!res.ok) return undefined;
    const info = (await res.json()) as { email?: string };
    return info.email;
  } catch {
    return undefined;
  }
}
