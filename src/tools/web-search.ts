/** Local handler for webSearch2 — searches via Exa API. */

import Exa from "exa-js";
import { logger } from "../utils/logger.ts";

let _exa: InstanceType<typeof Exa> | null = null;
let _exaKey: string | null = null;

function getExa(apiKey: string): InstanceType<typeof Exa> {
  if (!_exa || _exaKey !== apiKey) {
    _exa = new Exa(apiKey);
    _exaKey = apiKey;
  }
  return _exa;
}

export interface SearchParams {
  objective: string;
  searchQueries?: string[];
  maxResults?: number;
}

interface SearchResultItem {
  title: string;
  url: string;
  excerpts: string[];
}

type SearchResult =
  | { ok: true; result: { results: SearchResultItem[]; showParallelAttribution: boolean } }
  | { ok: false; error: { code: string; message: string } };

export async function handleSearch(params: SearchParams, exaApiKey: string): Promise<SearchResult> {
  const { objective, searchQueries, maxResults = 5 } = params;
  const query = searchQueries?.length ? searchQueries.join(" ") : objective;

  try {
    const exa = getExa(exaApiKey);
    const response = await exa.search(query, {
      numResults: maxResults,
      type: "auto",
      contents: {
        highlights: { query: objective },
      },
    });

    const results: SearchResultItem[] = response.results.map((r) => ({
      title: r.title ?? "",
      url: r.url,
      excerpts: r.highlights?.length ? r.highlights : [],
    }));

    logger.info(`[SEARCH] Exa returned ${results.length} results for "${query.slice(0, 80)}"`);
    return { ok: true, result: { results, showParallelAttribution: false } };
  } catch (err) {
    logger.error("webSearch2 Exa error", { error: String(err) });
    return { ok: false, error: { code: "search-error", message: String(err) } };
  }
}
