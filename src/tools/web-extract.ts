/** Local handler for extractWebPageContent — fetches a URL and converts HTML to Markdown. */

import type { JsPreprocessingPreset } from "@kreuzberg/html-to-markdown";
import { convertWithOptionsHandle, createConversionOptionsHandle } from "@kreuzberg/html-to-markdown";
import { logger } from "../utils/logger.ts";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_CONTENT_BYTES = 262_144; // 256 KB — matches CLI truncation limit

const conversionHandle = createConversionOptionsHandle({
  skipImages: true,
  preprocessing: { enabled: true, preset: "Aggressive" as JsPreprocessingPreset },
});

export interface ExtractParams {
  url: string;
  objective?: string;
  forceRefetch?: boolean;
}

type ExtractResult =
  | { ok: true; result: { excerpts: string[] } }
  | { ok: true; result: { fullContent: string } }
  | { ok: false; error: { code: string; message: string } };

export async function handleExtract(params: ExtractParams): Promise<ExtractResult> {
  const { url, objective } = params;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AmpBot/1.0)" },
    });
  } catch (err) {
    logger.warn("extractWebPageContent fetch failed", { url, error: String(err) });
    return { ok: false, error: { code: "fetch-error", message: `Failed to fetch ${url}: ${String(err)}` } };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: { code: "fetch-error", message: `HTTP ${response.status} from ${url}` },
    };
  }

  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const markdown = toMarkdown(raw, contentType);

  if (objective) {
    const excerpts = extractExcerpts(markdown, objective);
    return { ok: true, result: { excerpts } };
  }

  return { ok: true, result: { fullContent: truncate(markdown) } };
}

/** Convert raw response body to Markdown based on content type. */
function toMarkdown(raw: string, contentType: string): string {
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return convertWithOptionsHandle(raw, conversionHandle);
  }
  if (contentType.includes("application/json")) {
    try {
      return `\`\`\`json\n${JSON.stringify(JSON.parse(raw), null, 2)}\n\`\`\``;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Split markdown into paragraphs, score by keyword overlap with objective, return top excerpts. */
function extractExcerpts(markdown: string, objective: string): string[] {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [truncate(markdown)];

  const keywords = objective
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) return [truncate(markdown)];

  const scored = paragraphs.map((p, index) => {
    const lower = p.toLowerCase();
    const score = keywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
    return { text: p, score, index };
  });

  const matched = scored.filter((s) => s.score > 0);

  // If nothing matched, return full content as single excerpt
  if (matched.length === 0) return [truncate(markdown)];

  // Sort by score desc, take top entries, then restore original order
  matched.sort((a, b) => b.score - a.score || a.index - b.index);
  const top = matched.slice(0, 20);
  top.sort((a, b) => a.index - b.index);

  const joined = top.map((s) => s.text);
  return truncateExcerpts(joined);
}

/** Truncate a string to MAX_CONTENT_BYTES. */
function truncate(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_CONTENT_BYTES) return text;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(bytes.slice(0, MAX_CONTENT_BYTES));
}

/** Truncate excerpt array so total joined size stays within limit. */
function truncateExcerpts(excerpts: string[]): string[] {
  const encoder = new TextEncoder();
  let total = 0;
  const result: string[] = [];
  for (const e of excerpts) {
    const len = encoder.encode(e).length + 2; // +2 for \n\n join
    if (total + len > MAX_CONTENT_BYTES) {
      // Add truncated last excerpt if there's room
      const remaining = MAX_CONTENT_BYTES - total;
      if (remaining > 100) result.push(truncate(e));
      break;
    }
    result.push(e);
    total += len;
  }
  return result.length > 0 ? result : [truncate(excerpts[0]!)];
}
