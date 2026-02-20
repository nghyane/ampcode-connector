/** Local handler for extractWebPageContent — fetches a URL, converts to Markdown, ranks by objective. */

import { convert, JsPreprocessingPreset } from "@kreuzberg/html-to-markdown";
import { logger } from "../utils/logger.ts";

interface WebReadParams {
  url: string;
  objective?: string;
  forceRefetch?: boolean;
}

type WebReadResult =
  | { ok: true; result: { excerpts: string[] } | { fullContent: string } }
  | { ok: false; error: { code: string; message: string } };

interface Section {
  heading: string;
  text: string;
  index: number;
}

interface ScoredSection {
  text: string;
  score: number;
  index: number;
}

type FetchOk = { ok: true; body: string; contentType: string };
type FetchErr = WebReadResult & { ok: false };

const FETCH = {
  TIMEOUT_MS: 30_000,
  USER_AGENT: "Mozilla/5.0 (compatible; AmpBot/1.0)",
} as const;

const CACHE = {
  MAX_ENTRIES: 50,
  TTL_MS: 5 * 60 * 1000,
} as const;

const RANKING = {
  MAX_SECTIONS: 10,
  MAX_SECTION_WORDS: 500,
  MIN_KEYWORD_LEN: 3,
  HEADING_BOOST: 2,
  BIGRAM_BOOST: 1.5,
  POSITION_DECAY: 0.1,
  BM25_K1: 1.5,
  BM25_B: 0.75,
} as const;

const CLIPPING = {
  MAX_BYTES: 262_144, // 256 KB — CLI truncation limit
  MIN_TAIL_BYTES: 100,
  EXCERPT_SEP_BYTES: 2, // "\n\n" separator
} as const;

const HTML_OPTIONS = {
  skipImages: true,
  preprocessing: { enabled: true, preset: JsPreprocessingPreset.Aggressive },
};

// biome-ignore format: compact
const STOP_WORDS = new Set(
  ("the and for are but not you all can her was one our out " +
  "has have had been from this that with they which their will " +
  "each make like just over such than them very some what about " +
  "into more other then these when where how does also after " +
  "should would could being there before between those through while using").split(" "),
);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

const cache = new Map<string, { markdown: string; createdAt: number }>();

function getCached(url: string): string | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.createdAt > CACHE.TTL_MS) {
    cache.delete(url);
    return undefined;
  }

  // Re-insert to promote as most-recent (LRU)
  cache.delete(url);
  cache.set(url, entry);
  return entry.markdown;
}

function setCache(url: string, markdown: string): void {
  if (cache.size >= CACHE.MAX_ENTRIES) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(url, { markdown, createdAt: Date.now() });
}

export async function handleWebRead({ url, objective, forceRefetch }: WebReadParams): Promise<WebReadResult> {
  let markdown = forceRefetch ? undefined : getCached(url);

  if (!markdown) {
    const page = await fetchPage(url);
    if (!page.ok) return page;
    markdown = convertToMarkdown(page.body, page.contentType);
    setCache(url, markdown);
  }

  if (objective) {
    return { ok: true, result: { excerpts: rankExcerpts(markdown, objective) } };
  }
  return { ok: true, result: { fullContent: clipText(markdown) } };
}

async function fetchPage(url: string): Promise<FetchOk | FetchErr> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH.TIMEOUT_MS),
      redirect: "follow",
      headers: { "User-Agent": FETCH.USER_AGENT },
    });
  } catch (error) {
    logger.warn("web-read fetch failed", { url, error: String(error) });
    return fetchError(`Failed to fetch ${url}: ${String(error)}`);
  }

  if (!response.ok) {
    return fetchError(`HTTP ${response.status} from ${url}`);
  }

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  return { ok: true, body, contentType };
}

function fetchError(message: string): FetchErr {
  return { ok: false, error: { code: "fetch-error", message } };
}

function convertToMarkdown(raw: string, contentType: string): string {
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return convert(raw, HTML_OPTIONS);
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

function rankExcerpts(markdown: string, objective: string): string[] {
  const sections = splitSections(markdown);
  if (!sections.length) return [clipText(markdown)];
  const { unigrams, bigrams } = parseTerms(objective);
  if (!unigrams.length) return [clipText(markdown)];
  const unigramPatterns = unigrams.map((w) => new RegExp(`\\b${RegExp.escape(w)}\\b`, "g"));
  const idfWeights = computeIdf(sections, unigramPatterns);
  const avgDocLen = sections.reduce((sum, s) => sum + (s.text.split(/\s+/).length || 1), 0) / sections.length;
  const totalSections = sections.length;
  const scored = sections.map((section) =>
    scoreSection(section, unigramPatterns, bigrams, idfWeights, avgDocLen, totalSections),
  );
  const hits = scored.filter((s) => s.score > 0);
  if (!hits.length) return [clipText(markdown)];
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  const top = hits.slice(0, RANKING.MAX_SECTIONS);
  top.sort((a, b) => a.index - b.index);
  return clipMany(top.map((s) => s.text));
}

function parseTerms(objective: string): { unigrams: string[]; bigrams: RegExp[] } {
  const words = objective
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length >= RANKING.MIN_KEYWORD_LEN && !STOP_WORDS.has(word));

  const bigrams = words
    .slice(0, -1)
    .map((word, i) => new RegExp(`\\b${RegExp.escape(word)}\\W+${RegExp.escape(words[i + 1]!)}\\b`));

  return { unigrams: words, bigrams };
}

