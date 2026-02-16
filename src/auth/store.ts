/** SQLite credential storage at ~/.ampcode-connector/credentials.db
 *  Sync API via bun:sqlite — no cache needed at 0.4µs/read. */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId?: string;
  email?: string;
  accountId?: string;
}

export type ProviderName = "anthropic" | "codex" | "google";

const DIR = join(homedir(), ".ampcode-connector");
const DB_PATH = join(DIR, "credentials.db");

mkdirSync(DIR, { recursive: true, mode: 0o700 });

const db = new Database(DB_PATH, { strict: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    provider TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  )
`);

const stmtGet = db.prepare<{ data: string }, [string]>("SELECT data FROM credentials WHERE provider = ?");
const stmtSet = db.prepare("INSERT OR REPLACE INTO credentials (provider, data) VALUES ($provider, $data)");
const stmtDel = db.prepare("DELETE FROM credentials WHERE provider = ?");

export function get(provider: ProviderName): Credentials | undefined {
  const row = stmtGet.get(provider);
  if (!row) return undefined;
  return JSON.parse(row.data) as Credentials;
}

export function save(provider: ProviderName, credentials: Credentials): void {
  stmtSet.run({ provider, data: JSON.stringify(credentials) });
}

export function remove(provider: ProviderName): void {
  stmtDel.run(provider);
}

export function exists(provider: ProviderName): boolean {
  const creds = get(provider);
  return creds != null && !!creds.refreshToken;
}

export function fresh(credentials: Credentials): boolean {
  return Date.now() < credentials.expiresAt;
}
