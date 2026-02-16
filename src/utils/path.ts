/** URL path parsing for Amp CLI provider routes. */

import { browserPrefixes, passthroughExact, passthroughPrefixes } from "../constants.ts";

export function passthrough(pathname: string): boolean {
  if ((passthroughExact as readonly string[]).includes(pathname)) return true;
  return passthroughPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function browser(pathname: string): boolean {
  if ((passthroughExact as readonly string[]).includes(pathname)) return true;
  return browserPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function provider(pathname: string): string | null {
  const match = pathname.match(/^\/api\/provider\/([^/]+)/);
  return match?.[1] ?? null;
}

export function subpath(pathname: string): string {
  const match = pathname.match(/^\/api\/provider\/[^/]+(\/.*)/);
  return match?.[1] ?? pathname;
}

export function model(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { model?: string };
    return parsed.model ?? null;
  } catch {
    return null;
  }
}

export function modelFromUrl(url: string): string | null {
  const match = url.match(/models\/([^/:]+)/);
  return match?.[1] ?? null;
}

export function gemini(url: string): { model: string; action: string } | null {
  const match = url.match(/models\/([^/:]+):(\w+)/);
  if (!match) return null;
  return { model: match[1]!, action: match[2]! };
}

export function streaming(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { stream?: boolean };
    return parsed.stream === true;
  } catch {
    return false;
  }
}
