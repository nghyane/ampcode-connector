/** Request body — lazy parsing with regex fast path.
 *  Fast path: regex extracts model + stream flag without JSON.parse.
 *  Slow path: full JSON.parse only when .parsed or .forwardBody is accessed
 *  (e.g. Google CCA wrapping, model rewrite). */

import { resolveModel, rewriteBodyModel } from "../routing/models.ts";
import * as path from "../utils/path.ts";

export interface ParsedBody {
  /** Original raw body string (for upstream fallback). */
  readonly raw: string;
  /** Amp model name from body.model (before mapping). */
  readonly ampModel: string | null;
  /** Whether body.stream === true. */
  readonly stream: boolean;
  /** Body string to send to provider (re-serialized only if model was remapped). */
  readonly forwardBody: string;
  /** Parsed JSON object — lazy, only materialized when accessed (Google CCA wrapping). */
  readonly parsed: Record<string, unknown> | null;
}

/** Fast-path regex to extract "model" and "stream" without JSON.parse. */
const MODEL_RE = /"model"\s*:\s*"([^"]+)"/;
const STREAM_RE = /"stream"\s*:\s*true\b/;

export function parseBody(raw: string, sub: string): ParsedBody {
  const fallbackModel = path.modelFromUrl(sub);
  if (!raw) return { raw, parsed: null, ampModel: fallbackModel, stream: false, forwardBody: raw };

  const ampModel = raw.match(MODEL_RE)?.[1] ?? fallbackModel;
  const stream = STREAM_RE.test(raw);
  const providerModel = ampModel ? resolveModel(ampModel) : null;
  const needsRewrite = !!(ampModel && providerModel && providerModel !== ampModel);

  let _parsed: Record<string, unknown> | null | undefined;
  function ensureParsed(): Record<string, unknown> | null {
    if (_parsed === undefined) {
      try {
        _parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        _parsed = null;
      }
    }
    return _parsed;
  }

  let _forwardBody: string | undefined;
  function ensureForwardBody(): string {
    if (_forwardBody === undefined) {
      if (needsRewrite) {
        const p = ensureParsed();
        _forwardBody = p ? rewriteBodyModel(p, providerModel!) : raw;
      } else {
        _forwardBody = raw;
      }
    }
    return _forwardBody;
  }

  return {
    raw,
    ampModel,
    stream,
    get parsed() {
      return ensureParsed();
    },
    get forwardBody() {
      return ensureForwardBody();
    },
  };
}
