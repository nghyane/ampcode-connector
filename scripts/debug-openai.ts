/**
 * Mini diagnostic flow for OpenAI (Codex) provider.
 *
 * Step 1: Read token from credential store
 * Step 2: Refresh token if expired
 * Step 3: Call OpenAI API directly (bypass proxy)
 * Step 4: Call through the local proxy
 *
 * Usage: bun run scripts/debug-openai.ts [port]
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] ?? "7860";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

const BODY = {
  model: "gpt-5.2",
  stream: true,
  store: false,
  instructions: "",
  input: [{ role: "user", content: "Say hello in one word." }],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function header(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

async function printResponse(label: string, response: Response) {
  console.log(`\n[${label}] Status: ${response.status} ${response.statusText}`);
  console.log(`[${label}] Headers:`);
  for (const [k, v] of response.headers.entries()) {
    if (["content-type", "x-request-id", "retry-after", "x-ratelimit-remaining-tokens"].includes(k)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  const text = await response.text();
  console.log(`[${label}] Body (${text.length} bytes):`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 500));
  }
  return text;
}

// ── Step 1: Read credentials from SQLite ─────────────────────────────────────

header("Step 1: Read Codex credentials from store");

const dbPath = join(homedir(), ".ampcode-connector", "credentials.db");
let db: Database;
try {
  db = new Database(dbPath, { readonly: true, strict: true });
} catch (err) {
  console.error(`✗ Cannot open credential DB at ${dbPath}: ${err}`);
  process.exit(1);
}

const rows = db.prepare<{ account: number; data: string }, [string]>(
  "SELECT account, data FROM credentials WHERE provider = ? ORDER BY account",
).all("codex");

if (rows.length === 0) {
  console.error("✗ No Codex credentials found. Run the login flow first.");
  process.exit(1);
}

for (const row of rows) {
  const creds = JSON.parse(row.data);
  const expiresIn = Math.round((creds.expiresAt - Date.now()) / 1000);
  const fresh = Date.now() < creds.expiresAt;
  console.log(`  account=${row.account}  fresh=${fresh}  expiresIn=${expiresIn}s  hasRefresh=${!!creds.refreshToken}`);
  console.log(`  accessToken=${creds.accessToken.slice(0, 20)}...`);
}

// ── Step 2: Refresh token if expired ─────────────────────────────────────────

header("Step 2: Ensure fresh access token");

const creds = JSON.parse(rows[0]!.data);
let accessToken: string = creds.accessToken;

if (Date.now() >= creds.expiresAt) {
  console.log("  Token expired, attempting refresh...");

  if (!creds.refreshToken) {
    console.error("  ✗ No refresh token available. Re-login required.");
    process.exit(1);
  }

  const refreshRes = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!refreshRes.ok) {
    const text = await refreshRes.text();
    console.error(`  ✗ Refresh failed (${refreshRes.status}): ${text}`);
    process.exit(1);
  }

  const refreshData = (await refreshRes.json()) as Record<string, unknown>;
  accessToken = refreshData.access_token as string;
  console.log(`  ✓ Refreshed! New token: ${accessToken.slice(0, 20)}...`);
  console.log(`  expires_in: ${refreshData.expires_in}s`);
} else {
  console.log(`  ✓ Token still fresh (${Math.round((creds.expiresAt - Date.now()) / 1000)}s remaining)`);
}

// ── Step 2b: Extract account ID from JWT ─────────────────────────────────────

let accountId: string | undefined;
try {
  const parts = accessToken.split(".");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"));
  accountId = payload[JWT_CLAIM_PATH]?.chatgpt_account_id;
  console.log(`  accountId: ${accountId ?? "(not found)"}`);
} catch {
  console.log("  ⚠ Could not decode JWT for account ID");
}

// ── Step 3: Call ChatGPT Codex backend directly (bypass proxy) ───────────────

header("Step 3: Call ChatGPT Codex backend directly (bypass proxy)");

const directUrl = `${CODEX_BASE_URL}/codex/responses`;
console.log(`  URL: ${directUrl}`);

const directRes = await fetch(directUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
    "originator": "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.101.0 (debug-script)",
    "Version": "0.101.0",
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
  },
  body: JSON.stringify(BODY),
});

await printResponse("DIRECT", directRes);

// ── Step 4: Call through local proxy ─────────────────────────────────────────

header("Step 4: Call through local proxy");

const proxyUrl = `http://localhost:${port}/api/provider/openai/v1/responses`;

try {
  const proxyRes = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(BODY),
  });

  await printResponse("PROXY", proxyRes);

  // ── Comparison ─────────────────────────────────────────────────────────────

  header("Diagnosis");

  if (directRes.ok && !proxyRes.ok) {
    console.log("  ⚠ Direct call succeeded but proxy failed.");
    console.log("  → The proxy is likely falling back to Amp upstream (token issue in proxy).");
    console.log("  → Check if the proxy refreshed the token or used an expired one.");
  } else if (directRes.ok && proxyRes.ok) {
    console.log("  ✓ Both direct and proxy calls succeeded. Everything works!");
  } else if (!directRes.ok && !proxyRes.ok) {
    console.log("  ✗ Both calls failed. OpenAI token or account may be invalid.");
  } else {
    console.log("  ? Unexpected: direct failed but proxy succeeded.");
  }
} catch (err) {
  console.error(`  ✗ Cannot reach proxy at ${proxyUrl}: ${err}`);
  console.log("  → Is the proxy running? Start with: bun start");
}

db.close();