function computeIdf(sections: Section[], patterns: RegExp[]): number[] {
  const lowerTexts = sections.map((section) => section.text.toLowerCase());
  const totalSections = sections.length;
  return patterns.map((pattern) => {
    const docFreq = lowerTexts.filter((text) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    }).length;
    return docFreq > 0 ? Math.log((totalSections - docFreq + 0.5) / (docFreq + 0.5) + 1) : 0;
  });
}

function scoreSection(
  section: Section,
  unigramPatterns: RegExp[],
  bigrams: RegExp[],
  idfWeights: number[],
  avgDocLen: number,
  totalSections: number,
): ScoredSection {
  const lowerText = section.text.toLowerCase();
  const lowerHeading = section.heading.toLowerCase();
  const docLen = lowerText.split(/\s+/).length || 1;

  // BM25 scoring
  const { BM25_K1: k1, BM25_B: b } = RANKING;
  let score = 0;
  for (let i = 0; i < unigramPatterns.length; i++) {
    const pattern = unigramPatterns[i]!;
    pattern.lastIndex = 0;
    const matches = lowerText.match(pattern);
    if (matches) {
      const tf = matches.length;
      score += idfWeights[i]! * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))));
    }
  }
  // Bigram bonus
  for (const pattern of bigrams) {
    if (pattern.test(lowerText)) score *= RANKING.BIGRAM_BOOST;
  }

  // Heading match boost (reuse pre-compiled patterns)
  if (section.heading) {
    if (
      unigramPatterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(lowerHeading);
      })
    ) {
      score *= RANKING.HEADING_BOOST;
    }
  }

  // Position decay — earlier sections get mild boost
  score *= 1 + RANKING.POSITION_DECAY * (1 - section.index / totalSections);
  return { text: section.text, score, index: section.index };
}

function splitSections(markdown: string): Section[] {
  const raw = parseHeadingSections(markdown);
  return chunkOversizedSections(raw);
}

function parseHeadingSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = "";
  let body: string[] = [];

  const flush = () => {
    const joined = body.join("\n").trim();
    if (heading || joined) {
      const text = heading ? `${heading}\n${joined}` : joined;
      sections.push({ heading, text, index: sections.length });
    }
  };

  for (const line of markdown.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      heading = line;
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();

  return sections;
}

function chunkOversizedSections(sections: Section[]): Section[] {
  const result: Section[] = [];

  for (const section of sections) {
    const wordCount = section.text.split(/\s+/).length;
    if (wordCount <= RANKING.MAX_SECTION_WORDS) {
      result.push({ ...section, index: result.length });
      continue;
    }

    const paragraphs = section.text.split(/\n{2,}/);
    let chunk: string[] = [];
    let chunkWords = 0;

    for (const paragraph of paragraphs) {
      const paraWords = paragraph.split(/\s+/).length;
      if (chunkWords + paraWords > RANKING.MAX_SECTION_WORDS && chunk.length > 0) {
        result.push({ heading: section.heading, text: chunk.join("\n\n"), index: result.length });
        chunk = [];
        chunkWords = 0;
      }
      chunk.push(paragraph);
      chunkWords += paraWords;
    }

    if (chunk.length > 0) {
      result.push({ heading: section.heading, text: chunk.join("\n\n"), index: result.length });
    }
  }

  return result;
}

function clipText(text: string): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= CLIPPING.MAX_BYTES) return text;
  return decoder.decode(bytes.slice(0, CLIPPING.MAX_BYTES)).replace(/\uFFFD+$/, "");
}

function clipMany(excerpts: string[]): string[] {
  let usedBytes = 0;
  const result: string[] = [];

  for (const excerpt of excerpts) {
    const excerptBytes = encoder.encode(excerpt).length + CLIPPING.EXCERPT_SEP_BYTES;
    if (usedBytes + excerptBytes > CLIPPING.MAX_BYTES) {
      const remaining = CLIPPING.MAX_BYTES - usedBytes;
      if (remaining > CLIPPING.MIN_TAIL_BYTES) result.push(clipText(excerpt));
      break;
    }
    result.push(excerpt);
    usedBytes += excerptBytes;
  }

  return result.length > 0 ? result : [clipText(excerpts[0]!)];
}
