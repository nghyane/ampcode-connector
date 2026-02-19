/** Periodic GitHub star reminder — non-intrusive, shows in server logs. */

import { line, s } from "../cli/ansi.ts";

const REPO_URL = "https://github.com/nghyane/ampcode-connector";
const REQUEST_INTERVAL = 50;

let requestCount = 0;
let shown = false;

const messages = [
  `${s.yellow}⭐${s.reset} Enjoying ampcode-connector? Star us on GitHub → ${s.cyan}${REPO_URL}${s.reset}`,
  `${s.yellow}⭐${s.reset} Help others discover this tool — star on GitHub → ${s.cyan}${REPO_URL}${s.reset}`,
  `${s.yellow}⭐${s.reset} ${s.dim}Your star helps keep this project alive!${s.reset} → ${s.cyan}${REPO_URL}${s.reset}`,
];

function pick(): string {
  return messages[Math.floor(Math.random() * messages.length)]!;
}

/** Show star prompt in the startup banner (once). */
export function bannerAd(): void {
  line(`  ${s.dim}⭐ Star us → ${REPO_URL}${s.reset}`);
}

/** Call after each proxied request. Shows a reminder every N requests. */
export function maybeShowAd(): void {
  requestCount++;
  if (requestCount % REQUEST_INTERVAL !== 0) return;

  // Only show once per interval, don't spam
  if (shown && requestCount < REQUEST_INTERVAL * 3) return;
  shown = true;

  line();
  line(`  ${pick()}`);
  line();
}
