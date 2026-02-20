/** SQLite credential storage at ~/.ampcode-connector/credentials.db
 *  Multi-account: composite key (provider, account).
 *  Sync API via bun:sqlite — no cache needed at 0.4µs/read. */

import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId?: string;
  email?: string;
  accountId?: string;
}

export type ProviderName = "anthropic" | "codex" | "google";

const DEFAULT_DIR = join(homedir(), ".ampcode-connector");
const DEFAULT_DB_PATH = join(DEFAULT_DIR, "credentials.db");

interface DataRow {
  data: string;
}
interface AccountDataRow {
  account: number;
  data: string;
}
interface MaxAccountRow {
  max_account: number | null;
}
interface CountRow {
  cnt: number;
}

interface Statements {
  get: Statement<DataRow, [string, number]>;
  getAll: Statement<AccountDataRow, [string]>;
  set: Statement<void, [string, number, string]>;
  delOne: Statement<void, [string, number]>;
  delAll: Statement<void, [string]>;
  maxAccount: Statement<MaxAccountRow, [string]>;
  count: Statement<CountRow, [string]>;
}

let _db: Database | null = null;
let _stmts: Statements | null = null;
const _dbPath = DEFAULT_DB_PATH;
function init() {
  if (_stmts) return _stmts;

  const dir = _dbPath.replace(/\/[^/]+$/, "");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  _db = new Database(_dbPath, { strict: true });
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      provider TEXT NOT NULL,
      account  INTEGER NOT NULL DEFAULT 0,
      data     TEXT NOT NULL,
      PRIMARY KEY (provider, account)
    )
  `);

  _stmts = {
    get: _db.prepare<DataRow, [string, number]>("SELECT data FROM credentials WHERE provider = ? AND account = ?"),
    getAll: _db.prepare<AccountDataRow, [string]>(
      "SELECT account, data FROM credentials WHERE provider = ? ORDER BY account",
    ),
    set: _db.prepare<void, [string, number, string]>(
      "INSERT OR REPLACE INTO credentials (provider, account, data) VALUES (?, ?, ?)",
    ),
    delOne: _db.prepare<void, [string, number]>("DELETE FROM credentials WHERE provider = ? AND account = ?"),
    delAll: _db.prepare<void, [string]>("DELETE FROM credentials WHERE provider = ?"),
    maxAccount: _db.prepare<MaxAccountRow, [string]>(
      "SELECT MAX(account) as max_account FROM credentials WHERE provider = ?",
    ),
    count: _db.prepare<CountRow, [string]>("SELECT COUNT(*) as cnt FROM credentials WHERE provider = ?"),
  };
  return _stmts;
}

export function get(provider: ProviderName, account = 0): Credentials | undefined {
  const row = init().get.get(provider, account);
  if (!row) return undefined;
  try {
    return JSON.parse(row.data) as Credentials;
  } catch (err) {
    logger.warn(`Corrupt credentials for ${provider}:${account}, removing`, { error: String(err) });
    init().delOne.run(provider, account);
    return undefined;
  }
}

export function getAll(provider: ProviderName): { account: number; credentials: Credentials }[] {
  const results: { account: number; credentials: Credentials }[] = [];
  for (const row of init().getAll.all(provider)) {
    try {
      results.push({ account: row.account, credentials: JSON.parse(row.data) as Credentials });
    } catch (err) {
      logger.warn(`Corrupt credentials for ${provider}:${row.account}, removing`, { error: String(err) });
      init().delOne.run(provider, row.account);
    }
  }
  return results;
}

export function save(provider: ProviderName, credentials: Credentials, account = 0): void {
  init().set.run(provider, account, JSON.stringify(credentials));
}

export function remove(provider: ProviderName, account?: number): void {
  if (account !== undefined) {
    init().delOne.run(provider, account);
  } else {
    init().delAll.run(provider);
  }
}

export function nextAccount(provider: ProviderName): number {
  const row = init().maxAccount.get(provider);
  return (row?.max_account ?? -1) + 1;
}

export function count(provider: ProviderName): number {
  return init().count.get(provider)?.cnt ?? 0;
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
