/** Check npm registry for newer versions on startup. */

import { s, line } from "../cli/ansi.ts";

const PACKAGE_NAME = "ampcode-connector";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const TIMEOUT_MS = 3_000;

function currentVersion(): string {
  // Read from package.json at import time
  const pkg = require("../../package.json");
  return pkg.version;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

/** Non-blocking update check — logs a notice if a newer version exists. */
export async function checkForUpdates(): Promise<void> {
  const current = currentVersion();
  const latest = await fetchLatestVersion();

  if (!latest || !isNewer(latest, current)) return;

  line();
  line(`${s.yellow}⬆ Update available${s.reset}  ${s.dim}${current}${s.reset} → ${s.green}${latest}${s.reset}`);
  line(`  Run ${s.cyan}bunx ampcode-connector@latest${s.reset} to update`);
  line();
}
