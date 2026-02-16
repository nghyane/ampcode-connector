/** SQLite credential storage at ~/.ampcode-connector/credentials.db
 *  Multi-account: composite key (provider, account).
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
    provider TEXT NOT NULL,
    account  INTEGER NOT NULL DEFAULT 0,
    data     TEXT NOT NULL,
    PRIMARY KEY (provider, account)
  )
`);

const stmtGet = db.prepare<{ data: string }, [string, number]>(
  "SELECT data FROM credentials WHERE provider = ? AND account = ?",
);
const stmtGetAll = db.prepare<{ account: number; data: string }, [string]>(
  "SELECT account, data FROM credentials WHERE provider = ? ORDER BY account",
);
const stmtSet = db.prepare<void, [string, number, string]>(
  "INSERT OR REPLACE INTO credentials (provider, account, data) VALUES (?, ?, ?)",
);
const stmtDelOne = db.prepare<void, [string, number]>("DELETE FROM credentials WHERE provider = ? AND account = ?");
const stmtDelAll = db.prepare<void, [string]>("DELETE FROM credentials WHERE provider = ?");
const stmtMaxAccount = db.prepare<{ max_account: number | null }, [string]>(
  "SELECT MAX(account) as max_account FROM credentials WHERE provider = ?",
);
const stmtCount = db.prepare<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM credentials WHERE provider = ?");

export function get(provider: ProviderName, account = 0): Credentials | undefined {
  const row = stmtGet.get(provider, account);
  if (!row) return undefined;
  return JSON.parse(row.data) as Credentials;
}

export function getAll(provider: ProviderName): { account: number; credentials: Credentials }[] {
  return stmtGetAll.all(provider).map((row) => ({
    account: row.account,
    credentials: JSON.parse(row.data) as Credentials,
  }));
}

export function save(provider: ProviderName, credentials: Credentials, account = 0): void {
  stmtSet.run(provider, account, JSON.stringify(credentials));
}

export function remove(provider: ProviderName, account?: number): void {
  if (account !== undefined) {
    stmtDelOne.run(provider, account);
  } else {
    stmtDelAll.run(provider);
  }
}

export function nextAccount(provider: ProviderName): number {
  const row = stmtMaxAccount.get(provider);
  return (row?.max_account ?? -1) + 1;
}

export function count(provider: ProviderName): number {
  return stmtCount.get(provider)?.cnt ?? 0;
}

/** Find existing account by email or accountId match. */
export function findByIdentity(provider: ProviderName, credentials: Credentials): number | null {
  const all = getAll(provider);
  for (const entry of all) {
    if (credentials.email && entry.credentials.email === credentials.email) return entry.account;
    if (credentials.accountId && entry.credentials.accountId === credentials.accountId) return entry.account;
  }
  return null;
}

export function exists(provider: ProviderName): boolean {
  const all = getAll(provider);
  return all.some((e) => !!e.credentials.refreshToken);
}

export function fresh(credentials: Credentials): boolean {
  return Date.now() < credentials.expiresAt;
}
